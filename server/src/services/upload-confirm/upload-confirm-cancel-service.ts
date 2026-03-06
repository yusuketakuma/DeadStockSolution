import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../config/database';
import { uploadConfirmJobs } from '../../db/schema';
import {
  fetchUploadConfirmJobById,
  normalizeJobStatus,
} from './upload-confirm-query-service';
import {
  CANCELLED_JOB_MESSAGE,
  formatJobErrorMessage,
  isCancelableStatus,
  isJobCancelable,
  type CancelUploadConfirmJobResult,
  type UploadConfirmJobRecord,
} from './upload-confirm-types';

function toCancelResult(
  row: { id: number; status: string; canceledAt: string | null; cancelRequestedAt: string | null },
): CancelUploadConfirmJobResult {
  const status = normalizeJobStatus(row.status);
  return {
    id: row.id,
    status,
    canceledAt: row.canceledAt,
    cancelRequestedAt: row.cancelRequestedAt,
    cancelable: isJobCancelable(status, row.cancelRequestedAt, row.canceledAt),
  };
}

const CANCEL_RETURNING_COLUMNS = {
  id: uploadConfirmJobs.id,
  status: uploadConfirmJobs.status,
  canceledAt: uploadConfirmJobs.canceledAt,
  cancelRequestedAt: uploadConfirmJobs.cancelRequestedAt,
} as const;

function buildCancelUpdatePayload(
  existing: UploadConfirmJobRecord,
  canceledBy: number,
  nowIso: string,
): Partial<typeof uploadConfirmJobs.$inferInsert> {
  if (existing.status === 'pending') {
    return {
      status: 'failed',
      cancelRequestedAt: existing.cancelRequestedAt ?? nowIso,
      canceledAt: nowIso,
      canceledBy,
      lastError: formatJobErrorMessage('JOB_CANCELED', CANCELLED_JOB_MESSAGE),
      nextRetryAt: null,
      processingStartedAt: null,
      completedAt: nowIso,
      updatedAt: nowIso,
    };
  }

  return {
    cancelRequestedAt: existing.cancelRequestedAt ?? nowIso,
    canceledBy,
    updatedAt: nowIso,
  };
}

async function cancelJobCore(
  jobId: number,
  canceledBy: number,
  options: { requirePharmacyId?: number },
): Promise<CancelUploadConfirmJobResult | null> {
  return db.transaction(async (tx) => {
    const existing = await fetchUploadConfirmJobById(jobId, tx);
    if (!existing) return null;
    if (options.requirePharmacyId !== undefined && existing.pharmacyId !== options.requirePharmacyId) {
      return null;
    }

    if (!isCancelableStatus(existing.status)) {
      return toCancelResult(existing);
    }

    const nowIso = new Date().toISOString();
    const ownerConditions = options.requirePharmacyId !== undefined
      ? [eq(uploadConfirmJobs.pharmacyId, options.requirePharmacyId)]
      : [];

    const [updated] = await tx.update(uploadConfirmJobs)
      .set(buildCancelUpdatePayload(existing, canceledBy, nowIso))
      .where(and(
        eq(uploadConfirmJobs.id, existing.id),
        ...ownerConditions,
        eq(uploadConfirmJobs.status, existing.status),
        isNull(uploadConfirmJobs.canceledAt),
      ))
      .returning(CANCEL_RETURNING_COLUMNS);

    if (!updated) {
      const latest = await fetchUploadConfirmJobById(jobId, tx);
      if (!latest) return null;
      if (options.requirePharmacyId !== undefined && latest.pharmacyId !== options.requirePharmacyId) {
        return null;
      }
      if (isJobCancelable(latest.status, latest.cancelRequestedAt, latest.canceledAt)) {
        const [retryRequested] = await tx.update(uploadConfirmJobs)
          .set({
            cancelRequestedAt: nowIso,
            canceledBy,
            updatedAt: nowIso,
          })
          .where(and(
            eq(uploadConfirmJobs.id, latest.id),
            ...ownerConditions,
            eq(uploadConfirmJobs.status, latest.status),
            isNull(uploadConfirmJobs.cancelRequestedAt),
            isNull(uploadConfirmJobs.canceledAt),
          ))
          .returning(CANCEL_RETURNING_COLUMNS);

        if (retryRequested) {
          return toCancelResult(retryRequested);
        }
      }
      return toCancelResult(latest);
    }

    return toCancelResult(updated);
  });
}

export async function cancelUploadConfirmJobByAdmin(
  jobId: number,
  adminPharmacyId: number,
): Promise<CancelUploadConfirmJobResult | null> {
  return cancelJobCore(jobId, adminPharmacyId, {});
}

export async function cancelUploadConfirmJobForPharmacy(
  jobId: number,
  pharmacyId: number,
): Promise<CancelUploadConfirmJobResult | null> {
  return cancelJobCore(jobId, pharmacyId, { requirePharmacyId: pharmacyId });
}
