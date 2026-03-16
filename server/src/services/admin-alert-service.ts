import { desc, eq, and, isNull, isNotNull, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database';
import { predictiveAlerts, pharmacies, type PredictiveAlertType } from '../db/schema';
import { rowCount } from '../utils/db-utils';

export interface AlertListParams {
  page: number;
  limit: number;
  offset: number;
  alertType?: string;
  resolved?: 'true' | 'false';
}

export async function listAlerts(params: AlertListParams) {
  const conditions: SQL[] = [];
  if (params.alertType) {
    conditions.push(eq(predictiveAlerts.alertType, params.alertType as PredictiveAlertType));
  }
  if (params.resolved === 'true') {
    conditions.push(isNotNull(predictiveAlerts.resolvedAt));
  } else if (params.resolved === 'false') {
    conditions.push(isNull(predictiveAlerts.resolvedAt));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, [totalRow]] = await Promise.all([
    db.select({
      id: predictiveAlerts.id,
      pharmacyId: predictiveAlerts.pharmacyId,
      pharmacyName: pharmacies.name,
      alertType: predictiveAlerts.alertType,
      title: predictiveAlerts.title,
      message: predictiveAlerts.message,
      detectedAt: predictiveAlerts.detectedAt,
      resolvedAt: predictiveAlerts.resolvedAt,
      createdAt: predictiveAlerts.createdAt,
    })
      .from(predictiveAlerts)
      .leftJoin(pharmacies, eq(predictiveAlerts.pharmacyId, pharmacies.id))
      .where(where)
      .orderBy(desc(predictiveAlerts.createdAt))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ count: rowCount }).from(predictiveAlerts).where(where),
  ]);

  return { data, total: totalRow.count };
}

export async function bulkResolveAlerts(ids: number[]): Promise<number> {
  const now = new Date().toISOString();
  const result = await db.update(predictiveAlerts)
    .set({ resolvedAt: now })
    .where(and(
      inArray(predictiveAlerts.id, ids),
      isNull(predictiveAlerts.resolvedAt),
    ));
  return result.rowCount ?? 0;
}

export async function getAlertTrends() {
  const rows = await db.select({
    alertType: predictiveAlerts.alertType,
    count: sql<number>`count(*)`.as('count'),
    unresolvedCount: sql<number>`count(*) filter (where ${predictiveAlerts.resolvedAt} is null)`.as('unresolved_count'),
  })
    .from(predictiveAlerts)
    .groupBy(predictiveAlerts.alertType);

  return rows;
}
