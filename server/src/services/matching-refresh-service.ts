import { and, asc, count, eq, exists, gte, inArray, isNull, lt, lte, max, min, notInArray, or, sql, type SQLWrapper } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, deadStockItems, matchCandidateSnapshots, matchingRefreshJobs, usedMedicationItems, uploadJobs } from '../db/schema';
import { splitIntoChunks } from '../utils/array-utils';
import { getNextRetryIso, getStaleBeforeIso } from '../utils/job-retry-utils';
import { parseBooleanFlag } from '../utils/number-utils';
import { refreshDrugAvailabilitySummary } from '../db/materialized-views';
import { findMatches, findMatchesBatch } from './matching-service';
import { logger } from './logger';
import { getErrorMessage } from '../middleware/error-handler';
import { saveMatchSnapshotAndNotifyOnChange, saveMatchSnapshotsBatch } from './matching-snapshot-service';
import { createNotification } from './notification-service';

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

type MatchingRefreshUploadType = 'dead_stock' | 'used_medication';
type WaitingRefreshJob = {
  id: number;
  processingStartedAt: string | null;
  attempts: number;
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

function buildClaimEligibilityConditions(nowIso: string, staleBeforeIso: string): SQLWrapper[] {
  return [
    lt(matchingRefreshJobs.attempts, MAX_JOB_ATTEMPTS),
    or(isNull(matchingRefreshJobs.nextRetryAt), lte(matchingRefreshJobs.nextRetryAt, nowIso))!,
    or(isNull(matchingRefreshJobs.processingStartedAt), lt(matchingRefreshJobs.processingStartedAt, staleBeforeIso))!,
  ];
}

type ClaimConditions = SQLWrapper[];

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
        db.select({ id: uploadJobs.id })
          .from(uploadJobs)
          .where(and(
            eq(uploadJobs.pharmacyId, pharmacies.id),
            eq(uploadJobs.uploadType, 'used_medication'),
            gte(uploadJobs.createdAt, firstOfMonth),
          )),
      ),
    ));

  const ids = new Set(rows.map((row) => row.id));
  ids.add(triggerPharmacyId);
  return [...ids];
}

async function fetchNotifyEnabledMap(pharmacyIds: number[]): Promise<Map<number, boolean>> {
  const notifyRows = await db.select({
    id: pharmacies.id,
    matchingAutoNotifyEnabled: pharmacies.matchingAutoNotifyEnabled,
  })
    .from(pharmacies)
    .where(inArray(pharmacies.id, pharmacyIds));
  return new Map(notifyRows.map((row) => [row.id, row.matchingAutoNotifyEnabled !== false]));
}

async function findMatchesForChunk(
  pharmacyIdChunk: number[],
  triggerPharmacyId: number,
  uploadType: MatchingRefreshUploadType,
): Promise<Map<number, MatchCandidates> | null> {
  try {
    return await findMatchesBatch(pharmacyIdChunk);
  } catch (batchErr) {
    logger.warn('Matching auto refresh batch lookup failed. Falling back to per-pharmacy matching', {
      triggerPharmacyId,
      uploadType,
      impactedCount: pharmacyIdChunk.length,
      error: getErrorMessage(batchErr),
    });
    return null;
  }
}

async function buildSnapshotEntries(
  pharmacyIdChunk: number[],
  triggerPharmacyId: number,
  uploadType: MatchingRefreshUploadType,
  notifyEnabledMap: Map<number, boolean>,
  failedPharmacyIds: number[],
): Promise<SnapshotEntry[]> {
  const matchesByPharmacy = await findMatchesForChunk(pharmacyIdChunk, triggerPharmacyId, uploadType);
  const snapshotEntries: SnapshotEntry[] = [];

  for (const pharmacyId of pharmacyIdChunk) {
    try {
      const candidates = await resolveCandidatesForPharmacy(matchesByPharmacy, pharmacyId);
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

  return snapshotEntries;
}

async function resolveCandidatesForPharmacy(
  matchesByPharmacy: Map<number, MatchCandidates> | null,
  pharmacyId: number,
): Promise<MatchCandidates> {
  if (!matchesByPharmacy) {
    return findMatches(pharmacyId);
  }

  if (!matchesByPharmacy.has(pharmacyId)) {
    return findMatches(pharmacyId);
  }

  return matchesByPharmacy.get(pharmacyId) ?? [];
}

function buildQueuedJobState(
  uploadType: MatchingRefreshUploadType,
  scheduledAtIso: string,
  nowIso: string,
): {
  uploadType: MatchingRefreshUploadType;
  attempts: number;
  processingStartedAt: null;
  nextRetryAt: string;
  lastError: null;
  updatedAt: string;
} {
  return {
    uploadType,
    attempts: 0,
    processingStartedAt: null,
    nextRetryAt: scheduledAtIso,
    lastError: null,
    updatedAt: nowIso,
  };
}

async function deleteRefreshJobsByIds(
  executor: JobQueueExecutor,
  jobIds: number[],
): Promise<void> {
  if (jobIds.length === 0) return;

  await executor.delete(matchingRefreshJobs)
    .where(inArray(matchingRefreshJobs.id, jobIds));
}

function logRefreshJobAttemptOutcome(job: RefreshJob, nextAttempts: number, errorMessage: string): void {
  if (nextAttempts >= MAX_JOB_ATTEMPTS) {
    logger.error('Matching refresh job reached max attempts', {
      jobId: job.id,
      triggerPharmacyId: job.triggerPharmacyId,
      uploadType: job.uploadType,
      attempts: nextAttempts,
      error: errorMessage,
    });
    return;
  }

  logger.warn('Matching refresh job attempt failed and will retry later', {
    jobId: job.id,
    triggerPharmacyId: job.triggerPharmacyId,
    uploadType: job.uploadType,
    attempts: nextAttempts,
    error: errorMessage,
  });
}

async function persistSnapshotEntries(
  snapshotEntries: SnapshotEntry[],
  triggerPharmacyId: number,
  uploadType: MatchingRefreshUploadType,
  failedPharmacyIds: number[],
): Promise<number> {
  if (snapshotEntries.length === 0) return 0;

  try {
    const { changedCount } = await saveMatchSnapshotsBatch(snapshotEntries);
    return changedCount;
  } catch (batchSaveErr) {
    logger.warn('Batch snapshot save failed, falling back to per-pharmacy', {
      triggerPharmacyId,
      uploadType,
      chunkSize: snapshotEntries.length,
      error: getErrorMessage(batchSaveErr),
    });

    let changedCount = 0;
    const CONCURRENCY = 5;
    for (let i = 0; i < snapshotEntries.length; i += CONCURRENCY) {
      const batch = snapshotEntries.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(entry => saveMatchSnapshotAndNotifyOnChange(entry))
      );
      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          const entry = batch[idx];
          recordPharmacyRefreshFailure(failedPharmacyIds, entry.pharmacyId, triggerPharmacyId, uploadType, result.reason);
        } else if (result.value.changed) {
          changedCount += 1;
        }
      });
    }
    return changedCount;
  }
}

async function runSingleRefresh(triggerPharmacyId: number, uploadType: MatchingRefreshUploadType): Promise<void> {
  const impactedIds = await resolveImpactedPharmacyIds(triggerPharmacyId);
  let changedCount = 0;
  const failedPharmacyIds: number[] = [];
  const notifyEnabledMap = await fetchNotifyEnabledMap(impactedIds);

  for (const pharmacyIdChunk of splitIntoChunks(impactedIds, REFRESH_MATCH_BATCH_SIZE)) {
    const snapshotEntries = await buildSnapshotEntries(
      pharmacyIdChunk,
      triggerPharmacyId,
      uploadType,
      notifyEnabledMap,
      failedPharmacyIds,
    );
    changedCount += await persistSnapshotEntries(
      snapshotEntries,
      triggerPharmacyId,
      uploadType,
      failedPharmacyIds,
    );
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

  const triggerSnapshot = await db.select({ candidateCount: matchCandidateSnapshots.candidateCount })
    .from(matchCandidateSnapshots)
    .where(eq(matchCandidateSnapshots.pharmacyId, triggerPharmacyId))
    .limit(1);
  const candidateCount = triggerSnapshot[0]?.candidateCount ?? 0;

  await createNotification({
    pharmacyId: triggerPharmacyId,
    type: 'matching_refresh_complete',
    title: 'マッチング更新完了',
    message: `${candidateCount}件の候補が見つかりました`,
    detailJson: { candidateCount, refreshedAt: new Date().toISOString() },
  });
}

async function selectClaimCandidate(
  conditions: ClaimConditions,
): Promise<RefreshJob | null> {
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

  return candidate ?? null;
}

async function claimCandidateWithCas(
  candidate: RefreshJob,
  nowIso: string,
  baseConditions: ClaimConditions,
): Promise<RefreshJob | null> {
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

  return claimed ?? null;
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

    const candidate = await selectClaimCandidate(conditions);
    if (!candidate) return null;

    const claimed = await claimCandidateWithCas(candidate, nowIso, baseConditions);
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

    logRefreshJobAttemptOutcome(job, nextAttempts, errorMessage);

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
    if (!success) {
      failedInThisRun.push(job.id);
      continue;
    }

    processed += 1;
  }

  return processed;
}

export async function processPendingMatchingRefreshJobs(limit: number = RETRY_BATCH_SIZE): Promise<number> {
  if (!AUTO_RECOMPUTE_ENABLED) return 0;
  const processed = await processPendingRefreshJobs(limit);
  if (processed > 0) {
    await refreshDrugAvailabilitySummary();
  }
  return processed;
}

async function withTransactionExecutor<T>(
  executor: JobQueueExecutor,
  action: (tx: JobQueueExecutor) => Promise<T>,
): Promise<T> {
  if (executor !== db) {
    return action(executor);
  }

  return db.transaction(async (tx) => action(tx as unknown as JobQueueExecutor));
}

async function listWaitingJobsForTrigger(
  executor: JobQueueExecutor,
  triggerPharmacyId: number,
): Promise<WaitingRefreshJob[]> {
  return executor.select({
    id: matchingRefreshJobs.id,
    processingStartedAt: matchingRefreshJobs.processingStartedAt,
    attempts: matchingRefreshJobs.attempts,
  })
    .from(matchingRefreshJobs)
    .where(and(
      eq(matchingRefreshJobs.triggerPharmacyId, triggerPharmacyId),
      lt(matchingRefreshJobs.attempts, MAX_JOB_ATTEMPTS),
    ))
    .orderBy(
      asc(matchingRefreshJobs.createdAt),
      asc(matchingRefreshJobs.id),
    );
}

function selectWaitingRows(existingRows: WaitingRefreshJob[], staleBeforeIso: string): WaitingRefreshJob[] {
  return existingRows.filter((row) => (
    row.processingStartedAt === null || row.processingStartedAt < staleBeforeIso
  ));
}

async function reuseKeeperJob(
  executor: JobQueueExecutor,
  keeper: WaitingRefreshJob,
  waitingRows: WaitingRefreshJob[],
  uploadType: MatchingRefreshUploadType,
  scheduledAtIso: string,
  nowIso: string,
): Promise<void> {
  await executor.update(matchingRefreshJobs)
    .set(buildQueuedJobState(uploadType, scheduledAtIso, nowIso))
    .where(eq(matchingRefreshJobs.id, keeper.id));

  const redundantIds = waitingRows.slice(1).map((row) => row.id);
  await deleteRefreshJobsByIds(executor, redundantIds);
}

async function insertRefreshJob(
  executor: JobQueueExecutor,
  params: { triggerPharmacyId: number; uploadType: MatchingRefreshUploadType },
  scheduledAtIso: string,
  nowIso: string,
): Promise<void> {
  await executor.insert(matchingRefreshJobs).values({
    triggerPharmacyId: params.triggerPharmacyId,
    ...buildQueuedJobState(params.uploadType, scheduledAtIso, nowIso),
  });
}

export async function triggerMatchingRefreshOnUpload(params: {
  triggerPharmacyId: number;
  uploadType: MatchingRefreshUploadType;
}, executor: JobQueueExecutor = db): Promise<void> {
  if (!AUTO_RECOMPUTE_ENABLED) return;

  await withTransactionExecutor(executor, async (tx) => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const scheduledAtIso = new Date(now + MATCHING_REFRESH_DEBOUNCE_MS).toISOString();
    const staleBeforeIso = getStaleBeforeIso(JOB_STALE_TIMEOUT_MS);

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${MATCHING_REFRESH_TRIGGER_LOCK_NAMESPACE}, ${params.triggerPharmacyId})`,
    );

    const existingRows = await listWaitingJobsForTrigger(tx, params.triggerPharmacyId);
    const waitingRows = selectWaitingRows(existingRows, staleBeforeIso);
    const keeper = waitingRows[0];

    if (keeper) {
      await reuseKeeperJob(tx, keeper, waitingRows, params.uploadType, scheduledAtIso, nowIso);
      return;
    }

    await insertRefreshJob(tx, params, scheduledAtIso, nowIso);
  });
}

export interface MatchingRefreshStats {
  lastRefreshAt: string | null;
  totalRefreshes: number;
  pendingJobs: number;
  averageRefreshDuration: number | null;
}

export async function getMatchingRefreshStats(): Promise<MatchingRefreshStats> {
  const [jobStats] = await db.select({
    totalRefreshes: count(matchingRefreshJobs.id),
    pendingJobs: sql<number>`count(*) filter (where ${matchingRefreshJobs.processingStartedAt} is null)`,
    lastRefreshAt: max(matchingRefreshJobs.updatedAt),
    minCreatedAt: min(matchingRefreshJobs.createdAt),
    maxUpdatedAt: max(matchingRefreshJobs.updatedAt),
  }).from(matchingRefreshJobs);

  const totalRefreshes = jobStats?.totalRefreshes ?? 0;
  const pendingJobs = jobStats?.pendingJobs ?? 0;
  const lastRefreshAt = jobStats?.lastRefreshAt ?? null;

  let averageRefreshDuration: number | null = null;
  if (jobStats?.minCreatedAt && jobStats?.maxUpdatedAt && totalRefreshes > 0) {
    const durationMs = new Date(jobStats.maxUpdatedAt).getTime() - new Date(jobStats.minCreatedAt).getTime();
    averageRefreshDuration = Math.round(durationMs / totalRefreshes);
  }

  return { lastRefreshAt, totalRefreshes, pendingJobs, averageRefreshDuration };
}

export const __testables = {
  claimNextRefreshJob,
  runSingleRefresh,
  splitIntoChunks,
};
