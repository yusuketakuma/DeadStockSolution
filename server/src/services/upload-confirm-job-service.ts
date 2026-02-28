import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { promisify } from 'util';
import { gunzip, gzip } from 'zlib';
import { db } from '../config/database';
import { uploadConfirmJobs } from '../db/schema';
import {
  type ColumnMapping,
  DEAD_STOCK_FIELDS,
  USED_MEDICATION_FIELDS,
} from '../types';
import { rowCount } from '../utils/db-utils';
import { getNextRetryIso, getStaleBeforeIso } from '../utils/job-retry-utils';
import { parseBoundedInt } from '../utils/number-utils';
import { logger } from './logger';
import { runUploadConfirm, type ApplyMode, type UploadType } from './upload-confirm-service';
import { parseExcelBuffer } from './upload-service';

const MAX_JOB_ATTEMPTS = 5;
const RETRY_BATCH_SIZE = 3;
const JOB_STALE_TIMEOUT_MS = 15 * 60 * 1000;
const RETRY_BACKOFF_BASE_MS = 2 * 60 * 1000;
const CLAIM_CONTENTION_RETRY_LIMIT = 3;
const DEFAULT_MAX_ACTIVE_JOBS_PER_PHARMACY = 3;
const DEFAULT_MAX_ACTIVE_JOBS_GLOBAL = 60;
const DEFAULT_CLEANUP_RETENTION_DAYS = 7;
const DEFAULT_CLEANUP_BATCH_SIZE = 200;
const MAX_MAPPING_COLUMN_INDEX = 199;
const ACTIVE_JOB_STATUSES = ['pending', 'processing'] as const;
const FINISHED_JOB_STATUSES = ['completed', 'failed'] as const;
const COMPRESSED_PAYLOAD_PREFIX = 'gz:';
const CLEARED_FILE_PAYLOAD = '';
const JOB_ERROR_CODE_PREFIX_PATTERN = /^\[([A-Z0-9_]+)]\s*/;

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const UPLOAD_CONFIRM_QUEUE_LIMIT_ERROR_CODE = 'UPLOAD_CONFIRM_QUEUE_LIMIT';

interface EnqueueUploadConfirmJobParams {
  pharmacyId: number;
  uploadType: UploadType;
  originalFilename: string;
  headerRowIndex: number;
  mapping: ColumnMapping;
  applyMode: ApplyMode;
  deleteMissing: boolean;
  fileBuffer: Buffer;
}

interface UploadConfirmJobRuntime {
  id: number;
  pharmacyId: number;
  uploadType: UploadType;
  originalFilename: string;
  headerRowIndex: number;
  mappingJson: string;
  status: 'pending' | 'processing';
  applyMode: ApplyMode;
  deleteMissing: boolean;
  fileBase64: string;
  attempts: number;
  createdAt: string | null;
}

export interface UploadConfirmQueueLimitError extends Error {
  code: typeof UPLOAD_CONFIRM_QUEUE_LIMIT_ERROR_CODE;
  limit: number;
  activeJobs: number;
}

type UploadConfirmJobErrorCode =
  | 'MAPPING_INVALID'
  | 'HEADER_ROW_INVALID'
  | 'FILE_LIMIT_EXCEEDED'
  | 'FILE_PARSE_FAILED'
  | 'APPLY_MODE_INVALID'
  | 'UPLOAD_TYPE_INVALID'
  | 'JOB_STATUS_INVALID'
  | 'FILE_PAYLOAD_MISSING'
  | 'STALE_JOB_SKIPPED'
  | 'UPLOAD_CONFIRM_FAILED';

interface UploadConfirmJobClassifiedError {
  code: UploadConfirmJobErrorCode;
  message: string;
  retryable: boolean;
  rawMessage: string;
}

class UploadConfirmJobProcessingError extends Error {
  readonly code: UploadConfirmJobErrorCode;
  readonly retryable: boolean;

  constructor(code: UploadConfirmJobErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = 'UploadConfirmJobProcessingError';
    this.code = code;
    this.retryable = retryable;
  }
}

function createUploadConfirmJobError(
  code: UploadConfirmJobErrorCode,
  message: string,
  retryable: boolean,
): UploadConfirmJobProcessingError {
  return new UploadConfirmJobProcessingError(code, message, retryable);
}

function formatJobErrorMessage(code: UploadConfirmJobErrorCode, message: string): string {
  return `[${code}] ${message}`;
}

function stripJobErrorCodePrefix(rawMessage: string): string {
  return rawMessage.replace(JOB_ERROR_CODE_PREFIX_PATTERN, '').trim();
}

function parseJobErrorCode(rawMessage: string): UploadConfirmJobErrorCode | null {
  const matched = rawMessage.match(JOB_ERROR_CODE_PREFIX_PATTERN);
  if (!matched?.[1]) return null;
  return matched[1] as UploadConfirmJobErrorCode;
}

function getMaxActiveJobsPerPharmacy(): number {
  return parseBoundedInt(
    process.env.UPLOAD_CONFIRM_MAX_ACTIVE_JOBS_PER_PHARMACY,
    DEFAULT_MAX_ACTIVE_JOBS_PER_PHARMACY,
    1,
    20,
  );
}

function getMaxActiveJobsGlobal(): number {
  return parseBoundedInt(
    process.env.UPLOAD_CONFIRM_MAX_ACTIVE_JOBS_GLOBAL,
    DEFAULT_MAX_ACTIVE_JOBS_GLOBAL,
    1,
    500,
  );
}

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

function toSafeCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function createQueueLimitError(limit: number, activeJobs: number): UploadConfirmQueueLimitError {
  const error = new Error(
    `現在アップロード処理が混み合っています（上限: ${limit}件）。進行中ジョブ完了後に再実行してください。`,
  ) as UploadConfirmQueueLimitError;
  error.name = 'UploadConfirmQueueLimitError';
  error.code = UPLOAD_CONFIRM_QUEUE_LIMIT_ERROR_CODE;
  error.limit = limit;
  error.activeJobs = activeJobs;
  return error;
}

export function isUploadConfirmQueueLimitError(error: unknown): error is UploadConfirmQueueLimitError {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === UPLOAD_CONFIRM_QUEUE_LIMIT_ERROR_CODE,
  );
}

async function encodeUploadJobFilePayload(fileBuffer: Buffer): Promise<string> {
  const compressed = await gzipAsync(fileBuffer);
  return `${COMPRESSED_PAYLOAD_PREFIX}${compressed.toString('base64')}`;
}

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
  } catch (err) {
    throw createUploadConfirmJobError(
      'FILE_PARSE_FAILED',
      'アップロードファイルを解析できませんでした',
      false,
    );
  }
}

async function countActiveJobsForPharmacy(
  pharmacyId: number,
  executor: Pick<typeof db, 'select'> = db,
): Promise<number> {
  const [row] = await executor.select({
    count: rowCount,
  })
    .from(uploadConfirmJobs)
    .where(and(
      eq(uploadConfirmJobs.pharmacyId, pharmacyId),
      inArray(uploadConfirmJobs.status, ACTIVE_JOB_STATUSES),
    ));

  return toSafeCount(row?.count);
}

async function countActiveJobsGlobal(
  executor: Pick<typeof db, 'select'> = db,
): Promise<number> {
  const [row] = await executor.select({
    count: rowCount,
  })
    .from(uploadConfirmJobs)
    .where(inArray(uploadConfirmJobs.status, ACTIVE_JOB_STATUSES));
  return toSafeCount(row?.count);
}

function buildClaimableStatusCondition(staleBeforeIso: string) {
  return or(
    eq(uploadConfirmJobs.status, 'pending'),
    and(
      eq(uploadConfirmJobs.status, 'processing'),
      or(
        isNull(uploadConfirmJobs.processingStartedAt),
        lt(uploadConfirmJobs.processingStartedAt, staleBeforeIso),
      ),
    ),
  );
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

function normalizeApplyMode(value: string): ApplyMode {
  if (value === 'replace' || value === 'diff') {
    return value;
  }
  throw createUploadConfirmJobError(
    'APPLY_MODE_INVALID',
    `ジョブ内のapplyModeが不正です: ${value}`,
    false,
  );
}

function normalizeClaimableStatus(value: string): 'pending' | 'processing' {
  if (value === 'pending' || value === 'processing') {
    return value;
  }
  throw createUploadConfirmJobError(
    'JOB_STATUS_INVALID',
    `ジョブ内のstatusが不正です: ${value}`,
    false,
  );
}

async function claimPendingUploadConfirmJob(): Promise<UploadConfirmJobRuntime | null> {
  for (let attempt = 0; attempt < CLAIM_CONTENTION_RETRY_LIMIT; attempt += 1) {
    const nowIso = new Date().toISOString();
    const staleBeforeIso = getStaleBeforeIso(JOB_STALE_TIMEOUT_MS);
    const [candidate] = await db.select({
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
    })
      .from(uploadConfirmJobs)
      .where(and(
        buildClaimableStatusCondition(staleBeforeIso),
        lt(uploadConfirmJobs.attempts, MAX_JOB_ATTEMPTS),
        or(isNull(uploadConfirmJobs.nextRetryAt), lte(uploadConfirmJobs.nextRetryAt, nowIso)),
      ))
      .orderBy(
        asc(uploadConfirmJobs.createdAt),
        asc(uploadConfirmJobs.id),
      )
      .limit(1);

    if (!candidate) return null;

    const candidateStatus = normalizeClaimableStatus(candidate.status);

    const [claimed] = await db.update(uploadConfirmJobs)
      .set({
        status: 'processing',
        processingStartedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(and(
        eq(uploadConfirmJobs.id, candidate.id),
        eq(uploadConfirmJobs.status, candidateStatus),
        eq(uploadConfirmJobs.attempts, candidate.attempts),
        lt(uploadConfirmJobs.attempts, MAX_JOB_ATTEMPTS),
        or(isNull(uploadConfirmJobs.nextRetryAt), lte(uploadConfirmJobs.nextRetryAt, nowIso)),
        candidateStatus === 'processing'
          ? or(
            isNull(uploadConfirmJobs.processingStartedAt),
            lt(uploadConfirmJobs.processingStartedAt, staleBeforeIso),
          )
          : eq(uploadConfirmJobs.status, 'pending'),
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

    if (claimed) {
      return {
        ...claimed,
        status: normalizeClaimableStatus(claimed.status),
        applyMode: normalizeApplyMode(claimed.applyMode),
      };
    }
  }
  return null;
}

async function processClaimedUploadConfirmJob(job: UploadConfirmJobRuntime): Promise<void> {
  try {
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

    const result = await runUploadConfirm({
      pharmacyId: job.pharmacyId,
      uploadType: job.uploadType,
      originalFilename: job.originalFilename,
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
    };

    const nowIso = new Date().toISOString();
    await db.update(uploadConfirmJobs)
      .set({
        status: 'completed',
        lastError: null,
        resultJson: JSON.stringify(responsePayload),
        fileBase64: CLEARED_FILE_PAYLOAD,
        processingStartedAt: null,
        completedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(eq(uploadConfirmJobs.id, job.id));
  } catch (err) {
    const nextAttempts = job.attempts + 1;
    const classified = classifyUploadConfirmJobError(err);
    const message = formatJobErrorMessage(classified.code, classified.message);
    const nowIso = new Date().toISOString();
    const retryable = classified.retryable;
    const terminal = !retryable || nextAttempts >= MAX_JOB_ATTEMPTS;

    const updatePayload: Partial<typeof uploadConfirmJobs.$inferInsert> = {
      status: terminal ? 'failed' : 'pending',
      attempts: nextAttempts,
      lastError: message,
      processingStartedAt: null,
      nextRetryAt: terminal ? null : getNextRetryIso(nextAttempts, MAX_JOB_ATTEMPTS, RETRY_BACKOFF_BASE_MS),
      updatedAt: nowIso,
    };
    if (terminal) {
      updatePayload.fileBase64 = CLEARED_FILE_PAYLOAD;
      updatePayload.completedAt = nowIso;
    }

    await db.update(uploadConfirmJobs)
      .set(updatePayload)
      .where(eq(uploadConfirmJobs.id, job.id));

    if (!retryable) {
      logger.warn('Upload confirm job failed as non-retryable', {
        jobId: job.id,
        pharmacyId: job.pharmacyId,
        attempts: nextAttempts,
        error: classified.rawMessage,
        code: classified.code,
      });
    } else if (terminal) {
      logger.error('Upload confirm job reached max attempts', {
        jobId: job.id,
        pharmacyId: job.pharmacyId,
        attempts: nextAttempts,
        error: classified.rawMessage,
        code: classified.code,
      });
    } else {
      logger.warn('Upload confirm job failed and will retry', {
        jobId: job.id,
        pharmacyId: job.pharmacyId,
        attempts: nextAttempts,
        error: classified.rawMessage,
        code: classified.code,
      });
    }
  }
}

export async function enqueueUploadConfirmJob(
  params: EnqueueUploadConfirmJobParams,
): Promise<number> {
  const encodedPayload = await encodeUploadJobFilePayload(params.fileBuffer);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${params.pharmacyId})`);

    const maxActiveJobs = getMaxActiveJobsPerPharmacy();
    const activeJobs = await countActiveJobsForPharmacy(params.pharmacyId, tx);
    if (activeJobs >= maxActiveJobs) {
      throw createQueueLimitError(maxActiveJobs, activeJobs);
    }

    const maxActiveJobsGlobal = getMaxActiveJobsGlobal();
    const globalActiveJobs = await countActiveJobsGlobal(tx);
    if (globalActiveJobs >= maxActiveJobsGlobal) {
      throw createQueueLimitError(maxActiveJobsGlobal, globalActiveJobs);
    }

    const nowIso = new Date().toISOString();
    const [job] = await tx.insert(uploadConfirmJobs).values({
      pharmacyId: params.pharmacyId,
      uploadType: params.uploadType,
      originalFilename: params.originalFilename,
      headerRowIndex: params.headerRowIndex,
      mappingJson: JSON.stringify(params.mapping),
      applyMode: params.applyMode,
      deleteMissing: params.deleteMissing,
      fileBase64: encodedPayload,
      status: 'pending',
      attempts: 0,
      processingStartedAt: null,
      nextRetryAt: null,
      lastError: null,
      completedAt: null,
      updatedAt: nowIso,
    }).returning({ id: uploadConfirmJobs.id });

    return job.id;
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

  await processClaimedUploadConfirmJob({
    ...claimed,
    status: normalizeClaimableStatus(claimed.status),
    applyMode: normalizeApplyMode(claimed.applyMode),
  });
  return true;
}

export async function processPendingUploadConfirmJobs(limit: number = RETRY_BATCH_SIZE): Promise<number> {
  let processed = 0;

  for (let i = 0; i < limit; i += 1) {
    const job = await claimPendingUploadConfirmJob();
    if (!job) break;
    await processClaimedUploadConfirmJob(job);
    processed += 1;
  }

  return processed;
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

export async function getUploadConfirmJobForPharmacy(jobId: number, pharmacyId: number): Promise<{
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  lastError: string | null;
  resultJson: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
} | null> {
  const [row] = await db.select({
    id: uploadConfirmJobs.id,
    status: uploadConfirmJobs.status,
    attempts: uploadConfirmJobs.attempts,
    lastError: uploadConfirmJobs.lastError,
    resultJson: uploadConfirmJobs.resultJson,
    createdAt: uploadConfirmJobs.createdAt,
    updatedAt: uploadConfirmJobs.updatedAt,
    completedAt: uploadConfirmJobs.completedAt,
  })
    .from(uploadConfirmJobs)
    .where(and(
      eq(uploadConfirmJobs.id, jobId),
      eq(uploadConfirmJobs.pharmacyId, pharmacyId),
    ))
    .limit(1);
  return row ?? null;
}
