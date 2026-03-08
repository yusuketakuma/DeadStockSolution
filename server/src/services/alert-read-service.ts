import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../config/database';
import { predictiveAlerts, type PredictiveAlertType } from '../db/schema';
import type { AlertItem, AlertListResponse, AlertStats } from '../types/alert';

// ── 型定義 ──────────────────────────────────

export interface ListAlertsFilters {
  resolved?: boolean;
  type?: PredictiveAlertType;
  offset?: number;
  limit?: number;
}

// ── ヘルパー ──────────────────────────────────

function parseDetailJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toAlertItem(row: typeof predictiveAlerts.$inferSelect): AlertItem {
  return {
    id: row.id,
    pharmacyId: row.pharmacyId,
    alertType: row.alertType,
    title: row.title,
    message: row.message,
    detailJson: parseDetailJson(row.detailJson),
    detectedAt: row.detectedAt,
    resolvedAt: row.resolvedAt ?? null,
    notificationId: row.notificationId ?? null,
  };
}

// ── アラート一覧 ──────────────────────────────────

export async function listAlerts(
  pharmacyId: number,
  filters: ListAlertsFilters,
): Promise<AlertListResponse> {
  const { resolved, type, offset = 0, limit = 20 } = filters;

  const conditions = [eq(predictiveAlerts.pharmacyId, pharmacyId)];

  if (resolved === true) {
    conditions.push(isNotNull(predictiveAlerts.resolvedAt));
  } else if (resolved === false) {
    conditions.push(isNull(predictiveAlerts.resolvedAt));
  }

  if (type) {
    conditions.push(eq(predictiveAlerts.alertType, type));
  }

  const whereClause = and(...conditions);

  const [totalResult, rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(predictiveAlerts)
      .where(whereClause),
    db
      .select()
      .from(predictiveAlerts)
      .where(whereClause)
      .orderBy(desc(predictiveAlerts.detectedAt))
      .limit(limit)
      .offset(offset),
  ]);

  const total = totalResult[0]?.value ?? 0;
  const alerts = rows.map(toAlertItem);

  // unresolvedCount: resolved=false の場合は total と同じ、それ以外は別途計算不要（フロントで stats API を利用）
  const unresolvedCount = resolved === false ? total : 0;

  return { alerts, total, offset, limit, unresolvedCount };
}

// ── アラート詳細 ──────────────────────────────────

export async function getAlertDetail(
  id: number,
  pharmacyId: number,
): Promise<AlertItem | null> {
  const rows = await db
    .select()
    .from(predictiveAlerts)
    .where(and(eq(predictiveAlerts.id, id), eq(predictiveAlerts.pharmacyId, pharmacyId)));

  if (rows.length === 0) return null;
  return toAlertItem(rows[0]);
}

// ── アラート解決 ──────────────────────────────────

export async function resolveAlert(
  id: number,
  pharmacyId: number,
): Promise<AlertItem | null> {
  const rows = await db
    .update(predictiveAlerts)
    .set({ resolvedAt: new Date().toISOString() })
    .where(and(eq(predictiveAlerts.id, id), eq(predictiveAlerts.pharmacyId, pharmacyId)))
    .returning();

  if (rows.length === 0) return null;
  return toAlertItem(rows[0]);
}

// ── アラート統計 ──────────────────────────────────

export async function getAlertStats(pharmacyId: number): Promise<AlertStats> {
  const [totalResult, byTypeResult] = await Promise.all([
    db
      .select({ value: count() })
      .from(predictiveAlerts)
      .where(and(eq(predictiveAlerts.pharmacyId, pharmacyId), isNull(predictiveAlerts.resolvedAt))),
    db
      .select({ alertType: predictiveAlerts.alertType, count: count() })
      .from(predictiveAlerts)
      .where(and(eq(predictiveAlerts.pharmacyId, pharmacyId), isNull(predictiveAlerts.resolvedAt)))
      .groupBy(predictiveAlerts.alertType),
  ]);

  const unresolvedCount = totalResult[0]?.value ?? 0;

  const byType: Record<string, number> = {};
  for (const row of byTypeResult) {
    byType[row.alertType] = row.count;
  }

  return { unresolvedCount, byType };
}
