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
import { uploadJobs } from '../../db/schema';
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

function buildNotCanceledCondition(): ReturnType<typeof and> {
  return and(
    isNull(uploadJobs.cancelRequestedAt),
    isNull(uploadJobs.canceledAt),
  );
}

function buildRetryReadyCondition(nowIso: string): ReturnType<typeof or> {
  return or(
    isNull(uploadJobs.nextRetryAt),
    lte(uploadJobs.nextRetryAt, nowIso),
  );
}

async function countActiveJobs(
  executor: Pick<typeof db, 'select'> = db,
  pharmacyId?: number,
): Promise<number> {
  const conditions = [
    inArray(uploadJobs.status, ACTIVE_JOB_STATUSES),
    buildNotCanceledCondition(),
  ];
  if (pharmacyId !== undefined) {
    conditions.push(eq(uploadJobs.pharmacyId, pharmacyId));
  }
  const [row] = await executor.select({ count: rowCount })
    .from(uploadJobs)
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
  id: uploadJobs.id,
  pharmacyId: uploadJobs.pharmacyId,
  uploadType: uploadJobs.uploadType,
  originalFilename: uploadJobs.originalFilename,
  headerRowIndex: uploadJobs.headerRowIndex,
  mappingJson: uploadJobs.mappingJson,
  status: uploadJobs.status,
  applyMode: uploadJobs.applyMode,
  deleteMissing: uploadJobs.deleteMissing,
  fileBase64: uploadJobs.fileBase64,
  attempts: uploadJobs.attempts,
  createdAt: uploadJobs.createdAt,
} as const;

const JOB_RECORD_COLUMNS = {
  id: uploadJobs.id,
  pharmacyId: uploadJobs.pharmacyId,
  uploadType: uploadJobs.uploadType,
  originalFilename: uploadJobs.originalFilename,
  idempotencyKey: uploadJobs.idempotencyKey,
  fileHash: uploadJobs.fileHash,
  headerRowIndex: uploadJobs.headerRowIndex,
  mappingJson: uploadJobs.mappingJson,
  status: uploadJobs.status,
  applyMode: uploadJobs.applyMode,
  deleteMissing: uploadJobs.deleteMissing,
  deduplicated: uploadJobs.deduplicated,
  fileBase64: uploadJobs.fileBase64,
  attempts: uploadJobs.attempts,
  lastError: uploadJobs.lastError,
  resultJson: uploadJobs.resultJson,
  cancelRequestedAt: uploadJobs.cancelRequestedAt,
  canceledAt: uploadJobs.canceledAt,
  canceledBy: uploadJobs.canceledBy,
  processingStartedAt: uploadJobs.processingStartedAt,
  nextRetryAt: uploadJobs.nextRetryAt,
  completedAt: uploadJobs.completedAt,
  createdAt: uploadJobs.createdAt,
  updatedAt: uploadJobs.updatedAt,
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
    .from(uploadJobs)
    .where(eq(uploadJobs.id, jobId))
    .limit(1);

  if (!row) return null;
  return mapJobRecord(row);
}

export async function assertJobNotCancellationRequested(jobId: number): Promise<void> {
  const [row] = await db.select({
    cancelRequestedAt: uploadJobs.cancelRequestedAt,
    canceledAt: uploadJobs.canceledAt,
  })
    .from(uploadJobs)
    .where(eq(uploadJobs.id, jobId))
    .limit(1);

  if (!row) return;
  if (row.canceledAt || row.cancelRequestedAt) {
    throw createUploadConfirmJobError('JOB_CANCELED', '管理者によりジョブがキャンセルされました', false);
  }
}

function buildClaimableStatusCondition(staleBeforeIso: string): ReturnType<typeof and> {
  return and(
    buildNotCanceledCondition(),
    or(
      eq(uploadJobs.status, 'pending'),
      and(
        eq(uploadJobs.status, 'processing'),
        or(
          isNull(uploadJobs.processingStartedAt),
          lt(uploadJobs.processingStartedAt, staleBeforeIso),
        ),
      ),
    ),
  );
}

function buildNoOtherActiveProcessingCondition(
  candidateId: number,
  staleBeforeIso: string,
): ReturnType<typeof notExists> {
  return notExists(
    db.select({ id: uploadJobs.id })
      .from(uploadJobs)
      .where(and(
        eq(uploadJobs.status, 'processing'),
        buildNotCanceledCondition(),
        gte(uploadJobs.processingStartedAt, staleBeforeIso),
        ne(uploadJobs.id, candidateId),
      )),
  );
}

function buildClaimStatusMatchCondition(
  candidateStatus: 'pending' | 'processing',
  staleBeforeIso: string,
): ReturnType<typeof eq> | ReturnType<typeof or> {
  if (candidateStatus === 'pending') {
    return eq(uploadJobs.status, 'pending');
  }
  return or(
    isNull(uploadJobs.processingStartedAt),
    lt(uploadJobs.processingStartedAt, staleBeforeIso),
  );
}

function buildClaimCandidateCondition(
  staleBeforeIso: string,
  nowIso: string,
): ReturnType<typeof and> {
  return and(
    buildClaimableStatusCondition(staleBeforeIso),
    lt(uploadJobs.attempts, MAX_JOB_ATTEMPTS),
    buildRetryReadyCondition(nowIso),
  );
}

function buildClaimUpdateCondition(
  candidateId: number,
  candidateStatus: 'pending' | 'processing',
  candidateAttempts: number,
  staleBeforeIso: string,
  nowIso: string,
): ReturnType<typeof and> {
  return and(
    eq(uploadJobs.id, candidateId),
    buildNotCanceledCondition(),
    eq(uploadJobs.status, candidateStatus),
    eq(uploadJobs.attempts, candidateAttempts),
    lt(uploadJobs.attempts, MAX_JOB_ATTEMPTS),
    buildRetryReadyCondition(nowIso),
    buildNoOtherActiveProcessingCondition(candidateId, staleBeforeIso),
    buildClaimStatusMatchCondition(candidateStatus, staleBeforeIso),
  );
}

export async function claimPendingUploadConfirmJob(): Promise<UploadConfirmJobRuntime | null> {
  for (let attempt = 0; attempt < CLAIM_CONTENTION_RETRY_LIMIT; attempt += 1) {
    const nowIso = new Date().toISOString();
    const staleBeforeIso = getStaleBeforeIso(JOB_STALE_TIMEOUT_MS);
    const [candidate] = await db.select(JOB_RUNTIME_COLUMNS)
      .from(uploadJobs)
      .where(buildClaimCandidateCondition(staleBeforeIso, nowIso))
      .orderBy(
        asc(uploadJobs.createdAt),
        asc(uploadJobs.id),
      )
      .limit(1);

    if (!candidate) return null;

    const candidateStatus = normalizeClaimableStatus(candidate.status);

    const [claimed] = await db.update(uploadJobs)
      .set({
        status: 'processing',
        processingStartedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(buildClaimUpdateCondition(
        candidate.id,
        candidateStatus,
        candidate.attempts,
        staleBeforeIso,
        nowIso,
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
    .from(uploadJobs)
    .where(and(
      eq(uploadJobs.pharmacyId, pharmacyId),
      eq(uploadJobs.idempotencyKey, idempotencyKey),
      inArray(uploadJobs.status, IDEMPOTENT_DEDUP_JOB_STATUSES),
      isNull(uploadJobs.canceledAt),
    ))
    .orderBy(asc(uploadJobs.id))
    .limit(1);

  if (!row) return null;
  return mapJobRecord(row);
}
