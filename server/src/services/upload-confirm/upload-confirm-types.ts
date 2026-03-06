import type { ColumnMapping } from '../../types';
import type {
  ApplyMode,
  UploadType,
} from '../upload-confirm-service';

export const MAX_JOB_ATTEMPTS = 5;
export const RETRY_BATCH_SIZE = 3;
export const JOB_STALE_TIMEOUT_MS = 15 * 60 * 1000;
export const RETRY_BACKOFF_BASE_MS = 2 * 60 * 1000;
export const CLAIM_CONTENTION_RETRY_LIMIT = 3;
export const DEFAULT_MAX_ACTIVE_JOBS_PER_PHARMACY = 3;
export const DEFAULT_MAX_ACTIVE_JOBS_GLOBAL = 60;
export const UPLOAD_CONFIRM_QUEUE_LOCK_NAMESPACE = 9412;
export const UPLOAD_CONFIRM_QUEUE_GLOBAL_LOCK_KEY = 1;
export const DEFAULT_CLEANUP_RETENTION_DAYS = 7;
export const DEFAULT_CLEANUP_BATCH_SIZE = 200;
export const MAX_MAPPING_COLUMN_INDEX = 199;

export const ACTIVE_JOB_STATUSES = ['pending', 'processing'] as const;
export const FINISHED_JOB_STATUSES = ['completed', 'failed'] as const;
export const IDEMPOTENT_DEDUP_JOB_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;

export const COMPRESSED_PAYLOAD_PREFIX = 'gz:';
export const CLEARED_FILE_PAYLOAD = '';
const JOB_ERROR_CODE_PREFIX_PATTERN = /^\[([A-Z0-9_]+)]\s*/;

export const CANCELLED_JOB_MESSAGE = '管理者によりジョブがキャンセルされました';

export const UPLOAD_CONFIRM_QUEUE_LIMIT_ERROR_CODE = 'UPLOAD_CONFIRM_QUEUE_LIMIT';
export const UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT_ERROR_CODE = 'UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT';
export const UPLOAD_CONFIRM_RETRY_UNAVAILABLE_ERROR_CODE = 'UPLOAD_CONFIRM_RETRY_UNAVAILABLE';

export interface EnqueueUploadConfirmJobParams {
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

export type UploadConfirmJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface UploadConfirmJobRuntime {
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

export type UploadConfirmJobRuntimeRow = Omit<UploadConfirmJobRuntime, 'status' | 'applyMode'> & {
  status: string;
  applyMode: string;
};

export interface UploadConfirmJobRecord {
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

export type UploadConfirmJobErrorCode =
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

const UPLOAD_CONFIRM_JOB_ERROR_CODES: ReadonlySet<UploadConfirmJobErrorCode> = new Set([
  'MAPPING_INVALID',
  'HEADER_ROW_INVALID',
  'FILE_LIMIT_EXCEEDED',
  'FILE_PARSE_FAILED',
  'APPLY_MODE_INVALID',
  'UPLOAD_TYPE_INVALID',
  'JOB_STATUS_INVALID',
  'FILE_PAYLOAD_MISSING',
  'STALE_JOB_SKIPPED',
  'JOB_CANCELED',
  'UPLOAD_CONFIRM_FAILED',
]);

export interface UploadConfirmJobClassifiedError {
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

export class UploadConfirmJobProcessingError extends Error {
  readonly code: UploadConfirmJobErrorCode;

  readonly retryable: boolean;

  constructor(code: UploadConfirmJobErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = 'UploadConfirmJobProcessingError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function createUploadConfirmJobError(
  code: UploadConfirmJobErrorCode,
  message: string,
  retryable: boolean,
): UploadConfirmJobProcessingError {
  return new UploadConfirmJobProcessingError(code, message, retryable);
}

export function formatJobErrorMessage(code: UploadConfirmJobErrorCode, message: string): string {
  return `[${code}] ${message}`;
}

export function stripJobErrorCodePrefix(rawMessage: string): string {
  return rawMessage.replace(JOB_ERROR_CODE_PREFIX_PATTERN, '').trim();
}

export function parseJobErrorCode(rawMessage: string): UploadConfirmJobErrorCode | null {
  const matched = rawMessage.match(JOB_ERROR_CODE_PREFIX_PATTERN);
  if (!matched?.[1]) return null;
  return UPLOAD_CONFIRM_JOB_ERROR_CODES.has(matched[1] as UploadConfirmJobErrorCode)
    ? (matched[1] as UploadConfirmJobErrorCode)
    : null;
}

export function createQueueLimitError(limit: number, activeJobs: number): UploadConfirmQueueLimitError {
  const error = new Error(
    `現在アップロード処理が混み合っています（上限: ${limit}件）。進行中ジョブ完了後に再実行してください。`,
  ) as UploadConfirmQueueLimitError;
  error.name = 'UploadConfirmQueueLimitError';
  error.code = UPLOAD_CONFIRM_QUEUE_LIMIT_ERROR_CODE;
  error.limit = limit;
  error.activeJobs = activeJobs;
  return error;
}

export function createIdempotencyConflictError(): UploadConfirmIdempotencyConflictError {
  const error = new Error(
    '同じ idempotencyKey で異なるアップロード要求が送信されました。新しい idempotencyKey で再実行してください。',
  ) as UploadConfirmIdempotencyConflictError;
  error.name = 'UploadConfirmIdempotencyConflictError';
  error.code = UPLOAD_CONFIRM_IDEMPOTENCY_CONFLICT_ERROR_CODE;
  return error;
}

export function createRetryUnavailableError(message: string): UploadConfirmRetryUnavailableError {
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

export function isCancelableStatus(status: UploadConfirmJobStatus): boolean {
  return status === 'pending' || status === 'processing';
}

export function isJobCancelable(
  status: UploadConfirmJobStatus,
  cancelRequestedAt: string | null,
  canceledAt: string | null,
): boolean {
  return isCancelableStatus(status) && cancelRequestedAt === null && canceledAt === null;
}
