import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, uploadConfirmJobs } from '../db/schema';
import { rowCount } from '../utils/db-utils';
import {
  buildUploadRowIssueCsv,
  getUploadRowIssueCountByJobIds,
  getUploadRowIssueSummary,
  getUploadRowIssuesForJob,
} from './upload-row-issue-service';
import {
  cancelUploadConfirmJobByAdmin,
  getUploadConfirmJobById,
  isUploadConfirmRetryUnavailableError,
  retryUploadConfirmJobByAdmin,
} from './upload-confirm-job-service';
import { type ApplyMode, type UploadType } from './upload-confirm-service';

type StoredUploadJobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type UploadJobStatus = StoredUploadJobStatus | 'canceled';

export interface AdminUploadJobListFilters {
  page: number;
  limit: number;
  pharmacyId?: number;
  status?: UploadJobStatus;
  uploadType?: UploadType;
  applyMode?: ApplyMode;
  keyword?: string;
}

export interface AdminUploadJobSummary {
  id: number;
  pharmacyId: number;
  pharmacyName: string | null;
  uploadType: UploadType;
  originalFilename: string;
  status: UploadJobStatus;
  applyMode: ApplyMode;
  attempts: number;
  deduplicated: boolean;
  cancelable: boolean;
  canceledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  partialSummary: unknown;
  errorReportAvailable: boolean;
}

export interface AdminUploadJobDetail extends AdminUploadJobSummary {
  idempotencyKey: string | null;
  fileHash: string;
  deleteMissing: boolean;
  lastError: string | null;
  result: unknown;
  issueCount: number;
}

export interface AdminUploadJobErrorReport {
  filename: string;
  contentType: string;
  body: string;
  issueCount: number;
}

export interface AdminUploadJobListResult {
  data: AdminUploadJobSummary[];
  total: number;
}

function resolveUploadJobStatus(
  status: StoredUploadJobStatus,
  cancelRequestedAt: string | null,
  canceledAt: string | null,
): UploadJobStatus {
  if (cancelRequestedAt || canceledAt) {
    return 'canceled';
  }
  return status;
}

function parseResultJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractPartialSummary(result: unknown): unknown {
  if (!result || typeof result !== 'object') {
    return null;
  }
  return (result as Record<string, unknown>).partialSummary ?? null;
}

function resolveErrorReportAvailable(issueCount: number, result: unknown): boolean {
  if (issueCount > 0) return true;
  if (!result || typeof result !== 'object') return false;

  const resultObject = result as Record<string, unknown>;
  if (resultObject.errorReportAvailable === true) {
    return true;
  }

  const partialSummary = resultObject.partialSummary;
  if (!partialSummary || typeof partialSummary !== 'object') {
    return false;
  }

  const rejectedRows = Number((partialSummary as Record<string, unknown>).rejectedRows ?? 0);
  return Number.isFinite(rejectedRows) && rejectedRows > 0;
}

function createWhereConditions(filters: AdminUploadJobListFilters): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = [];
  if (filters.pharmacyId) {
    conditions.push(eq(uploadConfirmJobs.pharmacyId, filters.pharmacyId));
  }
  if (filters.status) {
    if (filters.status === 'canceled') {
      conditions.push(or(
        isNotNull(uploadConfirmJobs.cancelRequestedAt),
        isNotNull(uploadConfirmJobs.canceledAt),
      )!);
    } else {
      conditions.push(eq(uploadConfirmJobs.status, filters.status as StoredUploadJobStatus));
      conditions.push(isNull(uploadConfirmJobs.cancelRequestedAt));
      conditions.push(isNull(uploadConfirmJobs.canceledAt));
    }
  }
  if (filters.uploadType) {
    conditions.push(eq(uploadConfirmJobs.uploadType, filters.uploadType));
  }
  if (filters.applyMode) {
    conditions.push(eq(uploadConfirmJobs.applyMode, filters.applyMode));
  }
  if (filters.keyword) {
    const keywordLike = `%${filters.keyword}%`;
    conditions.push(or(
      ilike(uploadConfirmJobs.originalFilename, keywordLike),
      ilike(uploadConfirmJobs.lastError, keywordLike),
      sql<boolean>`exists (
        select 1
        from ${pharmacies}
        where ${pharmacies.id} = ${uploadConfirmJobs.pharmacyId}
          and ${pharmacies.name} ilike ${keywordLike}
      )`,
    )!);
  }
  return conditions;
}

export async function listAdminUploadJobs(
  filters: AdminUploadJobListFilters,
): Promise<AdminUploadJobListResult> {
  const offset = (filters.page - 1) * filters.limit;
  const whereConditions = createWhereConditions(filters);
  const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

  const rows = await db.select({
    id: uploadConfirmJobs.id,
    pharmacyId: uploadConfirmJobs.pharmacyId,
    uploadType: uploadConfirmJobs.uploadType,
    originalFilename: uploadConfirmJobs.originalFilename,
    status: uploadConfirmJobs.status,
    applyMode: uploadConfirmJobs.applyMode,
    attempts: uploadConfirmJobs.attempts,
    deduplicated: uploadConfirmJobs.deduplicated,
    cancelRequestedAt: uploadConfirmJobs.cancelRequestedAt,
    canceledAt: uploadConfirmJobs.canceledAt,
    resultJson: uploadConfirmJobs.resultJson,
    createdAt: uploadConfirmJobs.createdAt,
    updatedAt: uploadConfirmJobs.updatedAt,
    completedAt: uploadConfirmJobs.completedAt,
  })
    .from(uploadConfirmJobs)
    .where(whereClause)
    .orderBy(desc(uploadConfirmJobs.createdAt), desc(uploadConfirmJobs.id))
    .limit(filters.limit)
    .offset(offset);

  const [totalRow] = await db.select({
    count: rowCount,
  })
    .from(uploadConfirmJobs)
    .where(whereClause);

  const pharmacyIds = [...new Set(rows.map((row) => row.pharmacyId))];
  const pharmacyRows = pharmacyIds.length > 0
    ? await db.select({
      id: pharmacies.id,
      name: pharmacies.name,
    })
      .from(pharmacies)
      .where(inArray(pharmacies.id, pharmacyIds))
    : [];
  const pharmacyMap = new Map(pharmacyRows.map((row) => [row.id, row.name]));

  const issueCountMap = await getUploadRowIssueCountByJobIds(rows.map((row) => row.id));

  const data: AdminUploadJobSummary[] = rows.map((row) => {
    const result = parseResultJson(row.resultJson);
    const partialSummary = extractPartialSummary(result);
    const issueCount = issueCountMap.get(row.id) ?? 0;
    const resolvedStatus = resolveUploadJobStatus(
      row.status as StoredUploadJobStatus,
      row.cancelRequestedAt,
      row.canceledAt,
    );
    const cancelable = (row.status === 'pending' || row.status === 'processing')
      && !row.cancelRequestedAt
      && !row.canceledAt;

    return {
      id: row.id,
      pharmacyId: row.pharmacyId,
      pharmacyName: pharmacyMap.get(row.pharmacyId) ?? null,
      uploadType: row.uploadType,
      originalFilename: row.originalFilename,
      status: resolvedStatus,
      applyMode: row.applyMode as ApplyMode,
      attempts: row.attempts,
      deduplicated: row.deduplicated,
      cancelable,
      canceledAt: row.canceledAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
      partialSummary,
      errorReportAvailable: resolveErrorReportAvailable(issueCount, result),
    };
  });

  return {
    data,
    total: totalRow?.count ?? 0,
  };
}

export async function getAdminUploadJobDetail(jobId: number): Promise<AdminUploadJobDetail | null> {
  const job = await getUploadConfirmJobById(jobId);
  if (!job) return null;

  const [pharmacy] = await db.select({
    name: pharmacies.name,
  })
    .from(pharmacies)
    .where(eq(pharmacies.id, job.pharmacyId))
    .limit(1);

  const result = parseResultJson(job.resultJson);
  const partialSummary = extractPartialSummary(result);
  const resolvedStatus = resolveUploadJobStatus(
    job.status as StoredUploadJobStatus,
    job.cancelRequestedAt,
    job.canceledAt,
  );

  return {
    id: job.id,
    pharmacyId: job.pharmacyId,
    pharmacyName: pharmacy?.name ?? null,
    uploadType: job.uploadType,
    originalFilename: job.originalFilename,
    status: resolvedStatus,
    applyMode: job.applyMode,
    attempts: job.attempts,
    deduplicated: job.deduplicated,
    cancelable: job.cancelable,
    canceledAt: job.canceledAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    partialSummary,
    errorReportAvailable: resolveErrorReportAvailable(job.issueCount, result),
    idempotencyKey: job.idempotencyKey,
    fileHash: job.fileHash,
    deleteMissing: job.deleteMissing,
    lastError: job.lastError,
    result,
    issueCount: job.issueCount,
  };
}

export async function cancelAdminUploadJob(
  jobId: number,
  adminPharmacyId: number,
): Promise<Awaited<ReturnType<typeof cancelUploadConfirmJobByAdmin>>> {
  return cancelUploadConfirmJobByAdmin(jobId, adminPharmacyId);
}

export async function retryAdminUploadJob(
  jobId: number,
): Promise<Awaited<ReturnType<typeof retryUploadConfirmJobByAdmin>>> {
  return retryUploadConfirmJobByAdmin(jobId);
}

export async function getAdminUploadJobErrorReport(
  jobId: number,
  format: 'csv' | 'json',
): Promise<AdminUploadJobErrorReport | null> {
  const issues = await getUploadRowIssuesForJob(jobId);
  if (issues.length === 0) {
    return null;
  }

  const summary = await getUploadRowIssueSummary(jobId);
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

  if (format === 'json') {
    return {
      filename: `upload-job-${jobId}-error-report-${timestamp}.json`,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        jobId,
        issueCount: issues.length,
        summary,
        issues,
      }, null, 2),
      issueCount: issues.length,
    };
  }

  return {
    filename: `upload-job-${jobId}-error-report-${timestamp}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: buildUploadRowIssueCsv(issues),
    issueCount: issues.length,
  };
}

export { isUploadConfirmRetryUnavailableError };
