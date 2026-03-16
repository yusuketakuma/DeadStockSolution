import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { uploadRowIssues, pharmacies } from '../db/schema';
import { rowCount } from '../utils/db-utils';

export async function getUploadQualitySummary() {
  const [issuesByCode, issuesByPharmacy, [totalRow]] = await Promise.all([
    db.select({
      issueCode: uploadRowIssues.issueCode,
      count: sql<number>`count(*)`.as('count'),
    })
      .from(uploadRowIssues)
      .groupBy(uploadRowIssues.issueCode)
      .orderBy(sql`count(*) desc`)
      .limit(20),
    db.select({
      pharmacyId: uploadRowIssues.pharmacyId,
      pharmacyName: pharmacies.name,
      issueCount: sql<number>`count(*)`.as('issue_count'),
    })
      .from(uploadRowIssues)
      .leftJoin(pharmacies, eq(uploadRowIssues.pharmacyId, pharmacies.id))
      .groupBy(uploadRowIssues.pharmacyId, pharmacies.name)
      .orderBy(sql`count(*) desc`)
      .limit(30),
    db.select({ count: rowCount }).from(uploadRowIssues),
  ]);

  return {
    totalIssues: totalRow.count,
    issuesByCode,
    issuesByPharmacy,
  };
}

export interface UploadIssueListParams {
  page: number;
  limit: number;
  offset: number;
  issueCode?: string;
}

export async function listUploadIssues(params: UploadIssueListParams) {
  const where = params.issueCode ? eq(uploadRowIssues.issueCode, params.issueCode) : undefined;

  const [data, [totalRow]] = await Promise.all([
    db.select({
      id: uploadRowIssues.id,
      jobId: uploadRowIssues.jobId,
      pharmacyId: uploadRowIssues.pharmacyId,
      pharmacyName: pharmacies.name,
      uploadType: uploadRowIssues.uploadType,
      rowNumber: uploadRowIssues.rowNumber,
      issueCode: uploadRowIssues.issueCode,
      issueMessage: uploadRowIssues.issueMessage,
      createdAt: uploadRowIssues.createdAt,
    })
      .from(uploadRowIssues)
      .leftJoin(pharmacies, eq(uploadRowIssues.pharmacyId, pharmacies.id))
      .where(where)
      .orderBy(desc(uploadRowIssues.createdAt))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ count: rowCount }).from(uploadRowIssues).where(where),
  ]);

  return { data, total: totalRow.count };
}
