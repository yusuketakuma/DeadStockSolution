import { and, count, desc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db } from '../config/database';
import { notifications, predictiveAlerts, type PredictiveAlertType } from '../db/schema';
import type { AlertItem, AlertListResponse, AlertStats } from '../types/alert';
import { invalidateDashboardUnreadCache } from './notification-service';
import { encodeCursor } from '../utils/cursor-pagination';

const DEFAULT_ALERT_PAGE_SIZE = 20 as const;

// ── 型定義 ──────────────────────────────────

export interface AlertCursor {
  id: number;
  detectedAt: string;
}

export interface ListAlertsFilters {
  resolved?: boolean;
  type?: PredictiveAlertType;
  offset?: number;
  limit?: number;
  cursor?: AlertCursor;
}

// ── ヘルパー ──────────────────────────────────

function parseDetailJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
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

function buildAlertListWhereClause(pharmacyId: number, filters: ListAlertsFilters) {
  const conditions = [eq(predictiveAlerts.pharmacyId, pharmacyId)];

  if (filters.resolved === true) {
    conditions.push(isNotNull(predictiveAlerts.resolvedAt));
  } else if (filters.resolved === false) {
    conditions.push(isNull(predictiveAlerts.resolvedAt));
  }

  if (filters.type) {
    conditions.push(eq(predictiveAlerts.alertType, filters.type));
  }

  return and(...conditions);
}

function buildAlertStatsByType(rows: Array<{ alertType: PredictiveAlertType; count: number }>): Record<string, number> {
  const byType: Record<string, number> = {};
  for (const row of rows) {
    byType[row.alertType] = row.count;
  }
  return byType;
}

// ── アラート一覧 ──────────────────────────────────

function buildCursorWhereClause(pharmacyId: number, filters: ListAlertsFilters, cursor: AlertCursor) {
  const baseConditions = buildAlertListWhereClause(pharmacyId, filters);
  // cursor: detectedAt < cursor.detectedAt OR (detectedAt = cursor.detectedAt AND id < cursor.id)
  const cursorCondition = or(
    lt(predictiveAlerts.detectedAt, cursor.detectedAt),
    and(
      eq(predictiveAlerts.detectedAt, cursor.detectedAt),
      lt(predictiveAlerts.id, cursor.id),
    ),
  );
  return and(baseConditions, cursorCondition);
}

export async function listAlerts(
  pharmacyId: number,
  filters: ListAlertsFilters,
): Promise<AlertListResponse> {
  const { resolved, offset = 0, limit = DEFAULT_ALERT_PAGE_SIZE, cursor } = filters;

  if (cursor) {
    // cursor-based pagination
    const whereClause = buildCursorWhereClause(pharmacyId, filters, cursor);
    const rows = await db
      .select()
      .from(predictiveAlerts)
      .where(whereClause)
      .orderBy(desc(predictiveAlerts.detectedAt), desc(predictiveAlerts.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const alerts = items.map(toAlertItem);
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem
      ? encodeCursor<AlertCursor>({ id: lastItem.id, detectedAt: lastItem.detectedAt })
      : null;

    return {
      alerts,
      total: 0,
      offset: 0,
      limit,
      unresolvedCount: 0,
      pagination: { mode: 'cursor', hasMore, nextCursor },
    };
  }

  // offset/limit pagination (backward compat)
  const whereClause = buildAlertListWhereClause(pharmacyId, filters);

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

  return {
    alerts,
    total,
    offset,
    limit,
    unresolvedCount,
    pagination: { mode: 'offset', hasMore: offset + limit < total, nextCursor: null },
  };
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
  const now = new Date().toISOString();
  const rows = await db
    .update(predictiveAlerts)
    .set({ resolvedAt: now })
    .where(and(eq(predictiveAlerts.id, id), eq(predictiveAlerts.pharmacyId, pharmacyId)))
    .returning();

  if (rows.length === 0) return null;

  const resolvedAlert = rows[0];
  if (resolvedAlert.notificationId) {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: now })
      .where(and(
        eq(notifications.id, resolvedAlert.notificationId),
        eq(notifications.pharmacyId, pharmacyId),
      ));
    invalidateDashboardUnreadCache(pharmacyId);
  }

  return toAlertItem(resolvedAlert);
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

  return { unresolvedCount, byType: buildAlertStatsByType(byTypeResult) };
}
