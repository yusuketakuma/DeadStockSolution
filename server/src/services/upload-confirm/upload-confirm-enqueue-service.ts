import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { promisify } from 'util';
import { gzip } from 'zlib';
import { db } from '../../config/database';
import { uploadConfirmJobs } from '../../db/schema';
import {
  assertUploadConfirmQueueCapacity,
  findJobByIdempotencyKey,
  lockUploadConfirmQueueCapacity,
} from './upload-confirm-query-service';
import {
  COMPRESSED_PAYLOAD_PREFIX,
  createIdempotencyConflictError,
  isJobCancelable,
  type EnqueueUploadConfirmJobParams,
  type EnqueueUploadConfirmJobResult,
  type UploadConfirmJobRecord,
} from './upload-confirm-types';

const gzipAsync = promisify(gzip);

function computeFileHash(fileBuffer: Buffer): string {
  return createHash('sha256').update(fileBuffer).digest('hex');
}

async function encodeUploadJobFilePayload(fileBuffer: Buffer): Promise<string> {
  const compressed = await gzipAsync(fileBuffer);
  return `${COMPRESSED_PAYLOAD_PREFIX}${compressed.toString('base64')}`;
}

function ensureIdempotentPayloadMatch(
  existing: UploadConfirmJobRecord,
  input: {
    uploadType: EnqueueUploadConfirmJobParams['uploadType'];
    fileHash: string;
    headerRowIndex: number;
    mappingJson: string;
    applyMode: EnqueueUploadConfirmJobParams['applyMode'];
    deleteMissing: boolean;
  },
): void {
  const matched = existing.uploadType === input.uploadType
    && existing.fileHash === input.fileHash
    && existing.headerRowIndex === input.headerRowIndex
    && existing.mappingJson === input.mappingJson
    && existing.applyMode === input.applyMode
    && existing.deleteMissing === input.deleteMissing;

  if (!matched) {
    throw createIdempotencyConflictError();
  }
}

export async function enqueueUploadConfirmJob(
  params: EnqueueUploadConfirmJobParams,
): Promise<EnqueueUploadConfirmJobResult> {
  const fileHash = computeFileHash(params.fileBuffer);
  const mappingJson = JSON.stringify(params.mapping);

  return db.transaction(async (tx) => {
    await lockUploadConfirmQueueCapacity(params.pharmacyId, tx);

    if (params.idempotencyKey) {
      const existing = await findJobByIdempotencyKey(params.pharmacyId, params.idempotencyKey, tx);
      if (existing) {
        ensureIdempotentPayloadMatch(existing, {
          uploadType: params.uploadType,
          fileHash,
          headerRowIndex: params.headerRowIndex,
          mappingJson,
          applyMode: params.applyMode,
          deleteMissing: params.deleteMissing,
        });

        if (!existing.deduplicated) {
          await tx.update(uploadConfirmJobs)
            .set({
              deduplicated: true,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(uploadConfirmJobs.id, existing.id));
        }

        return {
          jobId: existing.id,
          status: existing.status,
          deduplicated: true,
          cancelable: isJobCancelable(existing.status, existing.cancelRequestedAt, existing.canceledAt),
          canceledAt: existing.canceledAt,
        };
      }
    }

    await assertUploadConfirmQueueCapacity(params.pharmacyId, tx);

    const encodedPayload = await encodeUploadJobFilePayload(params.fileBuffer);
    const nowIso = new Date().toISOString();
    const requestedAtIso = params.requestedAtIso ?? nowIso;

    const [job] = await tx.insert(uploadConfirmJobs).values({
      pharmacyId: params.pharmacyId,
      uploadType: params.uploadType,
      originalFilename: params.originalFilename,
      idempotencyKey: params.idempotencyKey ?? null,
      fileHash,
      headerRowIndex: params.headerRowIndex,
      mappingJson,
      applyMode: params.applyMode,
      deleteMissing: params.deleteMissing,
      deduplicated: false,
      fileBase64: encodedPayload,
      status: 'pending',
      attempts: 0,
      lastError: null,
      resultJson: null,
      cancelRequestedAt: null,
      canceledAt: null,
      canceledBy: null,
      processingStartedAt: null,
      nextRetryAt: null,
      completedAt: null,
      createdAt: requestedAtIso,
      updatedAt: nowIso,
    }).returning({
      id: uploadConfirmJobs.id,
      status: uploadConfirmJobs.status,
      canceledAt: uploadConfirmJobs.canceledAt,
      cancelRequestedAt: uploadConfirmJobs.cancelRequestedAt,
    });

    return {
      jobId: job.id,
      status: job.status,
      deduplicated: false,
      cancelable: isJobCancelable(job.status, job.cancelRequestedAt, job.canceledAt),
      canceledAt: job.canceledAt,
    };
  });
}
