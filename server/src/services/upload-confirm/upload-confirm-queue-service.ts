import { and, eq, isNull, lt, lte, or } from 'drizzle-orm';
import { db } from '../../config/database';
import { uploadConfirmJobs } from '../../db/schema';
import { getStaleBeforeIso } from '../../utils/job-retry-utils';
import type { ApplyMode } from '../upload-confirm-service';
import { getUploadRowIssueCountByJobId } from '../upload-row-issue-service';
import { processClaimedUploadConfirmJob } from './upload-confirm-processor-service';
import {
  assertUploadConfirmQueueCapacityWithLocks,
  claimPendingUploadConfirmJob,
  fetchUploadConfirmJobById,
} from './upload-confirm-query-service';
import {
  JOB_STALE_TIMEOUT_MS,
  MAX_JOB_ATTEMPTS,
  RETRY_BATCH_SIZE,
  isJobCancelable,
  type UploadConfirmJobView,
} from './upload-confirm-types';

export async function ensureUploadConfirmQueueHasCapacity(pharmacyId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await assertUploadConfirmQueueCapacityWithLocks(pharmacyId, tx);
  });
}

export async function processUploadConfirmJobById(jobId: number): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const staleBeforeIso = getStaleBeforeIso(JOB_STALE_TIMEOUT_MS);
  const [claimed] = await db.update(uploadConfirmJobs)
    .set({
      status: 'processing',
      processingStartedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(and(
      eq(uploadConfirmJobs.id, jobId),
      eq(uploadConfirmJobs.status, 'pending'),
      isNull(uploadConfirmJobs.cancelRequestedAt),
      isNull(uploadConfirmJobs.canceledAt),
      lt(uploadConfirmJobs.attempts, MAX_JOB_ATTEMPTS),
      or(isNull(uploadConfirmJobs.nextRetryAt), lte(uploadConfirmJobs.nextRetryAt, nowIso)),
      or(isNull(uploadConfirmJobs.processingStartedAt), lt(uploadConfirmJobs.processingStartedAt, staleBeforeIso)),
    ))
    .returning({
      id: uploadConfirmJobs.id,
      pharmacyId: uploadConfirmJobs.pharmacyId,
      uploadType: uploadConfirmJobs.uploadType,
      originalFilename: uploadConfirmJobs.originalFilename,
      headerRowIndex: uploadConfirmJobs.headerRowIndex,
      mappingJson: uploadConfirmJobs.mappingJson,
      status: uploadConfirmJobs.status,
      applyMode: uploadConfirmJobs.applyMode,
      deleteMissing: uploadConfirmJobs.deleteMissing,
      fileBase64: uploadConfirmJobs.fileBase64,
      attempts: uploadConfirmJobs.attempts,
      createdAt: uploadConfirmJobs.createdAt,
    });

  if (!claimed) return false;

  if (claimed.applyMode !== 'replace' && claimed.applyMode !== 'diff' && claimed.applyMode !== 'partial') {
    throw new Error(`ジョブ内のapplyModeが不正です: ${claimed.applyMode}`);
  }

  await processClaimedUploadConfirmJob({
    ...claimed,
    status: 'processing',
    applyMode: claimed.applyMode as ApplyMode,
  });
  return true;
}

export async function processPendingUploadConfirmJobs(limit: number = RETRY_BATCH_SIZE): Promise<number> {
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), RETRY_BATCH_SIZE);
  let processed = 0;
  for (let i = 0; i < normalizedLimit; i += 1) {
    const job = await claimPendingUploadConfirmJob();
    if (!job) break;
    await processClaimedUploadConfirmJob(job);
    processed += 1;
  }
  return processed;
}

export async function getUploadConfirmJobById(jobId: number): Promise<UploadConfirmJobView | null> {
  const row = await fetchUploadConfirmJobById(jobId);
  if (!row) {
    return null;
  }

  const issueCount = await getUploadRowIssueCountByJobId(row.id);
  return {
    id: row.id,
    pharmacyId: row.pharmacyId,
    uploadType: row.uploadType,
    originalFilename: row.originalFilename,
    idempotencyKey: row.idempotencyKey,
    fileHash: row.fileHash,
    status: row.status,
    applyMode: row.applyMode,
    deleteMissing: row.deleteMissing,
    attempts: row.attempts,
    lastError: row.lastError,
    resultJson: row.resultJson,
    deduplicated: row.deduplicated,
    cancelRequestedAt: row.cancelRequestedAt,
    canceledAt: row.canceledAt,
    canceledBy: row.canceledBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    issueCount,
    cancelable: isJobCancelable(row.status, row.cancelRequestedAt, row.canceledAt),
  };
}

export async function getUploadConfirmJobForPharmacy(jobId: number, pharmacyId: number): Promise<UploadConfirmJobView | null> {
  const row = await getUploadConfirmJobById(jobId);
  if (!row) return null;
  if (row.pharmacyId !== pharmacyId) return null;
  return row;
}
