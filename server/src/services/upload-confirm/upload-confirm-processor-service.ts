import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { promisify } from 'util';
import { gunzip } from 'zlib';
import { db } from '../../config/database';
import { uploadConfirmJobs } from '../../db/schema';
import {
  type ColumnMapping,
  DEAD_STOCK_FIELDS,
  USED_MEDICATION_FIELDS,
} from '../../types';
import { getNextRetryIso } from '../../utils/job-retry-utils';
import { logger } from '../logger';
import {
  runUploadConfirm,
  type UploadType,
} from '../upload-confirm-service';
import {
  clearUploadRowIssuesForJob,
} from '../upload-row-issue-service';
import { parseExcelBuffer } from '../upload-service';
import {
  assertJobNotCancellationRequested,
  fetchUploadConfirmJobById,
} from './upload-confirm-query-service';
import {
  CANCELLED_JOB_MESSAGE,
  CLEARED_FILE_PAYLOAD,
  COMPRESSED_PAYLOAD_PREFIX,
  MAX_JOB_ATTEMPTS,
  MAX_MAPPING_COLUMN_INDEX,
  RETRY_BACKOFF_BASE_MS,
  UploadConfirmJobProcessingError,
  createUploadConfirmJobError,
  formatJobErrorMessage,
  parseJobErrorCode,
  stripJobErrorCodePrefix,
  type UploadConfirmJobClassifiedError,
  type UploadConfirmJobRuntime,
} from './upload-confirm-types';

const gunzipAsync = promisify(gunzip);

async function decodeUploadJobFilePayload(filePayload: string): Promise<Buffer> {
  if (!filePayload) {
    throw createUploadConfirmJobError(
      'FILE_PAYLOAD_MISSING',
      'ジョブのアップロードファイルが見つかりません',
      false,
    );
  }

  if (!filePayload.startsWith(COMPRESSED_PAYLOAD_PREFIX)) {
    return Buffer.from(filePayload, 'base64');
  }

  const compressedBase64 = filePayload.slice(COMPRESSED_PAYLOAD_PREFIX.length);
  if (!compressedBase64) {
    throw createUploadConfirmJobError(
      'FILE_PAYLOAD_MISSING',
      'ジョブのアップロードファイルが見つかりません',
      false,
    );
  }

  try {
    const compressedBuffer = Buffer.from(compressedBase64, 'base64');
    return await gunzipAsync(compressedBuffer);
  } catch {
    throw createUploadConfirmJobError(
      'FILE_PARSE_FAILED',
      'アップロードファイルを解析できませんでした',
      false,
    );
  }
}

async function finalizeCancelRequestedJob(jobId: number, nowIso: string): Promise<void> {
  await db.update(uploadConfirmJobs)
    .set({
      status: 'failed',
      lastError: formatJobErrorMessage('JOB_CANCELED', CANCELLED_JOB_MESSAGE),
      nextRetryAt: null,
      processingStartedAt: null,
      fileBase64: CLEARED_FILE_PAYLOAD,
      canceledAt: sql<string>`coalesce(${uploadConfirmJobs.cancelRequestedAt}, ${nowIso})`,
      completedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(and(
      eq(uploadConfirmJobs.id, jobId),
      isNotNull(uploadConfirmJobs.cancelRequestedAt),
      isNull(uploadConfirmJobs.canceledAt),
    ));
}

function classifyUploadConfirmJobError(err: unknown): UploadConfirmJobClassifiedError {
  if (err instanceof UploadConfirmJobProcessingError) {
    return {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      rawMessage: err.message,
    };
  }

  const rawMessage = err instanceof Error ? err.message : String(err);
  const prefixedCode = parseJobErrorCode(rawMessage);
  if (prefixedCode) {
    return {
      code: prefixedCode,
      message: stripJobErrorCodePrefix(rawMessage),
      retryable: false,
      rawMessage,
    };
  }

  if (/mapping/i.test(rawMessage)) {
    return {
      code: 'MAPPING_INVALID',
      message: 'カラム割り当ての設定が不正です',
      retryable: false,
      rawMessage,
    };
  }
  if (/ヘッダー行指定が不正/.test(rawMessage)) {
    return {
      code: 'HEADER_ROW_INVALID',
      message: 'ヘッダー行指定が不正です',
      retryable: false,
      rawMessage,
    };
  }
  if (/上限\(/.test(rawMessage)) {
    return {
      code: 'FILE_LIMIT_EXCEEDED',
      message: rawMessage,
      retryable: false,
      rawMessage,
    };
  }
  if (
    /ファイルの解析/i.test(rawMessage)
    || /read/i.test(rawMessage)
    || /xlsx/i.test(rawMessage)
    || /zip/i.test(rawMessage)
    || /corrupt/i.test(rawMessage)
  ) {
    return {
      code: 'FILE_PARSE_FAILED',
      message: 'アップロードファイルを解析できませんでした',
      retryable: false,
      rawMessage,
    };
  }
  if (/applyMode/i.test(rawMessage)) {
    return {
      code: 'APPLY_MODE_INVALID',
      message: 'ジョブの適用モードが不正です',
      retryable: false,
      rawMessage,
    };
  }
  if (/uploadType/i.test(rawMessage)) {
    return {
      code: 'UPLOAD_TYPE_INVALID',
      message: 'ジョブのアップロード種別が不正です',
      retryable: false,
      rawMessage,
    };
  }
  if (rawMessage.includes(CANCELLED_JOB_MESSAGE) || /キャンセル/.test(rawMessage) || /cancel/i.test(rawMessage)) {
    return {
      code: 'JOB_CANCELED',
      message: CANCELLED_JOB_MESSAGE,
      retryable: false,
      rawMessage,
    };
  }

  return {
    code: 'UPLOAD_CONFIRM_FAILED',
    message: rawMessage,
    retryable: true,
    rawMessage,
  };
}

function parseStoredMapping(mappingJson: string, uploadType: UploadType): ColumnMapping {
  let parsed: unknown;
  try {
    parsed = JSON.parse(mappingJson);
  } catch {
    throw createUploadConfirmJobError(
      'MAPPING_INVALID',
      'ジョブ内のmapping JSONが不正です',
      false,
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createUploadConfirmJobError(
      'MAPPING_INVALID',
      'ジョブ内のmapping形式が不正です',
      false,
    );
  }

  const allowedFields = uploadType === 'dead_stock'
    ? new Set<string>(DEAD_STOCK_FIELDS)
    : new Set<string>(USED_MEDICATION_FIELDS);

  const mapping = Object.create(null) as ColumnMapping;
  for (const field of allowedFields) {
    mapping[field] = null;
  }

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!allowedFields.has(key)) continue;

    if (value === null) {
      mapping[key] = null;
      continue;
    }

    if (typeof value === 'string' && /^\d{1,3}$/.test(value)) {
      const colIdx = Number(value);
      if (Number.isInteger(colIdx) && colIdx >= 0 && colIdx <= MAX_MAPPING_COLUMN_INDEX) {
        mapping[key] = value;
      }
    }
  }

  if (!mapping.drug_name) {
    throw createUploadConfirmJobError(
      'MAPPING_INVALID',
      'ジョブ内のmappingで薬剤名カラムの割り当てが不足しています',
      false,
    );
  }

  if (uploadType === 'dead_stock' && !mapping.quantity) {
    throw createUploadConfirmJobError(
      'MAPPING_INVALID',
      'ジョブ内のmappingで数量カラムの割り当てが不足しています',
      false,
    );
  }

  return mapping;
}

function buildFailedJobUpdatePayload(
  nextAttempts: number,
  classified: UploadConfirmJobClassifiedError,
  nowIso: string,
): Partial<typeof uploadConfirmJobs.$inferInsert> {
  const terminal = !classified.retryable || nextAttempts >= MAX_JOB_ATTEMPTS;
  const payload: Partial<typeof uploadConfirmJobs.$inferInsert> = {
    status: terminal ? 'failed' : 'pending',
    attempts: nextAttempts,
    lastError: formatJobErrorMessage(classified.code, classified.message),
    processingStartedAt: null,
    nextRetryAt: terminal ? null : getNextRetryIso(nextAttempts, MAX_JOB_ATTEMPTS, RETRY_BACKOFF_BASE_MS),
    updatedAt: nowIso,
  };

  if (terminal) {
    payload.completedAt = nowIso;
    if (classified.code === 'JOB_CANCELED') {
      payload.cancelRequestedAt = nowIso;
      payload.canceledAt = nowIso;
    }
  }

  return payload;
}

function logUploadConfirmJobFailure(
  job: UploadConfirmJobRuntime,
  nextAttempts: number,
  classified: UploadConfirmJobClassifiedError,
): void {
  const logMeta = {
    jobId: job.id,
    pharmacyId: job.pharmacyId,
    attempts: nextAttempts,
    error: classified.rawMessage,
    code: classified.code,
  };

  if (!classified.retryable) {
    logger.warn('Upload confirm job failed as non-retryable', logMeta);
    return;
  }

  if (nextAttempts >= MAX_JOB_ATTEMPTS) {
    logger.error('Upload confirm job reached max attempts', logMeta);
    return;
  }

  logger.warn('Upload confirm job failed and will retry', logMeta);
}

export async function processClaimedUploadConfirmJob(job: UploadConfirmJobRuntime): Promise<void> {
  try {
    await clearUploadRowIssuesForJob(job.id);
    await assertJobNotCancellationRequested(job.id);

    const mapping = parseStoredMapping(job.mappingJson, job.uploadType);
    const payloadBuffer = await decodeUploadJobFilePayload(job.fileBase64);
    let allRows: unknown[][];
    try {
      allRows = await parseExcelBuffer(payloadBuffer);
    } catch {
      throw createUploadConfirmJobError(
        'FILE_PARSE_FAILED',
        'アップロードファイルを解析できませんでした',
        false,
      );
    }

    await assertJobNotCancellationRequested(job.id);

    const result = await runUploadConfirm({
      pharmacyId: job.pharmacyId,
      uploadType: job.uploadType,
      originalFilename: job.originalFilename,
      jobId: job.id,
      headerRowIndex: job.headerRowIndex,
      mapping,
      allRows,
      applyMode: job.applyMode,
      deleteMissing: job.deleteMissing,
      staleGuardCreatedAt: job.createdAt,
    });

    const responsePayload = {
      uploadId: result.uploadId,
      rowCount: result.rowCount,
      applyMode: job.applyMode,
      deleteMissing: job.applyMode === 'diff' ? job.deleteMissing : undefined,
      diffSummary: job.applyMode === 'diff' ? result.diffSummary : undefined,
      partialSummary: job.applyMode === 'partial' ? result.partialSummary : undefined,
      errorReportAvailable: job.applyMode === 'partial'
        ? (result.partialSummary?.rejectedRows ?? 0) > 0
        : false,
    };

    const nowIso = new Date().toISOString();
    const [completed] = await db.update(uploadConfirmJobs)
      .set({
        status: 'completed',
        lastError: null,
        resultJson: JSON.stringify(responsePayload),
        fileBase64: CLEARED_FILE_PAYLOAD,
        processingStartedAt: null,
        cancelRequestedAt: null,
        canceledAt: null,
        canceledBy: null,
        completedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(and(
        eq(uploadConfirmJobs.id, job.id),
        eq(uploadConfirmJobs.status, 'processing'),
        isNull(uploadConfirmJobs.cancelRequestedAt),
        isNull(uploadConfirmJobs.canceledAt),
      ))
      .returning({ id: uploadConfirmJobs.id });

    if (!completed) {
      await finalizeCancelRequestedJob(job.id, nowIso);
    }
  } catch (err) {
    const nextAttempts = job.attempts + 1;
    const classified = classifyUploadConfirmJobError(err);
    const nowIso = new Date().toISOString();
    const updatePayload = buildFailedJobUpdatePayload(nextAttempts, classified, nowIso);

    const [updated] = await db.update(uploadConfirmJobs)
      .set(updatePayload)
      .where(and(
        eq(uploadConfirmJobs.id, job.id),
        eq(uploadConfirmJobs.status, 'processing'),
        isNull(uploadConfirmJobs.cancelRequestedAt),
        isNull(uploadConfirmJobs.canceledAt),
      ))
      .returning({ id: uploadConfirmJobs.id });

    if (!updated) {
      await finalizeCancelRequestedJob(job.id, nowIso);
      const latest = await fetchUploadConfirmJobById(job.id);
      if (!latest || latest.canceledAt || latest.cancelRequestedAt || latest.status === 'completed') {
        return;
      }
    }

    logUploadConfirmJobFailure(job, nextAttempts, classified);
  }
}
