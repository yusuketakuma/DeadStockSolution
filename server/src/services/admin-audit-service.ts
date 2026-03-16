import { desc, eq, and, SQL } from 'drizzle-orm';
import { db } from '../config/database';
import { adminAuditLogs, pharmacies, type AdminAuditAction } from '../db/schema';
import { rowCount } from '../utils/db-utils';

export interface AuditListParams {
  page: number;
  limit: number;
  offset: number;
  action?: string;
}

export async function listAuditLogs(params: AuditListParams) {
  const conditions: SQL[] = [];
  if (params.action) {
    conditions.push(eq(adminAuditLogs.action, params.action as AdminAuditAction));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const adminPharmacy = db.select({ id: pharmacies.id, name: pharmacies.name }).from(pharmacies).as('ap');
  const targetPharmacy = db.select({ id: pharmacies.id, name: pharmacies.name }).from(pharmacies).as('tp');

  const [data, [totalRow]] = await Promise.all([
    db.select({
      id: adminAuditLogs.id,
      adminId: adminAuditLogs.adminId,
      adminName: adminPharmacy.name,
      targetPharmacyId: adminAuditLogs.targetPharmacyId,
      targetPharmacyName: targetPharmacy.name,
      action: adminAuditLogs.action,
      previousStatus: adminAuditLogs.previousStatus,
      newStatus: adminAuditLogs.newStatus,
      reason: adminAuditLogs.reason,
      createdAt: adminAuditLogs.createdAt,
    })
      .from(adminAuditLogs)
      .leftJoin(adminPharmacy, eq(adminAuditLogs.adminId, adminPharmacy.id))
      .leftJoin(targetPharmacy, eq(adminAuditLogs.targetPharmacyId, targetPharmacy.id))
      .where(where)
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ count: rowCount }).from(adminAuditLogs).where(where),
  ]);

  return { data, total: totalRow.count };
}
