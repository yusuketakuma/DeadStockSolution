import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../../config/database';
import { uploadJobs } from '../../db/schema';
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

function assertJobRetryable(existing: { status: string; fileBase64: string | null }): void {
  if (!(existing.status === 'failed' || existing.status === 'completed')) {
    throw createRetryUnavailableError('再試行できるのは completed / failed 状態のジョブのみです');
  }

  if (!existing.fileBase64) {
    throw createRetryUnavailableError('元ファイルが保持されていないため再試行できません');
  }
}

function buildRetryResetPayload(nowIso: string) {
  return {
    status: 'pending' as const,
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
  };
}

export async function retryUploadConfirmJobByAdmin(jobId: number): Promise<RetryUploadConfirmJobResult | null> {
  return db.transaction(async (tx) => {
    const existing = await fetchUploadConfirmJobById(jobId, tx);
    if (!existing) {
      return null;
    }

    assertJobRetryable(existing);

    if (existing.idempotencyKey) {
      const [activeWithSameKey] = await tx.select({
        id: uploadJobs.id,
      })
        .from(uploadJobs)
        .where(and(
          eq(uploadJobs.pharmacyId, existing.pharmacyId),
          eq(uploadJobs.idempotencyKey, existing.idempotencyKey),
          ne(uploadJobs.id, existing.id),
          inArray(uploadJobs.status, ACTIVE_JOB_STATUSES),
        ))
        .limit(1);

      if (activeWithSameKey) {
        throw createRetryUnavailableError('同じ idempotencyKey の進行中ジョブがあるため再試行できません');
      }
    }

    await assertUploadConfirmQueueCapacityWithLocks(existing.pharmacyId, tx);

    const nowIso = new Date().toISOString();
    await clearUploadRowIssuesForJob(existing.id, tx);

    const [updated] = await tx.update(uploadJobs)
      .set(buildRetryResetPayload(nowIso))
      .where(eq(uploadJobs.id, existing.id))
      .returning({
        id: uploadJobs.id,
        status: uploadJobs.status,
        canceledAt: uploadJobs.canceledAt,
        cancelRequestedAt: uploadJobs.cancelRequestedAt,
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
