import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  deadStockItems,
  notifications,
  pharmacies,
  predictiveAlerts,
  type NotificationType,
  type PredictiveAlertType,
  usedMedicationItems,
} from '../db/schema';
import { splitIntoChunks } from '../utils/array-utils';
import { parseBoundedInt } from '../utils/number-utils';
import { normalizeString } from '../utils/string-utils';
import { logger } from './logger';

const DEFAULT_NEAR_EXPIRY_DAYS = 45;
const DEFAULT_EXCESS_STOCK_MONTHS = 3;
const DEFAULT_PHARMACY_BATCH_SIZE = 200;
const DEFAULT_SIGNAL_PERSIST_CONCURRENCY = 8;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const PREDICTIVE_ALERT_NOTIFICATION_TYPE: NotificationType = 'proposal_status_changed';

interface NearExpiryAggregate {
  pharmacyId: number;
  itemCount: number;
  totalValue: number;
  nearestExpiryDate: string | null;
}

interface ExcessStockAggregate {
  pharmacyId: number;
  itemCount: number;
  totalExcessValue: number;
}

interface StockQuantityAggregate {
  quantity: number;
  totalValue: number;
}

interface PredictiveAlertSignal {
  pharmacyId: number;
  alertType: PredictiveAlertType;
  title: string;
  message: string;
  detail: Record<string, unknown>;
}

interface PredictiveAlertCounters {
  generatedAlerts: number;
  duplicateAlerts: number;
  failedAlerts: number;
  nearExpiryAlerts: number;
  excessStockAlerts: number;
}

export interface RunPredictiveAlertsOptions {
  nearExpiryDays?: number;
  excessStockMonths?: number;
  now?: Date;
}

export interface PredictiveAlertsJobResult {
  processedPharmacies: number;
  generatedAlerts: number;
  nearExpiryAlerts: number;
  excessStockAlerts: number;
  duplicateAlerts: number;
  failedAlerts: number;
  generatedAt: string;
}

function resolveNearExpiryDays(input?: number): number {
  if (typeof input === 'number' && Number.isInteger(input) && input >= 1 && input <= 180) {
    return input;
  }
  return parseBoundedInt(process.env.PREDICTIVE_ALERT_NEAR_EXPIRY_DAYS, DEFAULT_NEAR_EXPIRY_DAYS, 1, 180);
}

function resolveExcessStockMonths(input?: number): number {
  if (typeof input === 'number' && Number.isInteger(input) && input >= 1 && input <= 12) {
    return input;
  }
  return parseBoundedInt(process.env.PREDICTIVE_ALERT_EXCESS_STOCK_MONTHS, DEFAULT_EXCESS_STOCK_MONTHS, 1, 12);
}

function toDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function to2(value: number): number {
  return Math.round(value * 100) / 100;
}


function getOrInitMapValue<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  if (map.has(key)) {
    return map.get(key) as V;
  }
  const created = factory();
  map.set(key, created);
  return created;
}

function isFinitePositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function resolveStockMatchKey(row: {
  drugMasterPackageId: number | null;
  drugMasterId: number | null;
  drugName: string;
}): string | null {
  if (row.drugMasterPackageId !== null) return `pkg:${row.drugMasterPackageId}`;
  if (row.drugMasterId !== null) return `drug:${row.drugMasterId}`;
  const normalizedName = normalizeString(row.drugName);
  if (!normalizedName) return null;
  return `name:${normalizedName}`;
}

function buildNearExpirySignal(row: NearExpiryAggregate, nearExpiryDays: number): PredictiveAlertSignal {
  return {
    pharmacyId: row.pharmacyId,
    alertType: 'near_expiry',
    title: '期限切迫在庫の予兆があります',
    message: `${row.itemCount}件の在庫が${nearExpiryDays}日以内に期限到来予定です。`,
    detail: {
      itemCount: row.itemCount,
      totalValue: to2(row.totalValue),
      nearExpiryDays,
      nearestExpiryDate: row.nearestExpiryDate,
    },
  };
}

function buildExcessStockSignal(row: ExcessStockAggregate, excessStockMonths: number): PredictiveAlertSignal {
  return {
    pharmacyId: row.pharmacyId,
    alertType: 'excess_stock',
    title: '過剰在庫の予兆があります',
    message: `${row.itemCount}件の在庫が想定使用量（${excessStockMonths}か月分）を超過しています。`,
    detail: {
      itemCount: row.itemCount,
      totalExcessValue: to2(row.totalExcessValue),
      excessStockMonths,
    },
  };
}

async function fetchNearExpiryAggregates(
  pharmacyIds: number[],
  todayIso: string,
  expiryThresholdIso: string,
): Promise<NearExpiryAggregate[]> {
  if (pharmacyIds.length === 0) {
    return [];
  }

  const rows = await db.select({
    pharmacyId: deadStockItems.pharmacyId,
    itemCount: sql<number>`count(*)::int`,
    totalValue: sql<number>`coalesce(sum(coalesce(${deadStockItems.yakkaTotal}, ${deadStockItems.quantity} * ${deadStockItems.yakkaUnitPrice})), 0)::float`,
    nearestExpiryDate: sql<string | null>`min(${deadStockItems.expirationDateIso})`,
  })
    .from(deadStockItems)
    .where(and(
      inArray(deadStockItems.pharmacyId, pharmacyIds),
      eq(deadStockItems.isAvailable, true),
      isNotNull(deadStockItems.expirationDateIso),
      gte(deadStockItems.expirationDateIso, todayIso),
      lte(deadStockItems.expirationDateIso, expiryThresholdIso),
    ))
    .groupBy(deadStockItems.pharmacyId);

  return rows.map((row) => ({
    pharmacyId: row.pharmacyId,
    itemCount: Number(row.itemCount ?? 0),
    totalValue: Number(row.totalValue ?? 0),
    nearestExpiryDate: row.nearestExpiryDate ?? null,
  })).filter((row) => row.itemCount > 0);
}

async function fetchExcessStockAggregates(
  pharmacyIds: number[],
  excessStockMonths: number,
): Promise<ExcessStockAggregate[]> {
  if (pharmacyIds.length === 0) {
    return [];
  }

  const [stockRows, usageRows] = await Promise.all([
    db.select({
      pharmacyId: deadStockItems.pharmacyId,
      drugName: deadStockItems.drugName,
      drugMasterId: deadStockItems.drugMasterId,
      drugMasterPackageId: deadStockItems.drugMasterPackageId,
      quantity: deadStockItems.quantity,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
    })
      .from(deadStockItems)
      .where(and(
        inArray(deadStockItems.pharmacyId, pharmacyIds),
        eq(deadStockItems.isAvailable, true),
      )),
    db.select({
      pharmacyId: usedMedicationItems.pharmacyId,
      drugName: usedMedicationItems.drugName,
      drugMasterId: usedMedicationItems.drugMasterId,
      drugMasterPackageId: usedMedicationItems.drugMasterPackageId,
      monthlyUsage: usedMedicationItems.monthlyUsage,
    })
      .from(usedMedicationItems)
      .where(inArray(usedMedicationItems.pharmacyId, pharmacyIds)),
  ]);

  const usageByPharmacyAndKey = new Map<number, Map<string, number>>();
  for (const usageRow of usageRows) {
    const monthlyUsage = Number(usageRow.monthlyUsage ?? 0);
    if (!isFinitePositiveNumber(monthlyUsage)) continue;

    const key = resolveStockMatchKey(usageRow);
    if (!key) continue;

    const byKey = getOrInitMapValue(usageByPharmacyAndKey, usageRow.pharmacyId, () => new Map<string, number>());
    byKey.set(key, (byKey.get(key) ?? 0) + monthlyUsage);
  }

  const stockByPharmacyAndKey = new Map<number, Map<string, StockQuantityAggregate>>();

  for (const stockRow of stockRows) {
    const key = resolveStockMatchKey(stockRow);
    if (!key) continue;

    const stockQuantity = Number(stockRow.quantity ?? 0);
    if (!isFinitePositiveNumber(stockQuantity)) continue;
    const unitPrice = Number(stockRow.yakkaUnitPrice ?? 0);
    const stockValue = isFinitePositiveNumber(unitPrice) ? stockQuantity * unitPrice : 0;
    const byKey = getOrInitMapValue(stockByPharmacyAndKey, stockRow.pharmacyId, () => new Map<string, StockQuantityAggregate>());
    const current = byKey.get(key) ?? { quantity: 0, totalValue: 0 };
    current.quantity += stockQuantity;
    current.totalValue += stockValue;
    byKey.set(key, current);
  }

  const aggregates = new Map<number, ExcessStockAggregate>();
  for (const [pharmacyId, stockByKey] of stockByPharmacyAndKey.entries()) {
    const usageByKey = usageByPharmacyAndKey.get(pharmacyId);
    if (!usageByKey) continue;
    const current = aggregates.get(pharmacyId) ?? {
      pharmacyId,
      itemCount: 0,
      totalExcessValue: 0,
    };

    for (const [key, stockAggregate] of stockByKey.entries()) {
      const monthlyUsage = usageByKey.get(key);
      if (!monthlyUsage || monthlyUsage <= 0) continue;

      const thresholdQty = monthlyUsage * excessStockMonths;
      if (stockAggregate.quantity <= thresholdQty) continue;

      const excessQty = stockAggregate.quantity - thresholdQty;
      const avgUnitPrice = stockAggregate.quantity > 0
        ? stockAggregate.totalValue / stockAggregate.quantity
        : 0;
      const excessValue = avgUnitPrice > 0 ? excessQty * avgUnitPrice : 0;

      current.itemCount += 1;
      current.totalExcessValue = to2(current.totalExcessValue + excessValue);
    }
    if (current.itemCount > 0) {
      aggregates.set(pharmacyId, current);
    }
  }

  return [...aggregates.values()].filter((row) => row.itemCount > 0);
}

async function persistSignal(
  signal: PredictiveAlertSignal,
  dedupeDateKey: string,
): Promise<'created' | 'duplicate'> {
  return db.transaction(async (tx) => {
    const dedupeKey = `${signal.alertType}:${dedupeDateKey}`;
    const createdAtIso = new Date().toISOString();
    const [insertedAlert] = await tx.insert(predictiveAlerts)
      .values({
        pharmacyId: signal.pharmacyId,
        alertType: signal.alertType,
        title: signal.title,
        message: signal.message,
        detailJson: JSON.stringify(signal.detail),
        dedupeKey,
        detectedAt: createdAtIso,
        createdAt: createdAtIso,
      })
      .onConflictDoNothing({ target: [predictiveAlerts.pharmacyId, predictiveAlerts.dedupeKey] })
      .returning({ id: predictiveAlerts.id });

    if (!insertedAlert) {
      return 'duplicate';
    }

    const [notification] = await tx.insert(notifications)
      .values({
        pharmacyId: signal.pharmacyId,
        type: PREDICTIVE_ALERT_NOTIFICATION_TYPE,
        title: signal.title,
        message: signal.message,
        referenceType: 'match',
        referenceId: null,
      })
      .returning({ id: notifications.id });

    if (notification) {
      await tx.update(predictiveAlerts)
        .set({ notificationId: notification.id })
        .where(eq(predictiveAlerts.id, insertedAlert.id));
    }

    return 'created';
  });
}

function applyPersistedSignalResult(
  counters: PredictiveAlertCounters,
  signal: PredictiveAlertSignal,
  result: PromiseSettledResult<'created' | 'duplicate'>,
): void {
  if (result.status === 'rejected') {
    counters.failedAlerts += 1;
    logger.error('Failed to persist predictive alert signal', {
      pharmacyId: signal.pharmacyId,
      alertType: signal.alertType,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    return;
  }

  if (result.value === 'duplicate') {
    counters.duplicateAlerts += 1;
    return;
  }

  counters.generatedAlerts += 1;
  if (signal.alertType === 'near_expiry') {
    counters.nearExpiryAlerts += 1;
    return;
  }
  counters.excessStockAlerts += 1;
}

export async function runPredictiveAlertsJob(
  options: RunPredictiveAlertsOptions = {},
): Promise<PredictiveAlertsJobResult> {
  const now = options.now ?? new Date();
  const nearExpiryDays = resolveNearExpiryDays(options.nearExpiryDays);
  const excessStockMonths = resolveExcessStockMonths(options.excessStockMonths);

  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const expiryThreshold = new Date(todayUtc.getTime() + nearExpiryDays * MILLISECONDS_PER_DAY);
  const todayIso = toDateIso(todayUtc);
  const expiryThresholdIso = toDateIso(expiryThreshold);
  const dedupeDateKey = toDateIso(now);
  const pharmacyBatchSize = parseBoundedInt(
    process.env.PREDICTIVE_ALERT_BATCH_SIZE,
    DEFAULT_PHARMACY_BATCH_SIZE,
    20,
    2_000,
  );
  const signalPersistConcurrency = parseBoundedInt(
    process.env.PREDICTIVE_ALERT_PERSIST_CONCURRENCY,
    DEFAULT_SIGNAL_PERSIST_CONCURRENCY,
    1,
    32,
  );

  const activePharmacies = await db.select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eq(pharmacies.isActive, true));
  const pharmacyIds = activePharmacies.map((row) => row.id);

  if (pharmacyIds.length === 0) {
    return {
      processedPharmacies: 0,
      generatedAlerts: 0,
      nearExpiryAlerts: 0,
      excessStockAlerts: 0,
      duplicateAlerts: 0,
      failedAlerts: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  const counters: PredictiveAlertCounters = {
    generatedAlerts: 0,
    duplicateAlerts: 0,
    failedAlerts: 0,
    nearExpiryAlerts: 0,
    excessStockAlerts: 0,
  };

  for (const pharmacyIdBatch of splitIntoChunks(pharmacyIds, pharmacyBatchSize)) {
    const [nearExpiryRows, excessStockRows] = await Promise.all([
      fetchNearExpiryAggregates(pharmacyIdBatch, todayIso, expiryThresholdIso),
      fetchExcessStockAggregates(pharmacyIdBatch, excessStockMonths),
    ]);

    const signals: PredictiveAlertSignal[] = [
      ...nearExpiryRows.map((row) => buildNearExpirySignal(row, nearExpiryDays)),
      ...excessStockRows.map((row) => buildExcessStockSignal(row, excessStockMonths)),
    ];

    for (const signalBatch of splitIntoChunks(signals, signalPersistConcurrency)) {
      const settled = await Promise.allSettled(signalBatch.map((signal) => persistSignal(signal, dedupeDateKey)));
      settled.forEach((result, index) => {
        const signal = signalBatch[index];
        applyPersistedSignalResult(counters, signal, result);
      });
    }
  }

  return {
    processedPharmacies: pharmacyIds.length,
    generatedAlerts: counters.generatedAlerts,
    nearExpiryAlerts: counters.nearExpiryAlerts,
    excessStockAlerts: counters.excessStockAlerts,
    duplicateAlerts: counters.duplicateAlerts,
    failedAlerts: counters.failedAlerts,
    generatedAt: new Date().toISOString(),
  };
}
