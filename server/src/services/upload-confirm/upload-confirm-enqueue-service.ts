import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { promisify } from 'util';
import { gzip } from 'zlib';
import { db } from '../../config/database';
import { uploadJobs } from '../../db/schema';
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
  type UploadConfirmJobStatus,
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

function buildEnqueueResult(row: {
  id: number;
  status: UploadConfirmJobStatus;
  canceledAt: string | null;
  cancelRequestedAt: string | null;
}, deduplicated: boolean): EnqueueUploadConfirmJobResult {
  return {
    jobId: row.id,
    status: row.status,
    deduplicated,
    cancelable: isJobCancelable(row.status, row.cancelRequestedAt, row.canceledAt),
    canceledAt: row.canceledAt,
  };
}

function buildNewUploadConfirmJobValues(
  params: EnqueueUploadConfirmJobParams,
  fileHash: string,
  mappingJson: unknown,
  encodedPayload: string,
  requestedAtIso: string,
  nowIso: string,
) {
  return {
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
    status: 'pending' as const,
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
  };
}

function ensureIdempotentPayloadMatch(
  existing: UploadConfirmJobRecord,
  input: {
    uploadType: EnqueueUploadConfirmJobParams['uploadType'];
    fileHash: string;
    headerRowIndex: number;
    mappingJson: unknown;
    applyMode: EnqueueUploadConfirmJobParams['applyMode'];
    deleteMissing: boolean;
  },
): void {
  const matched = existing.uploadType === input.uploadType
    && existing.fileHash === input.fileHash
    && existing.headerRowIndex === input.headerRowIndex
    && JSON.stringify(existing.mappingJson) === JSON.stringify(input.mappingJson)
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

  return db.transaction(async (tx) => {
    await lockUploadConfirmQueueCapacity(params.pharmacyId, tx);

    if (params.idempotencyKey) {
      const existing = await findJobByIdempotencyKey(params.pharmacyId, params.idempotencyKey, tx);
      if (existing) {
        ensureIdempotentPayloadMatch(existing, {
          uploadType: params.uploadType,
          fileHash,
          headerRowIndex: params.headerRowIndex,
          mappingJson: params.mapping,
          applyMode: params.applyMode,
          deleteMissing: params.deleteMissing,
        });

        if (!existing.deduplicated) {
          await tx.update(uploadJobs)
            .set({
              deduplicated: true,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(uploadJobs.id, existing.id));
        }

        return buildEnqueueResult(existing, true);
      }
    }

    await assertUploadConfirmQueueCapacity(params.pharmacyId, tx);

    const encodedPayload = await encodeUploadJobFilePayload(params.fileBuffer);
    const nowIso = new Date().toISOString();
    const requestedAtIso = params.requestedAtIso ?? nowIso;

    const [job] = await tx.insert(uploadJobs).values(
      buildNewUploadConfirmJobValues(params, fileHash, params.mapping, encodedPayload, requestedAtIso, nowIso),
    ).returning({
      id: uploadJobs.id,
      status: uploadJobs.status,
      canceledAt: uploadJobs.canceledAt,
      cancelRequestedAt: uploadJobs.cancelRequestedAt,
    });

    return buildEnqueueResult(job, false);
  });
}
