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
import { parseBoundedInt } from '../utils/number-utils';
import { normalizeString } from '../utils/string-utils';
import { logger } from './logger';
import { publishTimelineRefresh } from './realtime-service';

const DEFAULT_NEAR_EXPIRY_DAYS = 45;
const DEFAULT_EXCESS_STOCK_MONTHS = 3;
const DEFAULT_PHARMACY_BATCH_SIZE = 200;
const DEFAULT_SIGNAL_PERSIST_CONCURRENCY = 8;

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

function resolvePredictiveAlertNotificationType(alertType: PredictiveAlertType): NotificationType {
  if (alertType === 'near_expiry') {
    return 'alert_near_expiry';
  }
  if (alertType === 'excess_stock') {
    return 'alert_excess_stock';
  }
  return 'alert_resolved';
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

function chunkArray<T>(values: T[], size: number): T[][] {
  if (values.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function resolveStockMatchKey(row: {
  drugMasterPackageId: number | null;
  drugMasterId: number | null;
  drugName: string;
}): string | null {
  if (row.drugMasterPackageId) return `pkg:${row.drugMasterPackageId}`;
  if (row.drugMasterId) return `drug:${row.drugMasterId}`;
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
    if (!Number.isFinite(monthlyUsage) || monthlyUsage <= 0) continue;

    const key = resolveStockMatchKey(usageRow);
    if (!key) continue;

    const byKey = usageByPharmacyAndKey.get(usageRow.pharmacyId) ?? new Map<string, number>();
    byKey.set(key, (byKey.get(key) ?? 0) + monthlyUsage);
    usageByPharmacyAndKey.set(usageRow.pharmacyId, byKey);
  }

  const stockByPharmacyAndKey = new Map<number, Map<string, StockQuantityAggregate>>();

  for (const stockRow of stockRows) {
    const key = resolveStockMatchKey(stockRow);
    if (!key) continue;

    const stockQuantity = Number(stockRow.quantity ?? 0);
    if (!Number.isFinite(stockQuantity) || stockQuantity <= 0) continue;
    const unitPrice = Number(stockRow.yakkaUnitPrice ?? 0);
    const stockValue = Number.isFinite(unitPrice) && unitPrice > 0 ? stockQuantity * unitPrice : 0;
    const byKey = stockByPharmacyAndKey.get(stockRow.pharmacyId) ?? new Map<string, StockQuantityAggregate>();
    const current = byKey.get(key) ?? { quantity: 0, totalValue: 0 };
    current.quantity += stockQuantity;
    current.totalValue += stockValue;
    byKey.set(key, current);
    stockByPharmacyAndKey.set(stockRow.pharmacyId, byKey);
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
    const [insertedAlert] = await tx.insert(predictiveAlerts)
      .values({
        tenantId: signal.pharmacyId,
        pharmacyId: signal.pharmacyId,
        alertType: signal.alertType,
        title: signal.title,
        message: signal.message,
        detailJson: JSON.stringify(signal.detail),
        dedupeKey,
        detectedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing({ target: [predictiveAlerts.pharmacyId, predictiveAlerts.dedupeKey] })
      .returning({ id: predictiveAlerts.id });

    if (!insertedAlert) {
      return 'duplicate';
    }

    const [notification] = await tx.insert(notifications)
      .values({
        tenantId: signal.pharmacyId,
        pharmacyId: signal.pharmacyId,
        type: resolvePredictiveAlertNotificationType(signal.alertType),
        title: signal.title,
        message: signal.message,
        referenceType: 'alert',
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

export async function runPredictiveAlertsJob(
  options: RunPredictiveAlertsOptions = {},
): Promise<PredictiveAlertsJobResult> {
  const now = options.now ?? new Date();
  const nearExpiryDays = resolveNearExpiryDays(options.nearExpiryDays);
  const excessStockMonths = resolveExcessStockMonths(options.excessStockMonths);

  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const expiryThreshold = new Date(todayUtc.getTime() + nearExpiryDays * 24 * 60 * 60 * 1000);
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

  let generatedAlerts = 0;
  let duplicateAlerts = 0;
  let failedAlerts = 0;
  let nearExpiryAlerts = 0;
  let excessStockAlerts = 0;

  for (const pharmacyIdBatch of chunkArray(pharmacyIds, pharmacyBatchSize)) {
    const [nearExpiryRows, excessStockRows] = await Promise.all([
      fetchNearExpiryAggregates(pharmacyIdBatch, todayIso, expiryThresholdIso),
      fetchExcessStockAggregates(pharmacyIdBatch, excessStockMonths),
    ]);

    const signals: PredictiveAlertSignal[] = [
      ...nearExpiryRows.map((row) => buildNearExpirySignal(row, nearExpiryDays)),
      ...excessStockRows.map((row) => buildExcessStockSignal(row, excessStockMonths)),
    ];

    for (const signalBatch of chunkArray(signals, signalPersistConcurrency)) {
      const settled = await Promise.allSettled(signalBatch.map((signal) => persistSignal(signal, dedupeDateKey)));
      settled.forEach((result, index) => {
        const signal = signalBatch[index];
        if (result.status === 'rejected') {
          failedAlerts += 1;
          logger.error('Failed to persist predictive alert signal', {
            pharmacyId: signal.pharmacyId,
            alertType: signal.alertType,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
          return;
        }

        if (result.value === 'duplicate') {
          duplicateAlerts += 1;
          return;
        }

        generatedAlerts += 1;
        publishTimelineRefresh({
          pharmacyId: signal.pharmacyId,
          reason: 'predictive_alert_created',
        });
        if (signal.alertType === 'near_expiry') {
          nearExpiryAlerts += 1;
        } else if (signal.alertType === 'excess_stock') {
          excessStockAlerts += 1;
        }
      });
    }
  }

  return {
    processedPharmacies: pharmacyIds.length,
    generatedAlerts,
    nearExpiryAlerts,
    excessStockAlerts,
    duplicateAlerts,
    failedAlerts,
    generatedAt: new Date().toISOString(),
  };
}
