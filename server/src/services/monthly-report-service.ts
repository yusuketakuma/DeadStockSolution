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

function buildMonthRange(year: number, month: number) {
  const start = toMonthStart(year, month);
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function buildExpiryWindow(now: Date = new Date()) {
  const todayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    todayIsoDate: todayDate.toISOString().slice(0, 10),
    nearExpiryLimit: new Date(todayDate.getTime() + (120 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
  };
}

function toMetricNumber(value: unknown): number {
  return Number(value ?? 0);
}

async function countByWhere(table: typeof exchangeProposals | typeof exchangeHistory | typeof uploads | typeof deadStockItems, whereClause: ReturnType<typeof and>) {
  const [row] = await db.select({ count: sql<number>`count(*)` })
    .from(table)
    .where(whereClause);
  return Number(row?.count ?? 0);
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

  const { startIso, endIso } = buildMonthRange(year, month);
  const { todayIsoDate, nearExpiryLimit } = buildExpiryWindow();

  const [
    proposalCount,
    rejectedProposalCount,
    confirmedProposalCount,
    completedExchangeCount,
    [totalExchangeValueRow],
    uploadCount,
    deadStockUploadCount,
    usedMedicationUploadCount,
    nearExpiryItemCount,
    expiredItemCount,
  ] = await Promise.all([
    countByWhere(exchangeProposals, and(
      gte(exchangeProposals.proposedAt, startIso),
      lt(exchangeProposals.proposedAt, endIso),
    )),
    countByWhere(exchangeProposals, and(
      gte(exchangeProposals.proposedAt, startIso),
      lt(exchangeProposals.proposedAt, endIso),
      eq(exchangeProposals.status, 'rejected'),
    )),
    countByWhere(exchangeProposals, and(
      gte(exchangeProposals.proposedAt, startIso),
      lt(exchangeProposals.proposedAt, endIso),
      eq(exchangeProposals.status, 'confirmed'),
    )),
    countByWhere(exchangeHistory, and(
      gte(exchangeHistory.completedAt, startIso),
      lt(exchangeHistory.completedAt, endIso),
    )),
    db.select({ total: sql<number>`coalesce(sum(${exchangeHistory.totalValue}), 0)` })
      .from(exchangeHistory)
      .where(and(
        gte(exchangeHistory.completedAt, startIso),
        lt(exchangeHistory.completedAt, endIso),
      )),
    countByWhere(uploads, and(
      gte(uploads.createdAt, startIso),
      lt(uploads.createdAt, endIso),
    )),
    countByWhere(uploads, and(
      gte(uploads.createdAt, startIso),
      lt(uploads.createdAt, endIso),
      eq(uploads.uploadType, 'dead_stock'),
    )),
    countByWhere(uploads, and(
      gte(uploads.createdAt, startIso),
      lt(uploads.createdAt, endIso),
      eq(uploads.uploadType, 'used_medication'),
    )),
    countByWhere(deadStockItems, and(
      eq(deadStockItems.isAvailable, true),
      gte(deadStockItems.expirationDateIso, todayIsoDate),
      lte(deadStockItems.expirationDateIso, nearExpiryLimit),
    )),
    countByWhere(deadStockItems, and(
      eq(deadStockItems.isAvailable, true),
      lt(deadStockItems.expirationDateIso, todayIsoDate),
    )),
  ]);

  return {
    year,
    month,
    periodStart: startIso,
    periodEnd: endIso,
    proposalCount,
    completedExchangeCount,
    rejectedProposalCount,
    confirmedProposalCount,
    totalExchangeValue: to2(toMetricNumber(totalExchangeValueRow?.total)),
    uploadCount,
    deadStockUploadCount,
    usedMedicationUploadCount,
    nearExpiryItemCount,
    expiredItemCount,
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
    total: toMetricNumber(totalRow?.count),
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

function buildMonthlyReportCsvRows(metrics: MonthlyReportMetrics): Array<[string, string | number]> {
  return [
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
}

export function monthlyReportToCsv(metrics: MonthlyReportMetrics): string {
  return [
    'key,value',
    ...buildMonthlyReportCsvRows(metrics).map(([key, value]) => `${escapeCsv(key)},${escapeCsv(value)}`),
  ].join('\n');
}
