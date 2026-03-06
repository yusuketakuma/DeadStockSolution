import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../../config/database';
import { uploadConfirmJobs } from '../../db/schema';
import { clearUploadRowIssuesForJob } from '../upload-row-issue-service';
import {
  assertUploadConfirmQueueCapacityWithLocks,
  fetchUploadConfirmJobById,
} from './upload-confirm-query-service';
import {
  ACTIVE_JOB_STATUSES,
  createRetryUnavailableError,
  isJobCancelable,
  type RetryUploadConfirmJobResult,
} from './upload-confirm-types';

export async function retryUploadConfirmJobByAdmin(jobId: number): Promise<RetryUploadConfirmJobResult | null> {
  return db.transaction(async (tx) => {
    const existing = await fetchUploadConfirmJobById(jobId, tx);
    if (!existing) {
      return null;
    }

    if (!(existing.status === 'failed' || existing.status === 'completed')) {
      throw createRetryUnavailableError('再試行できるのは completed / failed 状態のジョブのみです');
    }

    if (!existing.fileBase64) {
      throw createRetryUnavailableError('元ファイルが保持されていないため再試行できません');
    }

    if (existing.idempotencyKey) {
      const [activeWithSameKey] = await tx.select({
        id: uploadConfirmJobs.id,
      })
        .from(uploadConfirmJobs)
        .where(and(
          eq(uploadConfirmJobs.pharmacyId, existing.pharmacyId),
          eq(uploadConfirmJobs.idempotencyKey, existing.idempotencyKey),
          ne(uploadConfirmJobs.id, existing.id),
          inArray(uploadConfirmJobs.status, ACTIVE_JOB_STATUSES),
        ))
        .limit(1);

      if (activeWithSameKey) {
        throw createRetryUnavailableError('同じ idempotencyKey の進行中ジョブがあるため再試行できません');
      }
    }

    await assertUploadConfirmQueueCapacityWithLocks(existing.pharmacyId, tx);

    const nowIso = new Date().toISOString();
    await clearUploadRowIssuesForJob(existing.id, tx);

    const [updated] = await tx.update(uploadConfirmJobs)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        resultJson: null,
        deduplicated: false,
        cancelRequestedAt: null,
        canceledAt: null,
        canceledBy: null,
        processingStartedAt: null,
        nextRetryAt: null,
        completedAt: null,
        updatedAt: nowIso,
      })
      .where(eq(uploadConfirmJobs.id, existing.id))
      .returning({
        id: uploadConfirmJobs.id,
        status: uploadConfirmJobs.status,
        canceledAt: uploadConfirmJobs.canceledAt,
        cancelRequestedAt: uploadConfirmJobs.cancelRequestedAt,
      });

    if (!updated) {
      return null;
    }

    return {
      id: updated.id,
      status: updated.status,
      cancelable: isJobCancelable(updated.status, updated.cancelRequestedAt, updated.canceledAt),
      canceledAt: updated.canceledAt,
    };
  });
}
