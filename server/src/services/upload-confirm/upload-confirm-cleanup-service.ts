import {
  and,
  asc,
  inArray,
  lte,
} from 'drizzle-orm';
import { db } from '../../config/database';
import { uploadConfirmJobs } from '../../db/schema';
import { parseBoundedInt } from '../../utils/number-utils';
import {
  DEFAULT_CLEANUP_BATCH_SIZE,
  DEFAULT_CLEANUP_RETENTION_DAYS,
  FINISHED_JOB_STATUSES,
} from './upload-confirm-types';

function getCleanupRetentionDays(): number {
  return parseBoundedInt(
    process.env.UPLOAD_CONFIRM_JOB_RETENTION_DAYS,
    DEFAULT_CLEANUP_RETENTION_DAYS,
    1,
    365,
  );
}

function getCleanupBatchSize(): number {
  return parseBoundedInt(
    process.env.UPLOAD_CONFIRM_JOB_CLEANUP_BATCH_SIZE,
    DEFAULT_CLEANUP_BATCH_SIZE,
    1,
    1000,
  );
}

export async function cleanupUploadConfirmJobs(limit: number = getCleanupBatchSize()): Promise<number> {
  if (!Number.isInteger(limit) || limit <= 0) {
    return 0;
  }

  const retentionDays = getCleanupRetentionDays();
  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const staleRows = await db.select({
    id: uploadConfirmJobs.id,
  })
    .from(uploadConfirmJobs)
    .where(and(
      inArray(uploadConfirmJobs.status, FINISHED_JOB_STATUSES),
      lte(uploadConfirmJobs.updatedAt, cutoffIso),
    ))
    .orderBy(
      asc(uploadConfirmJobs.updatedAt),
      asc(uploadConfirmJobs.id),
    )
    .limit(limit);

  if (staleRows.length === 0) {
    return 0;
  }

  const staleIds = staleRows.map((row) => row.id);
  await db.delete(uploadConfirmJobs).where(inArray(uploadConfirmJobs.id, staleIds));
  return staleIds.length;
}
