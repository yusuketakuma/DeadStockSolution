import { asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { uploadRowIssues } from '../db/schema';
import { rowCount } from '../utils/db-utils';

const ISSUE_INSERT_BATCH_SIZE = 500;

export type UploadRowIssueUploadType = 'dead_stock' | 'used_medication';

export interface UploadRowIssueInput {
  rowNumber: number;
  issueCode: string;
  issueMessage: string;
  rowData: unknown[] | Record<string, unknown> | null;
}

export interface UploadRowIssueRecord {
  id: number;
  jobId: number;
  pharmacyId: number;
  uploadType: UploadRowIssueUploadType;
  rowNumber: number;
  issueCode: string;
  issueMessage: string;
  rowDataJson: string | null;
  createdAt: string | null;
}

export interface UploadRowIssueSummary {
  totalIssues: number;
  byCode: Record<string, number>;
}

type UploadRowIssueReadExecutor = Pick<typeof db, 'select'>;
type UploadRowIssueWriteExecutor = Pick<typeof db, 'insert' | 'delete'>;

function safeStringifyRowData(rowData: unknown[] | Record<string, unknown> | null): string | null {
  if (rowData === null) return null;
  try {
    return JSON.stringify(rowData);
  } catch {
    return null;
  }
}

function quoteCsvField(value: string): string {
  const normalizedValue = /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n]/.test(normalizedValue)) {
    return `"${normalizedValue.replace(/"/g, '""')}"`;
  }
  return normalizedValue;
}

export async function replaceUploadRowIssuesForJob(
  jobId: number,
  pharmacyId: number,
  uploadType: UploadRowIssueUploadType,
  issues: UploadRowIssueInput[],
  executor: UploadRowIssueWriteExecutor = db,
): Promise<void> {
  await executor.delete(uploadRowIssues).where(eq(uploadRowIssues.jobId, jobId));
  if (issues.length === 0) {
    return;
  }

  const nowIso = new Date().toISOString();
  for (let i = 0; i < issues.length; i += ISSUE_INSERT_BATCH_SIZE) {
    const batch = issues.slice(i, i + ISSUE_INSERT_BATCH_SIZE);
    await executor.insert(uploadRowIssues).values(batch.map((issue) => ({
      jobId,
      pharmacyId,
      uploadType,
      rowNumber: issue.rowNumber,
      issueCode: issue.issueCode,
      issueMessage: issue.issueMessage,
      rowDataJson: safeStringifyRowData(issue.rowData),
      createdAt: nowIso,
    })));
  }
}

export async function clearUploadRowIssuesForJob(
  jobId: number,
  executor: UploadRowIssueWriteExecutor = db,
): Promise<void> {
  await executor.delete(uploadRowIssues).where(eq(uploadRowIssues.jobId, jobId));
}

export async function getUploadRowIssueCountByJobIds(
  jobIds: number[],
  executor: UploadRowIssueReadExecutor = db,
): Promise<Map<number, number>> {
  if (jobIds.length === 0) {
    return new Map();
  }

  const rows = await executor.select({
    jobId: uploadRowIssues.jobId,
    count: rowCount,
  })
    .from(uploadRowIssues)
    .where(inArray(uploadRowIssues.jobId, jobIds))
    .groupBy(uploadRowIssues.jobId);

  return new Map(rows.map((row) => [row.jobId, row.count]));
}

export async function getUploadRowIssueCountByJobId(
  jobId: number,
  executor: UploadRowIssueReadExecutor = db,
): Promise<number> {
  const [row] = await executor.select({
    count: rowCount,
  })
    .from(uploadRowIssues)
    .where(eq(uploadRowIssues.jobId, jobId));

  return row?.count ?? 0;
}

export async function getUploadRowIssuesForJob(
  jobId: number,
  options: { limit?: number; offset?: number } = {},
  executor: UploadRowIssueReadExecutor = db,
): Promise<UploadRowIssueRecord[]> {
  const limit = Number.isInteger(options.limit) && Number(options.limit) > 0
    ? Number(options.limit)
    : 10000;
  const offset = Number.isInteger(options.offset) && Number(options.offset) >= 0
    ? Number(options.offset)
    : 0;

  return executor.select({
    id: uploadRowIssues.id,
    jobId: uploadRowIssues.jobId,
    pharmacyId: uploadRowIssues.pharmacyId,
    uploadType: uploadRowIssues.uploadType,
    rowNumber: uploadRowIssues.rowNumber,
    issueCode: uploadRowIssues.issueCode,
    issueMessage: uploadRowIssues.issueMessage,
    rowDataJson: uploadRowIssues.rowDataJson,
    createdAt: uploadRowIssues.createdAt,
  })
    .from(uploadRowIssues)
    .where(eq(uploadRowIssues.jobId, jobId))
    .orderBy(asc(uploadRowIssues.rowNumber), asc(uploadRowIssues.id))
    .limit(limit)
    .offset(offset);
}

export async function getUploadRowIssueSummary(
  jobId: number,
  executor: UploadRowIssueReadExecutor = db,
): Promise<UploadRowIssueSummary> {
  const rows = await executor.select({
    issueCode: uploadRowIssues.issueCode,
    count: rowCount,
  })
    .from(uploadRowIssues)
    .where(eq(uploadRowIssues.jobId, jobId))
    .groupBy(uploadRowIssues.issueCode)
    .orderBy(desc(uploadRowIssues.issueCode));

  const byCode: Record<string, number> = {};
  let totalIssues = 0;
  for (const row of rows) {
    byCode[row.issueCode] = row.count;
    totalIssues += row.count;
  }

  return {
    totalIssues,
    byCode,
  };
}

export async function getUploadRowIssueSummaryByJobIds(
  jobIds: number[],
  executor: UploadRowIssueReadExecutor = db,
): Promise<Map<number, UploadRowIssueSummary>> {
  if (jobIds.length === 0) {
    return new Map();
  }

  const rows = await executor.select({
    jobId: uploadRowIssues.jobId,
    issueCode: uploadRowIssues.issueCode,
    count: rowCount,
  })
    .from(uploadRowIssues)
    .where(inArray(uploadRowIssues.jobId, jobIds))
    .groupBy(uploadRowIssues.jobId, uploadRowIssues.issueCode);

  const summaryMap = new Map<number, UploadRowIssueSummary>();
  for (const row of rows) {
    const current = summaryMap.get(row.jobId) ?? { totalIssues: 0, byCode: {} };
    current.byCode[row.issueCode] = row.count;
    current.totalIssues += row.count;
    summaryMap.set(row.jobId, current);
  }

  return summaryMap;
}

export function buildUploadRowIssueCsv(issues: UploadRowIssueRecord[]): string {
  const headers = ['rowNumber', 'issueCode', 'issueMessage', 'rowDataJson'];
  const lines = [headers.join(',')];

  for (const issue of issues) {
    lines.push([
      String(issue.rowNumber),
      quoteCsvField(issue.issueCode),
      quoteCsvField(issue.issueMessage),
      quoteCsvField(issue.rowDataJson ?? ''),
    ].join(','));
  }

  return lines.join('\n');
}
