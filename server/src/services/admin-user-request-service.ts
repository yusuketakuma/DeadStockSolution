import { desc, eq, and, gte, lte, SQL } from 'drizzle-orm';
import { db } from '../config/database';
import { userRequests, pharmacies } from '../db/schema';
import { rowCount } from '../utils/db-utils';

export interface UserRequestListParams {
  page: number;
  limit: number;
  offset: number;
  status?: string;
  pharmacyId?: number;
  dateFrom?: string;
  dateTo?: string;
}

export async function listUserRequests(params: UserRequestListParams) {
  const conditions: SQL[] = [];
  if (params.status) {
    conditions.push(eq(userRequests.openclawStatus, params.status as any));
  }
  if (params.pharmacyId) {
    conditions.push(eq(userRequests.pharmacyId, params.pharmacyId));
  }
  if (params.dateFrom) {
    conditions.push(gte(userRequests.createdAt, params.dateFrom));
  }
  if (params.dateTo) {
    conditions.push(lte(userRequests.createdAt, params.dateTo));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, [totalRow]] = await Promise.all([
    db.select({
      id: userRequests.id,
      pharmacyId: userRequests.pharmacyId,
      pharmacyName: pharmacies.name,
      requestText: userRequests.requestText,
      openclawStatus: userRequests.openclawStatus,
      openclawThreadId: userRequests.openclawThreadId,
      openclawSummary: userRequests.openclawSummary,
      createdAt: userRequests.createdAt,
      updatedAt: userRequests.updatedAt,
    })
      .from(userRequests)
      .leftJoin(pharmacies, eq(userRequests.pharmacyId, pharmacies.id))
      .where(where)
      .orderBy(desc(userRequests.createdAt))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ count: rowCount }).from(userRequests).where(where),
  ]);

  return { data, total: totalRow.count };
}
