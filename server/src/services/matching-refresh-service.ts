import { and, asc, eq, exists, gte, isNull, lt, lte, notInArray, or } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, deadStockItems, matchingRefreshJobs, usedMedicationItems, uploads } from '../db/schema';
import { findMatches } from './matching-service';
import { logger } from './logger';
import { saveMatchSnapshotAndNotifyOnChange } from './matching-snapshot-service';
import { parseBooleanFlag } from '../utils/number-utils';

const AUTO_RECOMPUTE_ENABLED = parseBooleanFlag(process.env.MATCHING_AUTO_RECOMPUTE_ENABLED, true);
const MAX_JOB_ATTEMPTS = 5;
const RETRY_BATCH_SIZE = 3;
const JOB_STALE_TIMEOUT_MS = 15 * 60 * 1000;
const RETRY_BACKOFF_BASE_MS = 2 * 60 * 1000;
const CLAIM_CONTENTION_RETRY_LIMIT = 3;

interface RefreshJob {
  id: number;
  triggerPharmacyId: number;
  uploadType: 'dead_stock' | 'used_medication';
  attempts: number;
}

interface JobInsertExecutor {
  insert: typeof db.insert;
}

function getCurrentMonthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function getStaleBeforeIso(): string {
  return new Date(Date.now() - JOB_STALE_TIMEOUT_MS).toISOString();
}

function getNextRetryIso(nextAttempts: number): string | null {
  if (nextAttempts >= MAX_JOB_ATTEMPTS) return null;
  const backoffMs = RETRY_BACKOFF_BASE_MS * Math.max(1, nextAttempts);
  return new Date(Date.now() + backoffMs).toISOString();
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

  for (const pharmacyId of impactedIds) {
    try {
      const candidates = await findMatches(pharmacyId);
      const result = await saveMatchSnapshotAndNotifyOnChange({
        pharmacyId,
        triggerPharmacyId,
        triggerUploadType: uploadType,
        candidates,
      });
      if (result.changed) changedCount += 1;
    } catch (err) {
      failedPharmacyIds.push(pharmacyId);
      logger.error('Matching auto refresh failed for pharmacy', {
        pharmacyId,
        triggerPharmacyId,
        uploadType,
        error: err instanceof Error ? err.message : String(err),
      });
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
    const staleBeforeIso = getStaleBeforeIso();

    const conditions = [
      lt(matchingRefreshJobs.attempts, MAX_JOB_ATTEMPTS),
      or(isNull(matchingRefreshJobs.nextRetryAt), lte(matchingRefreshJobs.nextRetryAt, nowIso)),
      or(isNull(matchingRefreshJobs.processingStartedAt), lt(matchingRefreshJobs.processingStartedAt, staleBeforeIso)),
    ];
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
        lt(matchingRefreshJobs.attempts, MAX_JOB_ATTEMPTS),
        or(isNull(matchingRefreshJobs.nextRetryAt), lte(matchingRefreshJobs.nextRetryAt, nowIso)),
        or(isNull(matchingRefreshJobs.processingStartedAt), lt(matchingRefreshJobs.processingStartedAt, staleBeforeIso)),
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
    const errorMessage = err instanceof Error ? err.message : String(err);
    const nowIso = new Date().toISOString();

    await db.update(matchingRefreshJobs)
      .set({
        attempts: nextAttempts,
        lastError: errorMessage,
        processingStartedAt: null,
        nextRetryAt: getNextRetryIso(nextAttempts),
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
}, executor: JobInsertExecutor = db): Promise<void> {
  if (!AUTO_RECOMPUTE_ENABLED) return;

  await executor.insert(matchingRefreshJobs).values({
    triggerPharmacyId: params.triggerPharmacyId,
    uploadType: params.uploadType,
    attempts: 0,
    processingStartedAt: null,
    nextRetryAt: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  });
}

export const __testables = {
  claimNextRefreshJob,
};
