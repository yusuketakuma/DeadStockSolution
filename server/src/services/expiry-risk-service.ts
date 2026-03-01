import { and, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, pharmacies } from '../db/schema';

export interface RiskBucketCounts {
  expired: number;
  within30: number;
  within60: number;
  within90: number;
  within120: number;
  over120: number;
  unknown: number;
}

export interface ExpiryRiskItem {
  id: number;
  pharmacyId: number;
  pharmacyName?: string;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaTotal: number;
  expirationDate: string | null;
  daysUntilExpiry: number | null;
  bucket: keyof RiskBucketCounts;
}

export interface PharmacyRiskSummary {
  pharmacyId: number;
  pharmacyName: string;
  totalItems: number;
  riskScore: number;
  bucketCounts: RiskBucketCounts;
}

export interface PharmacyRiskDetail {
  pharmacyId: number;
  totalItems: number;
  riskScore: number;
  bucketCounts: RiskBucketCounts;
  topRiskItems: ExpiryRiskItem[];
  computedAt: string;
}

export interface AdminRiskOverview {
  totalPharmacies: number;
  highRiskPharmacies: number;
  mediumRiskPharmacies: number;
  lowRiskPharmacies: number;
  avgRiskScore: number;
  totalBucketCounts: RiskBucketCounts;
  topHighRiskPharmacies: PharmacyRiskSummary[];
  computedAt: string;
}

const EMPTY_BUCKETS: RiskBucketCounts = {
  expired: 0,
  within30: 0,
  within60: 0,
  within90: 0,
  within120: 0,
  over120: 0,
  unknown: 0,
};

const RISK_WEIGHTS: Record<keyof RiskBucketCounts, number> = {
  expired: 1,
  within30: 0.9,
  within60: 0.7,
  within90: 0.45,
  within120: 0.25,
  over120: 0.05,
  unknown: 0.35,
};
const ADMIN_RISK_CACHE_TTL_MS = resolveAdminRiskCacheTtlMs(process.env.ADMIN_RISK_CACHE_TTL_MS);

interface AdminRiskSnapshot {
  summaries: PharmacyRiskSummary[];
  totalBucketCounts: RiskBucketCounts;
  computedAt: string;
}

let adminRiskSnapshotCache: { expiresAt: number; value: AdminRiskSnapshot } | null = null;

// ユーザー向けリスク詳細キャッシュ (pharmacyId → cached)
const USER_RISK_CACHE_TTL_MS = 30_000;
const userRiskCache = new Map<number, { expiresAt: number; value: PharmacyRiskDetail }>();

function resolveAdminRiskCacheTtlMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 60_000;
  }
  return Math.min(Math.max(parsed, 5_000), 10 * 60 * 1000);
}

function createEmptyBuckets(): RiskBucketCounts {
  return { ...EMPTY_BUCKETS };
}

function getTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.replace(/\//g, '-').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function resolveBucket(daysUntilExpiry: number | null): keyof RiskBucketCounts {
  if (daysUntilExpiry === null) return 'unknown';
  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 30) return 'within30';
  if (daysUntilExpiry <= 60) return 'within60';
  if (daysUntilExpiry <= 90) return 'within90';
  if (daysUntilExpiry <= 120) return 'within120';
  return 'over120';
}

function to2(value: number): number {
  return Math.round(value * 100) / 100;
}

function calculateRiskScore(bucketCounts: RiskBucketCounts, totalItems: number): number {
  if (totalItems <= 0) return 0;
  const weightedSum =
    bucketCounts.expired * RISK_WEIGHTS.expired +
    bucketCounts.within30 * RISK_WEIGHTS.within30 +
    bucketCounts.within60 * RISK_WEIGHTS.within60 +
    bucketCounts.within90 * RISK_WEIGHTS.within90 +
    bucketCounts.within120 * RISK_WEIGHTS.within120 +
    bucketCounts.over120 * RISK_WEIGHTS.over120 +
    bucketCounts.unknown * RISK_WEIGHTS.unknown;

  return to2((weightedSum / totalItems) * 100);
}

function calculateItemRiskWeight(bucket: keyof RiskBucketCounts): number {
  return RISK_WEIGHTS[bucket] * 100;
}

type RiskRow = {
  id: number;
  pharmacyId: number;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaTotal: string | null;
  expirationDate: string | null;
  expirationDateIso: string | null;
};

function buildRiskItem(row: RiskRow, todayUtc: Date, pharmacyName?: string): ExpiryRiskItem {
  const parsedDate = parseDateOnly(row.expirationDateIso) ?? parseDateOnly(row.expirationDate);
  const daysUntilExpiry = parsedDate
    ? Math.floor((parsedDate.getTime() - todayUtc.getTime()) / (24 * 60 * 60 * 1000))
    : null;
  const bucket = resolveBucket(daysUntilExpiry);

  return {
    id: row.id,
    pharmacyId: row.pharmacyId,
    pharmacyName,
    drugName: row.drugName,
    quantity: Number(row.quantity ?? 0),
    unit: row.unit,
    yakkaTotal: Number(row.yakkaTotal ?? 0),
    expirationDate: row.expirationDateIso ?? row.expirationDate,
    daysUntilExpiry,
    bucket,
  };
}

function sortRiskItems(items: ExpiryRiskItem[]): ExpiryRiskItem[] {
  return [...items].sort((a, b) => {
    const aWeight = calculateItemRiskWeight(a.bucket);
    const bWeight = calculateItemRiskWeight(b.bucket);
    if (aWeight !== bWeight) return bWeight - aWeight;

    const aDays = a.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
    const bDays = b.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
    if (aDays !== bDays) return aDays - bDays;

    return b.yakkaTotal - a.yakkaTotal || b.id - a.id;
  });
}

function aggregatePharmacyRisk(
  rows: RiskRow[],
  pharmacyId: number,
  pharmacyName: string,
  todayUtc: Date,
): { summary: PharmacyRiskSummary; items: ExpiryRiskItem[] } {
  const bucketCounts = createEmptyBuckets();
  const items = rows.map((row) => buildRiskItem(row, todayUtc, pharmacyName));

  for (const item of items) {
    bucketCounts[item.bucket] += 1;
  }

  const totalItems = items.length;
  const riskScore = calculateRiskScore(bucketCounts, totalItems);

  return {
    summary: {
      pharmacyId,
      pharmacyName,
      totalItems,
      riskScore,
      bucketCounts,
    },
    items,
  };
}

function cacheAdminRiskSnapshot(snapshot: AdminRiskSnapshot): AdminRiskSnapshot {
  adminRiskSnapshotCache = {
    expiresAt: Date.now() + ADMIN_RISK_CACHE_TTL_MS,
    value: snapshot,
  };
  return snapshot;
}

export function invalidateAdminRiskSnapshotCache(): void {
  adminRiskSnapshotCache = null;
}

async function loadAdminRiskSnapshot(forceRefresh: boolean = false): Promise<AdminRiskSnapshot> {
  const now = Date.now();
  if (!forceRefresh && adminRiskSnapshotCache && adminRiskSnapshotCache.expiresAt > now) {
    return adminRiskSnapshotCache.value;
  }

  const [pharmacyRows, stockRows] = await Promise.all([
    db.select({ id: pharmacies.id, name: pharmacies.name })
      .from(pharmacies)
      .where(eq(pharmacies.isActive, true)),
    db.select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      drugName: deadStockItems.drugName,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      yakkaTotal: deadStockItems.yakkaTotal,
      expirationDate: deadStockItems.expirationDate,
      expirationDateIso: deadStockItems.expirationDateIso,
    })
      .from(deadStockItems)
      .where(eq(deadStockItems.isAvailable, true)),
  ]);

  const rowsByPharmacy = new Map<number, RiskRow[]>();
  for (const row of stockRows) {
    const list = rowsByPharmacy.get(row.pharmacyId) ?? [];
    list.push(row);
    rowsByPharmacy.set(row.pharmacyId, list);
  }

  const totalBucketCounts = createEmptyBuckets();
  const todayUtc = getTodayUtc();
  const summaries: PharmacyRiskSummary[] = [];

  for (const pharmacy of pharmacyRows) {
    const rows = rowsByPharmacy.get(pharmacy.id) ?? [];
    const { summary } = aggregatePharmacyRisk(rows, pharmacy.id, pharmacy.name, todayUtc);
    summaries.push(summary);
    for (const key of Object.keys(totalBucketCounts) as Array<keyof RiskBucketCounts>) {
      totalBucketCounts[key] += summary.bucketCounts[key];
    }
  }

  const orderedSummaries = summaries
    .sort((a, b) => b.riskScore - a.riskScore || b.totalItems - a.totalItems || a.pharmacyId - b.pharmacyId);

  return cacheAdminRiskSnapshot({
    summaries: orderedSummaries,
    totalBucketCounts,
    computedAt: new Date().toISOString(),
  });
}

export async function getPharmacyRiskDetail(pharmacyId: number): Promise<PharmacyRiskDetail> {
  const cached = userRiskCache.get(pharmacyId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const [pharmacy] = await db.select({
    id: pharmacies.id,
    name: pharmacies.name,
  })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1);

  if (!pharmacy) {
    throw new Error('薬局が見つかりません');
  }

  const rows = await db.select({
    id: deadStockItems.id,
    pharmacyId: deadStockItems.pharmacyId,
    drugName: deadStockItems.drugName,
    quantity: deadStockItems.quantity,
    unit: deadStockItems.unit,
    yakkaTotal: deadStockItems.yakkaTotal,
    expirationDate: deadStockItems.expirationDate,
    expirationDateIso: deadStockItems.expirationDateIso,
  })
    .from(deadStockItems)
    .where(and(
      eq(deadStockItems.pharmacyId, pharmacyId),
      eq(deadStockItems.isAvailable, true),
    ));

  const todayUtc = getTodayUtc();
  const { summary, items } = aggregatePharmacyRisk(rows, pharmacy.id, pharmacy.name, todayUtc);

  const result: PharmacyRiskDetail = {
    pharmacyId,
    totalItems: summary.totalItems,
    riskScore: summary.riskScore,
    bucketCounts: summary.bucketCounts,
    topRiskItems: sortRiskItems(items).slice(0, 20),
    computedAt: new Date().toISOString(),
  };

  userRiskCache.set(pharmacyId, { expiresAt: Date.now() + USER_RISK_CACHE_TTL_MS, value: result });

  return result;
}

export async function getAdminRiskOverview(): Promise<AdminRiskOverview> {
  const snapshot = await loadAdminRiskSnapshot();
  const totalPharmacies = snapshot.summaries.length;
  const avgRiskScore = totalPharmacies > 0
    ? to2(snapshot.summaries.reduce((sum, row) => sum + row.riskScore, 0) / totalPharmacies)
    : 0;

  return {
    totalPharmacies,
    highRiskPharmacies: snapshot.summaries.filter((row) => row.riskScore >= 65).length,
    mediumRiskPharmacies: snapshot.summaries.filter((row) => row.riskScore >= 35 && row.riskScore < 65).length,
    lowRiskPharmacies: snapshot.summaries.filter((row) => row.riskScore < 35).length,
    avgRiskScore,
    totalBucketCounts: snapshot.totalBucketCounts,
    topHighRiskPharmacies: snapshot.summaries.slice(0, 10),
    computedAt: snapshot.computedAt,
  };
}

export async function getAdminPharmacyRiskPage(page: number, limit: number): Promise<{
  data: PharmacyRiskSummary[];
  total: number;
}> {
  const offset = (page - 1) * limit;
  const snapshot = await loadAdminRiskSnapshot();

  return {
    data: snapshot.summaries.slice(offset, offset + limit),
    total: snapshot.summaries.length,
  };
}
