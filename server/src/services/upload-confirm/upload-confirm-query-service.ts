import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '../../config/database';
import { uploadConfirmJobs } from '../../db/schema';
import { rowCount } from '../../utils/db-utils';
import { getStaleBeforeIso } from '../../utils/job-retry-utils';
import { parseBoundedInt } from '../../utils/number-utils';
import type { ApplyMode } from '../upload-confirm-service';
import {
  ACTIVE_JOB_STATUSES,
  CLAIM_CONTENTION_RETRY_LIMIT,
  DEFAULT_MAX_ACTIVE_JOBS_GLOBAL,
  DEFAULT_MAX_ACTIVE_JOBS_PER_PHARMACY,
  IDEMPOTENT_DEDUP_JOB_STATUSES,
  JOB_STALE_TIMEOUT_MS,
  MAX_JOB_ATTEMPTS,
  UPLOAD_CONFIRM_QUEUE_GLOBAL_LOCK_KEY,
  UPLOAD_CONFIRM_QUEUE_LOCK_NAMESPACE,
  createQueueLimitError,
  createUploadConfirmJobError,
  type UploadConfirmJobErrorCode,
  type UploadConfirmJobRecord,
  type UploadConfirmJobRuntime,
  type UploadConfirmJobRuntimeRow,
  type UploadConfirmJobStatus,
} from './upload-confirm-types';

function toSafeCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
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

async function countActiveJobs(
  executor: Pick<typeof db, 'select'> = db,
  pharmacyId?: number,
): Promise<number> {
  const conditions = [
    inArray(uploadConfirmJobs.status, ACTIVE_JOB_STATUSES),
    isNull(uploadConfirmJobs.cancelRequestedAt),
    isNull(uploadConfirmJobs.canceledAt),
  ];
  if (pharmacyId !== undefined) {
    conditions.push(eq(uploadConfirmJobs.pharmacyId, pharmacyId));
  }
  const [row] = await executor.select({ count: rowCount })
    .from(uploadConfirmJobs)
    .where(and(...conditions));
  return toSafeCount(row?.count);
}

type UploadConfirmQueueCapacityExecutor = Pick<typeof db, 'execute' | 'select'>;

export async function lockUploadConfirmQueueCapacity(
  pharmacyId: number,
  executor: UploadConfirmQueueCapacityExecutor,
): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(${UPLOAD_CONFIRM_QUEUE_LOCK_NAMESPACE}, ${UPLOAD_CONFIRM_QUEUE_GLOBAL_LOCK_KEY})`);
  await executor.execute(sql`SELECT pg_advisory_xact_lock(${pharmacyId})`);
}

export async function assertUploadConfirmQueueCapacity(
  pharmacyId: number,
  executor: Pick<typeof db, 'select'>,
): Promise<void> {
  const maxPerPharmacy = getMaxActiveJobsPerPharmacy();
  const activePerPharmacy = await countActiveJobs(executor, pharmacyId);
  if (activePerPharmacy >= maxPerPharmacy) {
    throw createQueueLimitError(maxPerPharmacy, activePerPharmacy);
  }

  const maxGlobal = getMaxActiveJobsGlobal();
  const activeGlobal = await countActiveJobs(executor);
  if (activeGlobal >= maxGlobal) {
    throw createQueueLimitError(maxGlobal, activeGlobal);
  }
}

export async function assertUploadConfirmQueueCapacityWithLocks(
  pharmacyId: number,
  executor: UploadConfirmQueueCapacityExecutor,
): Promise<void> {
  await lockUploadConfirmQueueCapacity(pharmacyId, executor);
  await assertUploadConfirmQueueCapacity(pharmacyId, executor);
}

function createEnumNormalizer<T extends string>(
  validValues: readonly T[],
  errorCode: UploadConfirmJobErrorCode,
  errorLabel: string,
): (value: string) => T {
  const validSet = new Set<string>(validValues);
  return (value: string): T => {
    if (validSet.has(value)) return value as T;
    throw createUploadConfirmJobError(
      errorCode,
      `ジョブ内の${errorLabel}が不正です: ${value}`,
      false,
    );
  };
}

const normalizeApplyMode = createEnumNormalizer<ApplyMode>(
  ['replace', 'diff', 'partial'],
  'APPLY_MODE_INVALID',
  'applyMode',
);

const normalizeClaimableStatus = createEnumNormalizer<'pending' | 'processing'>(
  ['pending', 'processing'],
  'JOB_STATUS_INVALID',
  'status',
);

export const normalizeJobStatus = createEnumNormalizer<UploadConfirmJobStatus>(
  ['pending', 'processing', 'completed', 'failed'],
  'JOB_STATUS_INVALID',
  'status',
);

const JOB_RUNTIME_COLUMNS = {
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
} as const;

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

function mapJobRuntime(
  row: UploadConfirmJobRuntimeRow,
): UploadConfirmJobRuntime {
  return {
    ...row,
    status: normalizeClaimableStatus(row.status),
    applyMode: normalizeApplyMode(row.applyMode),
  };
}

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

export async function fetchUploadConfirmJobById(
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

export async function assertJobNotCancellationRequested(jobId: number): Promise<void> {
  const [row] = await db.select({
    cancelRequestedAt: uploadConfirmJobs.cancelRequestedAt,
    canceledAt: uploadConfirmJobs.canceledAt,
  })
    .from(uploadConfirmJobs)
    .where(eq(uploadConfirmJobs.id, jobId))
    .limit(1);

  if (row?.canceledAt || row?.cancelRequestedAt) {
    throw createUploadConfirmJobError('JOB_CANCELED', '管理者によりジョブがキャンセルされました', false);
  }
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

function buildClaimStatusMatchCondition(
  candidateStatus: 'pending' | 'processing',
  staleBeforeIso: string,
) {
  if (candidateStatus === 'pending') {
    return eq(uploadConfirmJobs.status, 'pending');
  }
  return or(
    isNull(uploadConfirmJobs.processingStartedAt),
    lt(uploadConfirmJobs.processingStartedAt, staleBeforeIso),
  );
}

export async function claimPendingUploadConfirmJob(): Promise<UploadConfirmJobRuntime | null> {
  for (let attempt = 0; attempt < CLAIM_CONTENTION_RETRY_LIMIT; attempt += 1) {
    const nowIso = new Date().toISOString();
    const staleBeforeIso = getStaleBeforeIso(JOB_STALE_TIMEOUT_MS);
    const [candidate] = await db.select(JOB_RUNTIME_COLUMNS)
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
        buildClaimStatusMatchCondition(candidateStatus, staleBeforeIso),
      ))
      .returning(JOB_RUNTIME_COLUMNS);

    if (claimed) {
      return mapJobRuntime(claimed);
    }
  }
  return null;
}

export async function findJobByIdempotencyKey(
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
