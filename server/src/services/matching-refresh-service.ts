import { and, asc, eq, exists, gte, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, deadStockItems, matchingRefreshJobs, usedMedicationItems, uploads } from '../db/schema';
import { splitIntoChunks } from '../utils/array-utils';
import { getNextRetryIso, getStaleBeforeIso } from '../utils/job-retry-utils';
import { parseBooleanFlag } from '../utils/number-utils';
import { findMatches, findMatchesBatch } from './matching-service';
import { logger } from './logger';
import { getErrorMessage } from '../middleware/error-handler';
import { saveMatchSnapshotAndNotifyOnChange, saveMatchSnapshotsBatch } from './matching-snapshot-service';

const AUTO_RECOMPUTE_ENABLED = parseBooleanFlag(process.env.MATCHING_AUTO_RECOMPUTE_ENABLED, true);
const MAX_JOB_ATTEMPTS = 5;
const RETRY_BATCH_SIZE = 3;
const JOB_STALE_TIMEOUT_MS = 15 * 60 * 1000;
const RETRY_BACKOFF_BASE_MS = 2 * 60 * 1000;
const CLAIM_CONTENTION_RETRY_LIMIT = 3;
const MATCHING_REFRESH_TRIGGER_LOCK_NAMESPACE = 9413;
const MATCHING_REFRESH_DEBOUNCE_MS = resolveMatchingRefreshDebounceMs(process.env.MATCHING_REFRESH_DEBOUNCE_MS);
const REFRESH_MATCH_BATCH_SIZE = resolveRefreshMatchBatchSize(process.env.MATCHING_REFRESH_BATCH_SIZE);

interface RefreshJob {
  id: number;
  triggerPharmacyId: number;
  uploadType: 'dead_stock' | 'used_medication';
  attempts: number;
}

interface JobQueueExecutor {
  insert: typeof db.insert;
  select: typeof db.select;
  update: typeof db.update;
  delete: typeof db.delete;
  execute: typeof db.execute;
}

type MatchCandidates = Awaited<ReturnType<typeof findMatches>>;
type SnapshotEntry = {
  pharmacyId: number;
  triggerPharmacyId: number;
  triggerUploadType: 'dead_stock' | 'used_medication';
  candidates: MatchCandidates;
  notifyEnabled: boolean;
};

function resolveRefreshMatchBatchSize(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 200;
  }
  return parsed;
}

function resolveMatchingRefreshDebounceMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 120_000;
  }
  return Math.min(parsed, 10 * 60 * 1000);
}

function getCurrentMonthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function buildClaimEligibilityConditions(nowIso: string, staleBeforeIso: string) {
  return [
    lt(matchingRefreshJobs.attempts, MAX_JOB_ATTEMPTS),
    or(isNull(matchingRefreshJobs.nextRetryAt), lte(matchingRefreshJobs.nextRetryAt, nowIso)),
    or(isNull(matchingRefreshJobs.processingStartedAt), lt(matchingRefreshJobs.processingStartedAt, staleBeforeIso)),
  ];
}

function recordPharmacyRefreshFailure(
  failedPharmacyIds: number[],
  pharmacyId: number,
  triggerPharmacyId: number,
  uploadType: 'dead_stock' | 'used_medication',
  err: unknown,
): void {
  failedPharmacyIds.push(pharmacyId);
  logger.error('Matching auto refresh failed for pharmacy', {
    pharmacyId,
    triggerPharmacyId,
    uploadType,
    error: getErrorMessage(err),
  });
}

async function resolveImpactedPharmacyIds(triggerPharmacyId: number): Promise<number[]> {
  const firstOfMonth = getCurrentMonthStartIso();
  const rows = await db.select({ id: pharmacies.id })
    .from(pharmacies)
    .where(and(
      eq(pharmacies.isActive, true),
      eq(pharmacies.isAdmin, false),
      exists(
        db.select({ id: deadStockItems.id })
          .from(deadStockItems)
          .where(and(
            eq(deadStockItems.pharmacyId, pharmacies.id),
            eq(deadStockItems.isAvailable, true),
          )),
      ),
      exists(
        db.select({ id: usedMedicationItems.id })
          .from(usedMedicationItems)
          .where(eq(usedMedicationItems.pharmacyId, pharmacies.id)),
      ),
      exists(
        db.select({ id: uploads.id })
          .from(uploads)
          .where(and(
            eq(uploads.pharmacyId, pharmacies.id),
            eq(uploads.uploadType, 'used_medication'),
            gte(uploads.createdAt, firstOfMonth),
          )),
      ),
    ));

  const ids = new Set(rows.map((row) => row.id));
  ids.add(triggerPharmacyId);
  return [...ids];
}

async function runSingleRefresh(triggerPharmacyId: number, uploadType: 'dead_stock' | 'used_medication'): Promise<void> {
  const impactedIds = await resolveImpactedPharmacyIds(triggerPharmacyId);
  let changedCount = 0;
  const failedPharmacyIds: number[] = [];

  // 通知設定をバルクフェッチ（N+1 防止）
  const notifyRows = await db.select({ id: pharmacies.id, matchingAutoNotifyEnabled: pharmacies.matchingAutoNotifyEnabled })
    .from(pharmacies)
    .where(inArray(pharmacies.id, impactedIds));
  const notifyEnabledMap = new Map(notifyRows.map((r) => [r.id, r.matchingAutoNotifyEnabled !== false]));

  for (const pharmacyIdChunk of splitIntoChunks(impactedIds, REFRESH_MATCH_BATCH_SIZE)) {
    let matchesByPharmacy: Map<number, Awaited<ReturnType<typeof findMatches>>> | null = null;
    try {
      matchesByPharmacy = await findMatchesBatch(pharmacyIdChunk);
    } catch (batchErr) {
      logger.warn('Matching auto refresh batch lookup failed. Falling back to per-pharmacy matching', {
        triggerPharmacyId,
        uploadType,
        impactedCount: pharmacyIdChunk.length,
        error: getErrorMessage(batchErr),
      });
    }

    // マッチング候補を収集（個別フェッチの失敗は per-pharmacy でエラー記録）
    const snapshotEntries: SnapshotEntry[] = [];

    for (const pharmacyId of pharmacyIdChunk) {
      try {
        const candidates = matchesByPharmacy?.has(pharmacyId)
          ? matchesByPharmacy.get(pharmacyId) ?? []
          : await findMatches(pharmacyId);
        snapshotEntries.push({
          pharmacyId,
          triggerPharmacyId,
          triggerUploadType: uploadType,
          candidates,
          notifyEnabled: notifyEnabledMap.get(pharmacyId) ?? true,
        });
      } catch (err) {
        recordPharmacyRefreshFailure(failedPharmacyIds, pharmacyId, triggerPharmacyId, uploadType, err);
      }
    }

    // スナップショットを一括保存（バッチ失敗時は個別保存にフォールバック）
    if (snapshotEntries.length > 0) {
      try {
        const { changedCount: chunkChanged } = await saveMatchSnapshotsBatch(snapshotEntries);
        changedCount += chunkChanged;
      } catch (batchSaveErr) {
        logger.warn('Batch snapshot save failed, falling back to per-pharmacy', {
          triggerPharmacyId,
          uploadType,
          chunkSize: snapshotEntries.length,
          error: getErrorMessage(batchSaveErr),
        });
        for (const entry of snapshotEntries) {
          try {
            const result = await saveMatchSnapshotAndNotifyOnChange(entry);
            if (result.changed) changedCount += 1;
          } catch (err) {
            recordPharmacyRefreshFailure(failedPharmacyIds, entry.pharmacyId, triggerPharmacyId, uploadType, err);
          }
        }
      }
    }
  }

  if (failedPharmacyIds.length > 0) {
    throw new Error(`Matching auto refresh failed for pharmacies: ${failedPharmacyIds.join(',')}`);
  }

  logger.info('Matching auto refresh completed', {
    triggerPharmacyId,
    uploadType,
    impactedCount: impactedIds.length,
    changedCount,
  });
}

async function claimNextRefreshJob(excludedJobIds: number[] = []): Promise<RefreshJob | null> {
  for (let attempt = 0; attempt < CLAIM_CONTENTION_RETRY_LIMIT; attempt += 1) {
    const nowIso = new Date().toISOString();
    const staleBeforeIso = getStaleBeforeIso(JOB_STALE_TIMEOUT_MS);
    const baseConditions = buildClaimEligibilityConditions(nowIso, staleBeforeIso);

    const conditions = [...baseConditions];
    if (excludedJobIds.length > 0) {
      conditions.push(notInArray(matchingRefreshJobs.id, excludedJobIds));
    }

    const [candidate] = await db.select({
      id: matchingRefreshJobs.id,
      triggerPharmacyId: matchingRefreshJobs.triggerPharmacyId,
      uploadType: matchingRefreshJobs.uploadType,
      attempts: matchingRefreshJobs.attempts,
    })
      .from(matchingRefreshJobs)
      .where(and(...conditions))
      .orderBy(
        asc(matchingRefreshJobs.createdAt),
        asc(matchingRefreshJobs.id),
      )
      .limit(1);

    if (!candidate) return null;

    const [claimed] = await db.update(matchingRefreshJobs)
      .set({
        processingStartedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(and(
        eq(matchingRefreshJobs.id, candidate.id),
        ...baseConditions,
      ))
      .returning({
        id: matchingRefreshJobs.id,
        triggerPharmacyId: matchingRefreshJobs.triggerPharmacyId,
        uploadType: matchingRefreshJobs.uploadType,
        attempts: matchingRefreshJobs.attempts,
      });

    if (claimed) return claimed;
  }

  return null;
}

async function processOneRefreshJob(job: RefreshJob): Promise<boolean> {
  try {
    await runSingleRefresh(job.triggerPharmacyId, job.uploadType);
    await db.delete(matchingRefreshJobs).where(eq(matchingRefreshJobs.id, job.id));
    return true;
  } catch (err) {
    const nextAttempts = job.attempts + 1;
    const errorMessage = getErrorMessage(err);
    const nowIso = new Date().toISOString();

    await db.update(matchingRefreshJobs)
      .set({
        attempts: nextAttempts,
        lastError: errorMessage,
        processingStartedAt: null,
        nextRetryAt: getNextRetryIso(nextAttempts, MAX_JOB_ATTEMPTS, RETRY_BACKOFF_BASE_MS),
        updatedAt: nowIso,
      })
      .where(eq(matchingRefreshJobs.id, job.id));

    if (nextAttempts >= MAX_JOB_ATTEMPTS) {
      logger.error('Matching refresh job reached max attempts', {
        jobId: job.id,
        triggerPharmacyId: job.triggerPharmacyId,
        uploadType: job.uploadType,
        attempts: nextAttempts,
        error: errorMessage,
      });
    } else {
      logger.warn('Matching refresh job attempt failed and will retry later', {
        jobId: job.id,
        triggerPharmacyId: job.triggerPharmacyId,
        uploadType: job.uploadType,
        attempts: nextAttempts,
        error: errorMessage,
      });
    }

    return false;
  }
}

async function processPendingRefreshJobs(limit: number): Promise<number> {
  let processed = 0;
  const failedInThisRun: number[] = [];

  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextRefreshJob(failedInThisRun);
    if (!job) break;

    const success = await processOneRefreshJob(job);
    if (success) {
      processed += 1;
    } else {
      failedInThisRun.push(job.id);
    }
  }

  return processed;
}

export async function processPendingMatchingRefreshJobs(limit: number = RETRY_BATCH_SIZE): Promise<number> {
  if (!AUTO_RECOMPUTE_ENABLED) return 0;
  return processPendingRefreshJobs(limit);
}

export async function triggerMatchingRefreshOnUpload(params: {
  triggerPharmacyId: number;
  uploadType: 'dead_stock' | 'used_medication';
}, executor: JobQueueExecutor = db): Promise<void> {
  if (!AUTO_RECOMPUTE_ENABLED) return;

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const scheduledAtIso = new Date(now + MATCHING_REFRESH_DEBOUNCE_MS).toISOString();
  const staleBeforeIso = getStaleBeforeIso(JOB_STALE_TIMEOUT_MS);

  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(${MATCHING_REFRESH_TRIGGER_LOCK_NAMESPACE}, ${params.triggerPharmacyId})`,
  );

  const existingRows = await executor.select({
    id: matchingRefreshJobs.id,
    processingStartedAt: matchingRefreshJobs.processingStartedAt,
    attempts: matchingRefreshJobs.attempts,
  })
    .from(matchingRefreshJobs)
    .where(and(
      eq(matchingRefreshJobs.triggerPharmacyId, params.triggerPharmacyId),
      lt(matchingRefreshJobs.attempts, MAX_JOB_ATTEMPTS),
    ))
    .orderBy(
      asc(matchingRefreshJobs.createdAt),
      asc(matchingRefreshJobs.id),
    );

  const waitingRows = existingRows.filter((row) => (
    row.processingStartedAt === null || row.processingStartedAt < staleBeforeIso
  ));
  const keeper = waitingRows[0];

  if (keeper) {
    await executor.update(matchingRefreshJobs)
      .set({
        uploadType: params.uploadType,
        attempts: 0,
        processingStartedAt: null,
        nextRetryAt: scheduledAtIso,
        lastError: null,
        updatedAt: nowIso,
      })
      .where(eq(matchingRefreshJobs.id, keeper.id));

    const redundantIds = waitingRows
      .slice(1)
      .map((row) => row.id);
    if (redundantIds.length > 0) {
      await executor.delete(matchingRefreshJobs)
        .where(inArray(matchingRefreshJobs.id, redundantIds));
    }
    return;
  }

  await executor.insert(matchingRefreshJobs).values({
    triggerPharmacyId: params.triggerPharmacyId,
    uploadType: params.uploadType,
    attempts: 0,
    processingStartedAt: null,
    nextRetryAt: scheduledAtIso,
    lastError: null,
    updatedAt: nowIso,
  });
}

export const __testables = {
  claimNextRefreshJob,
  runSingleRefresh,
  splitIntoChunks,
};
