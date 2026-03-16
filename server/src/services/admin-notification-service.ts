import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { notifications, pushSubscriptions, pharmacies } from '../db/schema';
import { rowCount } from '../utils/db-utils';

export async function getNotificationStats() {
  const [[totalRow], [unreadRow], [subscriptionRow], typeBreakdown] = await Promise.all([
    db.select({ count: rowCount }).from(notifications),
    db.select({ count: rowCount }).from(notifications).where(eq(notifications.isRead, false)),
    db.select({ count: rowCount }).from(pushSubscriptions),
    db.select({
      type: notifications.type,
      count: sql<number>`count(*)`.as('count'),
    })
      .from(notifications)
      .groupBy(notifications.type)
      .orderBy(sql`count(*) desc`),
  ]);

  return {
    totalNotifications: totalRow.count,
    unreadNotifications: unreadRow.count,
    totalSubscriptions: subscriptionRow.count,
    typeBreakdown,
  };
}

export interface NotificationListParams {
  page: number;
  limit: number;
  offset: number;
  type?: string;
}

export async function listRecentNotifications(params: NotificationListParams) {
  const where = params.type ? eq(notifications.type, params.type) : undefined;

  const [data, [totalRow]] = await Promise.all([
    db.select({
      id: notifications.id,
      pharmacyId: notifications.pharmacyId,
      pharmacyName: pharmacies.name,
      type: notifications.type,
      title: notifications.title,
      message: notifications.message,
      isRead: notifications.isRead,
      createdAt: notifications.createdAt,
    })
      .from(notifications)
      .leftJoin(pharmacies, eq(notifications.pharmacyId, pharmacies.id))
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ count: rowCount }).from(notifications).where(where),
  ]);

  return { data, total: totalRow.count };
}

export async function listPushSubscriptions() {
  const rows = await db.select({
    pharmacyId: pushSubscriptions.pharmacyId,
    pharmacyName: pharmacies.name,
    subscriptionCount: sql<number>`count(*)`.as('sub_count'),
    latestCreatedAt: sql<string>`max(${pushSubscriptions.createdAt})`.as('latest'),
    latestUsedAt: sql<string>`max(${pushSubscriptions.lastUsedAt})`.as('last_used'),
  })
    .from(pushSubscriptions)
    .leftJoin(pharmacies, eq(pushSubscriptions.pharmacyId, pharmacies.id))
    .groupBy(pushSubscriptions.pharmacyId, pharmacies.name)
    .orderBy(sql`count(*) desc`)
    .limit(100);

  return rows;
}
