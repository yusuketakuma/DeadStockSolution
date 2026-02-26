import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { exchangeHistory, exchangeProposals, monthlyReports, uploads, deadStockItems } from '../db/schema';

export interface MonthlyReportMetrics {
  year: number;
  month: number;
  periodStart: string;
  periodEnd: string;
  proposalCount: number;
  completedExchangeCount: number;
  rejectedProposalCount: number;
  confirmedProposalCount: number;
  totalExchangeValue: number;
  uploadCount: number;
  deadStockUploadCount: number;
  usedMedicationUploadCount: number;
  nearExpiryItemCount: number;
  expiredItemCount: number;
}

function to2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

export function resolveDefaultTargetMonth(now: Date = new Date()): { year: number; month: number } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: month - 1 };
}

export function validateYearMonth(year: number, month: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('年の指定が不正です');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('月の指定が不正です');
  }
}

export async function buildMonthlyReportMetrics(year: number, month: number): Promise<MonthlyReportMetrics> {
  validateYearMonth(year, month);

  const start = toMonthStart(year, month);
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const today = new Date();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const nearExpiryLimit = new Date(todayDate.getTime() + (120 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  const todayIsoDate = todayDate.toISOString().slice(0, 10);

  const [
    [proposalCountRow],
    [rejectedCountRow],
    [confirmedCountRow],
    [historyCountRow],
    [totalExchangeValueRow],
    [uploadCountRow],
    [deadStockUploadCountRow],
    [usedMedUploadCountRow],
    [nearExpiryCountRow],
    [expiredCountRow],
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(exchangeProposals)
      .where(and(
        gte(exchangeProposals.proposedAt, startIso),
        lt(exchangeProposals.proposedAt, endIso),
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(exchangeProposals)
      .where(and(
        gte(exchangeProposals.proposedAt, startIso),
        lt(exchangeProposals.proposedAt, endIso),
        eq(exchangeProposals.status, 'rejected'),
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(exchangeProposals)
      .where(and(
        gte(exchangeProposals.proposedAt, startIso),
        lt(exchangeProposals.proposedAt, endIso),
        eq(exchangeProposals.status, 'confirmed'),
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(exchangeHistory)
      .where(and(
        gte(exchangeHistory.completedAt, startIso),
        lt(exchangeHistory.completedAt, endIso),
      )),
    db.select({ total: sql<number>`coalesce(sum(${exchangeHistory.totalValue}), 0)` })
      .from(exchangeHistory)
      .where(and(
        gte(exchangeHistory.completedAt, startIso),
        lt(exchangeHistory.completedAt, endIso),
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(uploads)
      .where(and(
        gte(uploads.createdAt, startIso),
        lt(uploads.createdAt, endIso),
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(uploads)
      .where(and(
        gte(uploads.createdAt, startIso),
        lt(uploads.createdAt, endIso),
        eq(uploads.uploadType, 'dead_stock'),
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(uploads)
      .where(and(
        gte(uploads.createdAt, startIso),
        lt(uploads.createdAt, endIso),
        eq(uploads.uploadType, 'used_medication'),
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(deadStockItems)
      .where(and(
        eq(deadStockItems.isAvailable, true),
        gte(deadStockItems.expirationDateIso, todayIsoDate),
        lte(deadStockItems.expirationDateIso, nearExpiryLimit),
      )),
    db.select({ count: sql<number>`count(*)` })
      .from(deadStockItems)
      .where(and(
        eq(deadStockItems.isAvailable, true),
        lt(deadStockItems.expirationDateIso, todayIsoDate),
      )),
  ]);

  return {
    year,
    month,
    periodStart: startIso,
    periodEnd: endIso,
    proposalCount: Number(proposalCountRow?.count ?? 0),
    completedExchangeCount: Number(historyCountRow?.count ?? 0),
    rejectedProposalCount: Number(rejectedCountRow?.count ?? 0),
    confirmedProposalCount: Number(confirmedCountRow?.count ?? 0),
    totalExchangeValue: to2(Number(totalExchangeValueRow?.total ?? 0)),
    uploadCount: Number(uploadCountRow?.count ?? 0),
    deadStockUploadCount: Number(deadStockUploadCountRow?.count ?? 0),
    usedMedicationUploadCount: Number(usedMedUploadCountRow?.count ?? 0),
    nearExpiryItemCount: Number(nearExpiryCountRow?.count ?? 0),
    expiredItemCount: Number(expiredCountRow?.count ?? 0),
  };
}

export async function generateMonthlyReport(year: number, month: number, generatedBy: number | null): Promise<{
  id: number;
  year: number;
  month: number;
  generatedAt: string | null;
  metrics: MonthlyReportMetrics;
}> {
  const metrics = await buildMonthlyReportMetrics(year, month);
  const now = new Date().toISOString();
  const payload = JSON.stringify(metrics);

  const [saved] = await db.insert(monthlyReports).values({
    year,
    month,
    status: 'success',
    reportJson: payload,
    generatedBy,
    generatedAt: now,
  }).onConflictDoUpdate({
    target: [monthlyReports.year, monthlyReports.month],
    set: {
      status: 'success',
      reportJson: payload,
      generatedBy,
      generatedAt: now,
    },
  }).returning({
    id: monthlyReports.id,
    year: monthlyReports.year,
    month: monthlyReports.month,
    generatedAt: monthlyReports.generatedAt,
  });

  return {
    id: saved.id,
    year: saved.year,
    month: saved.month,
    generatedAt: saved.generatedAt,
    metrics,
  };
}

export async function listMonthlyReports(page: number, limit: number): Promise<{ data: Array<{
  id: number;
  year: number;
  month: number;
  status: 'success' | 'failed';
  generatedBy: number | null;
  generatedAt: string | null;
}>; total: number }> {
  const offset = (page - 1) * limit;

  const [rows, [totalRow]] = await Promise.all([
    db.select({
      id: monthlyReports.id,
      year: monthlyReports.year,
      month: monthlyReports.month,
      status: monthlyReports.status,
      generatedBy: monthlyReports.generatedBy,
      generatedAt: monthlyReports.generatedAt,
    })
      .from(monthlyReports)
      .orderBy(desc(monthlyReports.year), desc(monthlyReports.month), desc(monthlyReports.id))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(monthlyReports),
  ]);

  return {
    data: rows,
    total: Number(totalRow?.count ?? 0),
  };
}

export async function getMonthlyReportById(id: number): Promise<{
  id: number;
  year: number;
  month: number;
  status: 'success' | 'failed';
  generatedAt: string | null;
  reportJson: string;
} | null> {
  const [row] = await db.select({
    id: monthlyReports.id,
    year: monthlyReports.year,
    month: monthlyReports.month,
    status: monthlyReports.status,
    generatedAt: monthlyReports.generatedAt,
    reportJson: monthlyReports.reportJson,
  })
    .from(monthlyReports)
    .where(eq(monthlyReports.id, id))
    .limit(1);

  return row ?? null;
}

function escapeCsv(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function monthlyReportToCsv(metrics: MonthlyReportMetrics): string {
  const rows: Array<[string, string | number]> = [
    ['year', metrics.year],
    ['month', metrics.month],
    ['periodStart', metrics.periodStart],
    ['periodEnd', metrics.periodEnd],
    ['proposalCount', metrics.proposalCount],
    ['completedExchangeCount', metrics.completedExchangeCount],
    ['rejectedProposalCount', metrics.rejectedProposalCount],
    ['confirmedProposalCount', metrics.confirmedProposalCount],
    ['totalExchangeValue', metrics.totalExchangeValue],
    ['uploadCount', metrics.uploadCount],
    ['deadStockUploadCount', metrics.deadStockUploadCount],
    ['usedMedicationUploadCount', metrics.usedMedicationUploadCount],
    ['nearExpiryItemCount', metrics.nearExpiryItemCount],
    ['expiredItemCount', metrics.expiredItemCount],
  ];

  return [
    'key,value',
    ...rows.map(([key, value]) => `${escapeCsv(key)},${escapeCsv(value)}`),
  ].join('\n');
}
