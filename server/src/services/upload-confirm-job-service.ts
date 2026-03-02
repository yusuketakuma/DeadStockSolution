import { createHash } from 'crypto';
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  gte,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
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
import {
  clearUploadRowIssuesForJob,
  getUploadRowIssueCountByJobId,
} from './upload-row-issue-service';
import {
  runUploadConfirm,
  type ApplyMode,
  type UploadType,
} from './upload-confirm-service';
import { parseExcelBuffer } from './upload-service';

const MAX_JOB_ATTEMPTS = 5;
const RETRY_BATCH_SIZE = 3;
const JOB_STALE_TIMEOUT_MS = 15 * 60 * 1000;
const RETRY_BACKOFF_BASE_MS = 2 * 60 * 1000;
const CLAIM_CONTENTION_RETRY_LIMIT = 3;
const DEFAULT_MAX_ACTIVE_JOBS_PER_PHARMACY = 3;
const DEFAULT_MAX_ACTIVE_JOBS_GLOBAL = 60;
const UPLOAD_CONFIRM_QUEUE_LOCK_NAMESPACE = 9412;
const UPLOAD_CONFIRM_QUEUE_GLOBAL_LOCK_KEY = 1;
const DEFAULT_CLEANUP_RETENTION_DAYS = 7;
const DEFAULT_CLEANUP_BATCH_SIZE = 200;
const MAX_MAPPING_COLUMN_INDEX = 199;
const ACTIVE_JOB_STATUSES = ['pending', 'processing'] as const;
const FINISHED_JOB_STATUSES = ['completed', 'failed'] as const;
const IDEMPOTENT_DEDUP_JOB_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
const COMPRESSED_PAYLOAD_PREFIX = 'gz:';
const CLEARED_FILE_PAYLOAD = '';
const JOB_ERROR_CODE_PREFIX_PATTERN = /^\[([A-Z0-9_]+)]\s*/;
const CANCELLED_JOB_MESSAGE = '管理者によりジョブがキャンセルされました';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const UPLOAD_CONFIRM_QUEUE_LIMIT_ERROR_CODE = 'UPLOAD_CONFIRM_QUEUE_LIMIT';
export const UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT_ERROR_CODE = 'UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT';
export const UPLOAD_CONFIRM_RETRY_UNAVAILABLE_ERROR_CODE = 'UPLOAD_CONFIRM_RETRY_UNAVAILABLE';

interface EnqueueUploadConfirmJobParams {
  pharmacyId: number;
  uploadType: UploadType;
  originalFilename: string;
  idempotencyKey?: string | null;
  headerRowIndex: number;
  mapping: ColumnMapping;
  applyMode: ApplyMode;
  deleteMissing: boolean;
  fileBuffer: Buffer;
  requestedAtIso?: string;
}

export interface EnqueueUploadConfirmJobResult {
  jobId: number;
  status: UploadConfirmJobStatus;
  deduplicated: boolean;
  cancelable: boolean;
  canceledAt: string | null;
}

type UploadConfirmJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

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

interface UploadConfirmJobRecord {
  id: number;
  pharmacyId: number;
  uploadType: UploadType;
  originalFilename: string;
  idempotencyKey: string | null;
  fileHash: string;
  headerRowIndex: number;
  mappingJson: string;
  status: UploadConfirmJobStatus;
  applyMode: ApplyMode;
  deleteMissing: boolean;
  deduplicated: boolean;
  fileBase64: string;
  attempts: number;
  lastError: string | null;
  resultJson: string | null;
  cancelRequestedAt: string | null;
  canceledAt: string | null;
  canceledBy: number | null;
  processingStartedAt: string | null;
  nextRetryAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UploadConfirmQueueLimitError extends Error {
  code: typeof UPLOAD_CONFIRM_QUEUE_LIMIT_ERROR_CODE;
  limit: number;
  activeJobs: number;
}

export interface UploadConfirmIdempotencyConflictError extends Error {
  code: typeof UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT_ERROR_CODE;
}

export interface UploadConfirmRetryUnavailableError extends Error {
  code: typeof UPLOAD_CONFIRM_RETRY_UNAVAILABLE_ERROR_CODE;
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
  | 'JOB_CANCELED'
  | 'UPLOAD_CONFIRM_FAILED';

interface UploadConfirmJobClassifiedError {
  code: UploadConfirmJobErrorCode;
  message: string;
  retryable: boolean;
  rawMessage: string;
}

export type UploadConfirmJobView = Omit<
  UploadConfirmJobRecord,
  'headerRowIndex' | 'mappingJson' | 'fileBase64' | 'processingStartedAt' | 'nextRetryAt'
> & {
  issueCount: number;
  cancelable: boolean;
};

export interface CancelUploadConfirmJobResult {
  id: number;
  status: UploadConfirmJobStatus;
  canceledAt: string | null;
  cancelRequestedAt: string | null;
  cancelable: boolean;
}

export interface RetryUploadConfirmJobResult {
  id: number;
  status: UploadConfirmJobStatus;
  cancelable: boolean;
  canceledAt: string | null;
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

function createIdempotencyConflictError(): UploadConfirmIdempotencyConflictError {
  const error = new Error(
    '同じ idempotencyKey で異なるアップロード要求が送信されました。新しい idempotencyKey で再実行してください。',
  ) as UploadConfirmIdempotencyConflictError;
  error.name = 'UploadConfirmIdempotencyConflictError';
  error.code = UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT_ERROR_CODE;
  return error;
}

function createRetryUnavailableError(message: string): UploadConfirmRetryUnavailableError {
  const error = new Error(message) as UploadConfirmRetryUnavailableError;
  error.name = 'UploadConfirmRetryUnavailableError';
  error.code = UPLOAD_CONFIRM_RETRY_UNAVAILABLE_ERROR_CODE;
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

export function isUploadConfirmIdempotencyConflictError(error: unknown): error is UploadConfirmIdempotencyConflictError {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT_ERROR_CODE,
  );
}

export function isUploadConfirmRetryUnavailableError(error: unknown): error is UploadConfirmRetryUnavailableError {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === UPLOAD_CONFIRM_RETRY_UNAVAILABLE_ERROR_CODE,
  );
}

function isCancelableStatus(status: UploadConfirmJobStatus): boolean {
  return status === 'pending' || status === 'processing';
}

function isJobCancelable(
  status: UploadConfirmJobStatus,
  cancelRequestedAt: string | null,
  canceledAt: string | null,
): boolean {
  return isCancelableStatus(status) && cancelRequestedAt === null && canceledAt === null;
}

function computeFileHash(fileBuffer: Buffer): string {
  return createHash('sha256').update(fileBuffer).digest('hex');
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
  } catch {
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
      isNull(uploadConfirmJobs.cancelRequestedAt),
      isNull(uploadConfirmJobs.canceledAt),
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
    .where(and(
      inArray(uploadConfirmJobs.status, ACTIVE_JOB_STATUSES),
      isNull(uploadConfirmJobs.cancelRequestedAt),
      isNull(uploadConfirmJobs.canceledAt),
    ));

  return toSafeCount(row?.count);
}

type UploadConfirmQueueCapacityExecutor = Pick<typeof db, 'execute' | 'select'>;

async function lockUploadConfirmQueueCapacity(
  pharmacyId: number,
  executor: UploadConfirmQueueCapacityExecutor,
): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(${UPLOAD_CONFIRM_QUEUE_LOCK_NAMESPACE}, ${UPLOAD_CONFIRM_QUEUE_GLOBAL_LOCK_KEY})`);
  await executor.execute(sql`SELECT pg_advisory_xact_lock(${pharmacyId})`);
}

async function assertUploadConfirmQueueCapacity(
  pharmacyId: number,
  executor: Pick<typeof db, 'select'>,
): Promise<void> {
  const maxActiveJobs = getMaxActiveJobsPerPharmacy();
  const activeJobs = await countActiveJobsForPharmacy(pharmacyId, executor);
  if (activeJobs >= maxActiveJobs) {
    throw createQueueLimitError(maxActiveJobs, activeJobs);
  }

  const maxActiveJobsGlobal = getMaxActiveJobsGlobal();
  const globalActiveJobs = await countActiveJobsGlobal(executor);
  if (globalActiveJobs >= maxActiveJobsGlobal) {
    throw createQueueLimitError(maxActiveJobsGlobal, globalActiveJobs);
  }
}

async function assertUploadConfirmQueueCapacityWithLocks(
  pharmacyId: number,
  executor: UploadConfirmQueueCapacityExecutor,
): Promise<void> {
  await lockUploadConfirmQueueCapacity(pharmacyId, executor);
  await assertUploadConfirmQueueCapacity(pharmacyId, executor);
}

function buildClaimableStatusCondition(staleBeforeIso: string) {
  return and(
    isNull(uploadConfirmJobs.cancelRequestedAt),
    isNull(uploadConfirmJobs.canceledAt),
    or(
      eq(uploadConfirmJobs.status, 'pending'),
      and(
        eq(uploadConfirmJobs.status, 'processing'),
        or(
          isNull(uploadConfirmJobs.processingStartedAt),
          lt(uploadConfirmJobs.processingStartedAt, staleBeforeIso),
        ),
      ),
    ),
  );
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
  if (/cancel/i.test(rawMessage)) {
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

function normalizeApplyMode(value: string): ApplyMode {
  if (value === 'replace' || value === 'diff' || value === 'partial') {
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

function normalizeJobStatus(value: string): UploadConfirmJobStatus {
  if (value === 'pending' || value === 'processing' || value === 'completed' || value === 'failed') {
    return value;
  }
  throw createUploadConfirmJobError(
    'JOB_STATUS_INVALID',
    `ジョブ内のstatusが不正です: ${value}`,
    false,
  );
}

const JOB_RECORD_COLUMNS = {
  id: uploadConfirmJobs.id,
  pharmacyId: uploadConfirmJobs.pharmacyId,
  uploadType: uploadConfirmJobs.uploadType,
  originalFilename: uploadConfirmJobs.originalFilename,
  idempotencyKey: uploadConfirmJobs.idempotencyKey,
  fileHash: uploadConfirmJobs.fileHash,
  headerRowIndex: uploadConfirmJobs.headerRowIndex,
  mappingJson: uploadConfirmJobs.mappingJson,
  status: uploadConfirmJobs.status,
  applyMode: uploadConfirmJobs.applyMode,
  deleteMissing: uploadConfirmJobs.deleteMissing,
  deduplicated: uploadConfirmJobs.deduplicated,
  fileBase64: uploadConfirmJobs.fileBase64,
  attempts: uploadConfirmJobs.attempts,
  lastError: uploadConfirmJobs.lastError,
  resultJson: uploadConfirmJobs.resultJson,
  cancelRequestedAt: uploadConfirmJobs.cancelRequestedAt,
  canceledAt: uploadConfirmJobs.canceledAt,
  canceledBy: uploadConfirmJobs.canceledBy,
  processingStartedAt: uploadConfirmJobs.processingStartedAt,
  nextRetryAt: uploadConfirmJobs.nextRetryAt,
  completedAt: uploadConfirmJobs.completedAt,
  createdAt: uploadConfirmJobs.createdAt,
  updatedAt: uploadConfirmJobs.updatedAt,
} as const;

function mapJobRecord(
  row: Omit<UploadConfirmJobRecord, 'status' | 'applyMode'> & { status: string; applyMode: string },
): UploadConfirmJobRecord {
  const status = normalizeJobStatus(row.status);
  const applyMode = normalizeApplyMode(row.applyMode);
  return {
    ...row,
    status,
    applyMode,
  };
}

async function fetchUploadConfirmJobById(
  jobId: number,
  executor: Pick<typeof db, 'select'> = db,
): Promise<UploadConfirmJobRecord | null> {
  const [row] = await executor.select(JOB_RECORD_COLUMNS)
    .from(uploadConfirmJobs)
    .where(eq(uploadConfirmJobs.id, jobId))
    .limit(1);

  if (!row) return null;
  return mapJobRecord(row);
}

async function assertJobNotCancellationRequested(jobId: number): Promise<void> {
  const [row] = await db.select({
    cancelRequestedAt: uploadConfirmJobs.cancelRequestedAt,
    canceledAt: uploadConfirmJobs.canceledAt,
  })
    .from(uploadConfirmJobs)
    .where(eq(uploadConfirmJobs.id, jobId))
    .limit(1);

  if (row?.canceledAt || row?.cancelRequestedAt) {
    throw createUploadConfirmJobError('JOB_CANCELED', CANCELLED_JOB_MESSAGE, false);
  }
}

function buildNoOtherActiveProcessingCondition(
  candidateId: number,
  staleBeforeIso: string,
) {
  return notExists(
    db.select({ id: uploadConfirmJobs.id })
      .from(uploadConfirmJobs)
      .where(and(
        eq(uploadConfirmJobs.status, 'processing'),
        isNull(uploadConfirmJobs.cancelRequestedAt),
        isNull(uploadConfirmJobs.canceledAt),
        gte(uploadConfirmJobs.processingStartedAt, staleBeforeIso),
        ne(uploadConfirmJobs.id, candidateId),
      )),
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
        isNull(uploadConfirmJobs.cancelRequestedAt),
        isNull(uploadConfirmJobs.canceledAt),
        eq(uploadConfirmJobs.status, candidateStatus),
        eq(uploadConfirmJobs.attempts, candidate.attempts),
        lt(uploadConfirmJobs.attempts, MAX_JOB_ATTEMPTS),
        or(isNull(uploadConfirmJobs.nextRetryAt), lte(uploadConfirmJobs.nextRetryAt, nowIso)),
        buildNoOtherActiveProcessingCondition(candidate.id, staleBeforeIso),
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
      updatePayload.completedAt = nowIso;
      if (classified.code === 'JOB_CANCELED') {
        updatePayload.cancelRequestedAt = nowIso;
        updatePayload.canceledAt = nowIso;
      }
    }

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

async function findJobByIdempotencyKey(
  pharmacyId: number,
  idempotencyKey: string,
  executor: Pick<typeof db, 'select'>,
): Promise<UploadConfirmJobRecord | null> {
  const [row] = await executor.select(JOB_RECORD_COLUMNS)
    .from(uploadConfirmJobs)
    .where(and(
      eq(uploadConfirmJobs.pharmacyId, pharmacyId),
      eq(uploadConfirmJobs.idempotencyKey, idempotencyKey),
      inArray(uploadConfirmJobs.status, IDEMPOTENT_DEDUP_JOB_STATUSES),
      isNull(uploadConfirmJobs.canceledAt),
    ))
    .orderBy(asc(uploadConfirmJobs.id))
    .limit(1);

  if (!row) return null;
  return mapJobRecord(row);
}

function ensureIdempotentPayloadMatch(
  existing: UploadConfirmJobRecord,
  input: {
    uploadType: UploadType;
    fileHash: string;
    headerRowIndex: number;
    mappingJson: string;
    applyMode: ApplyMode;
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

  await processClaimedUploadConfirmJob({
    ...claimed,
    status: normalizeClaimableStatus(claimed.status),
    applyMode: normalizeApplyMode(claimed.applyMode),
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

function toCancelResult(
  row: { id: number; status: string; canceledAt: string | null; cancelRequestedAt: string | null },
): CancelUploadConfirmJobResult {
  return {
    id: row.id,
    status: normalizeJobStatus(row.status),
    canceledAt: row.canceledAt,
    cancelRequestedAt: row.cancelRequestedAt,
    cancelable: isJobCancelable(normalizeJobStatus(row.status), row.cancelRequestedAt, row.canceledAt),
  };
}

const CANCEL_RETURNING_COLUMNS = {
  id: uploadConfirmJobs.id,
  status: uploadConfirmJobs.status,
  canceledAt: uploadConfirmJobs.canceledAt,
  cancelRequestedAt: uploadConfirmJobs.cancelRequestedAt,
} as const;

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
      .set(existing.status === 'pending'
        ? {
          status: 'failed',
          cancelRequestedAt: existing.cancelRequestedAt ?? nowIso,
          canceledAt: nowIso,
          canceledBy,
          lastError: formatJobErrorMessage('JOB_CANCELED', CANCELLED_JOB_MESSAGE),
          nextRetryAt: null,
          processingStartedAt: null,
          completedAt: nowIso,
          updatedAt: nowIso,
        }
        : {
          cancelRequestedAt: existing.cancelRequestedAt ?? nowIso,
          canceledBy,
          updatedAt: nowIso,
        })
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
