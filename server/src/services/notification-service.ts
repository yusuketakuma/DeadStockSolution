import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  adminMessages,
  adminMessageReads,
  matchNotifications,
  notifications,
  pharmacies,
  type NotificationReferenceType,
  type NotificationType,
} from '../db/schema';
import { rowCount } from '../utils/db-utils';
import { logger } from './logger';
import { publishTimelineRefresh } from './realtime-service';
import { dispatchNotificationPush } from './push-notification-dispatcher';

interface CreateNotificationInput {
  pharmacyId: number;
  tenantId?: number;
  type: NotificationType;
  title: string;
  message: string;
  referenceType?: NotificationReferenceType;
  referenceId?: number;
  detailJson?: Record<string, unknown>;
}

interface PostgresErrorLike {
  code?: string;
}

type NotificationSqlExecutor = Pick<typeof db, 'execute'>;

function isUndefinedTableError(err: unknown): err is PostgresErrorLike {
  return typeof err === 'object' && err !== null && (err as PostgresErrorLike).code === '42P01';
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['t', 'true', '1'].includes(value.toLowerCase());
  return false;
}

const DASHBOARD_UNREAD_CACHE_TTL_MS = 15_000;
const DASHBOARD_UNREAD_CACHE_MAX_SIZE = 500;
const DASHBOARD_UNREAD_CACHE_ENABLED = process.env.NODE_ENV !== 'test';
const dashboardUnreadCache = new Map<number, { value: number; expiresAt: number }>();

function getCachedDashboardUnreadCount(pharmacyId: number): number | null {
  if (!DASHBOARD_UNREAD_CACHE_ENABLED) return null;
  const cached = dashboardUnreadCache.get(pharmacyId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dashboardUnreadCache.delete(pharmacyId);
    return null;
  }
  return cached.value;
}

function setCachedDashboardUnreadCount(pharmacyId: number, value: number): void {
  if (!DASHBOARD_UNREAD_CACHE_ENABLED) return;
  const now = Date.now();
  if (dashboardUnreadCache.size >= DASHBOARD_UNREAD_CACHE_MAX_SIZE && !dashboardUnreadCache.has(pharmacyId)) {
    for (const [key, entry] of dashboardUnreadCache) {
      if (entry.expiresAt <= now) dashboardUnreadCache.delete(key);
    }
    if (dashboardUnreadCache.size >= DASHBOARD_UNREAD_CACHE_MAX_SIZE) {
      const oldest = dashboardUnreadCache.keys().next().value;
      if (oldest !== undefined) dashboardUnreadCache.delete(oldest);
    }
  }
  dashboardUnreadCache.set(pharmacyId, {
    value,
    expiresAt: now + DASHBOARD_UNREAD_CACHE_TTL_MS,
  });
}

export function invalidateDashboardUnreadCache(pharmacyId: number): void {
  if (!DASHBOARD_UNREAD_CACHE_ENABLED) return;
  dashboardUnreadCache.delete(pharmacyId);
}

async function markNotificationsAsRead(executor: NotificationSqlExecutor, pharmacyId: number): Promise<number> {
  const updatedRows = await executor.execute<{ count: number }>(sql`
    WITH updated AS (
      UPDATE notifications
      SET is_read = true, read_at = now()
      WHERE pharmacy_id = ${pharmacyId} AND is_read = false
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM updated
  `);
  return Number(updatedRows.rows[0]?.count ?? 0);
}

async function markProposalCommentsAsRead(
  executor: NotificationSqlExecutor,
  pharmacyId: number,
  proposalId?: number,
): Promise<number> {
  const proposalFilter = proposalId ? sql`AND ep.id = ${proposalId}` : sql``;
  const updatedRows = await executor.execute<{ count: number }>(sql`
    WITH updated AS (
      UPDATE proposal_comments AS pc
      SET read_by_recipient = true
      WHERE pc.read_by_recipient = false
        AND pc.is_deleted = false
        AND pc.author_pharmacy_id != ${pharmacyId}
        AND EXISTS (
          SELECT 1
          FROM exchange_proposals ep
          WHERE ep.id = pc.proposal_id
            AND (ep.pharmacy_a_id = ${pharmacyId} OR ep.pharmacy_b_id = ${pharmacyId})
            ${proposalFilter}
        )
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM updated
  `);
  return Number(updatedRows.rows[0]?.count ?? 0);
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<{ id: number } | null> {
  try {
    const [result] = await db.insert(notifications).values({
      tenantId: input.tenantId ?? input.pharmacyId,
      pharmacyId: input.pharmacyId,
      type: input.type,
      title: input.title,
      message: input.message,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      detailJson: input.detailJson ?? null,
    }).returning({ id: notifications.id });
    invalidateDashboardUnreadCache(input.pharmacyId);
    publishTimelineRefresh({
      pharmacyId: input.pharmacyId,
      reason: 'notification_created',
    });
    void dispatchNotificationPush({
      pharmacyId: input.pharmacyId,
      type: input.type,
      title: input.title,
      message: input.message,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });
    return result ?? null;
  } catch (err) {
    logger.error('Failed to create notification', { error: (err as Error).message });
    return null;
  }
}

export async function getUnreadCount(pharmacyId: number): Promise<number> {
  const [result] = await db.select({ value: count() })
    .from(notifications)
    .where(and(
      eq(notifications.pharmacyId, pharmacyId),
      eq(notifications.isRead, false),
    ));
  return result?.value ?? 0;
}

export async function getDashboardUnreadCount(pharmacyId: number): Promise<number> {
  const cached = getCachedDashboardUnreadCount(pharmacyId);
  if (cached !== null) {
    return cached;
  }

  const matchUnreadPromise = db.select({ count: rowCount })
    .from(matchNotifications)
    .where(and(
      eq(matchNotifications.pharmacyId, pharmacyId),
      eq(matchNotifications.isRead, false),
    ))
    .catch((err) => {
      if (!isUndefinedTableError(err)) {
        throw err;
      }
      logger.warn('match_notifications unread count query failed (table may not exist)', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [{ count: 0 }];
    });

  const [notificationsUnread, [adminUnreadRow], [matchUnreadRow]] = await Promise.all([
    getUnreadCount(pharmacyId),
    db.select({ count: rowCount })
      .from(adminMessages)
      .leftJoin(adminMessageReads, and(
        eq(adminMessageReads.messageId, adminMessages.id),
        eq(adminMessageReads.pharmacyId, pharmacyId),
      ))
      .where(and(
        or(
          eq(adminMessages.targetType, 'all'),
          and(
            eq(adminMessages.targetType, 'pharmacy'),
            eq(adminMessages.targetPharmacyId, pharmacyId),
          ),
        ),
        isNull(adminMessageReads.messageId),
      )),
    matchUnreadPromise,
  ]);

  const totalUnread = notificationsUnread + (adminUnreadRow?.count ?? 0) + (matchUnreadRow?.count ?? 0);
  setCachedDashboardUnreadCount(pharmacyId, totalUnread);
  return totalUnread;
}

export async function getNotifications(
  pharmacyId: number,
  page: number = 1,
  limit: number = 20,
): Promise<{ rows: typeof notifications.$inferSelect[]; total: number }> {
  const offset = (page - 1) * limit;

  const [countResult] = await db.select({ value: count() })
    .from(notifications)
    .where(eq(notifications.pharmacyId, pharmacyId));

  const rows = await db.select()
    .from(notifications)
    .where(eq(notifications.pharmacyId, pharmacyId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  return { rows, total: countResult?.value ?? 0 };
}

export async function markAsRead(
  notificationId: number,
  pharmacyId: number,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.update(notifications)
    .set({ isRead: true, readAt: now })
    .where(and(
      eq(notifications.id, notificationId),
      eq(notifications.pharmacyId, pharmacyId),
    ))
    .returning({
      id: notifications.id,
      type: notifications.type,
      referenceType: notifications.referenceType,
      referenceId: notifications.referenceId,
    });
  if (result.length > 0) {
    const readNotification = result[0];
    if (
      readNotification?.type === 'new_comment'
      && readNotification.referenceType === 'proposal'
      && typeof readNotification.referenceId === 'number'
    ) {
      await markProposalCommentsAsRead(db, pharmacyId, readNotification.referenceId);
    }

    invalidateDashboardUnreadCache(pharmacyId);
    publishTimelineRefresh({
      pharmacyId,
      reason: 'notification_read',
    });
  }
  return result.length > 0;
}

export async function markAllAsRead(pharmacyId: number): Promise<number> {
  const count = await markNotificationsAsRead(db, pharmacyId);
  if (count > 0) {
    invalidateDashboardUnreadCache(pharmacyId);
    publishTimelineRefresh({
      pharmacyId,
      reason: 'notifications_marked_read',
    });
  }
  return count;
}

export async function markAllDashboardAsRead(pharmacyId: number): Promise<number> {
  const total = await db.transaction(async (tx) => {
    const notificationCount = await markNotificationsAsRead(tx, pharmacyId);
    await markProposalCommentsAsRead(tx, pharmacyId);

    const matchTableExistsRows = await tx.execute<{ exists: boolean | string | number }>(sql`
      SELECT to_regclass('public.match_notifications') IS NOT NULL AS exists
    `);
    const hasMatchNotificationsTable = toBoolean(matchTableExistsRows.rows[0]?.exists);

    const matchUpdateRows = hasMatchNotificationsTable
      ? await tx.execute<{ count: number }>(sql`
        WITH updated AS (
          UPDATE match_notifications
          SET is_read = true
          WHERE pharmacy_id = ${pharmacyId} AND is_read = false
          RETURNING 1
        )
        SELECT COUNT(*)::int AS count FROM updated
      `)
      : { rows: [{ count: 0 }] };

    const insertedAdminReadRows = await tx.execute<{ count: number }>(sql`
      WITH inserted AS (
        INSERT INTO admin_message_reads (message_id, pharmacy_id)
        SELECT m.id, ${pharmacyId}
        FROM admin_messages AS m
        LEFT JOIN admin_message_reads AS reads
          ON reads.message_id = m.id AND reads.pharmacy_id = ${pharmacyId}
        WHERE (
          m.target_type = 'all'
          OR (m.target_type = 'pharmacy' AND m.target_pharmacy_id = ${pharmacyId})
        )
          AND reads.message_id IS NULL
        ON CONFLICT (message_id, pharmacy_id) DO NOTHING
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM inserted
    `);

    const matchUpdateCount = Number(matchUpdateRows.rows[0]?.count ?? 0);
    const adminMessageReadCount = Number(insertedAdminReadRows.rows[0]?.count ?? 0);

    await tx.update(pharmacies)
      .set({ lastTimelineViewedAt: new Date().toISOString() })
      .where(eq(pharmacies.id, pharmacyId));

    return notificationCount + matchUpdateCount + adminMessageReadCount;
  });
  if (total > 0) {
    invalidateDashboardUnreadCache(pharmacyId);
    publishTimelineRefresh({
      pharmacyId,
      reason: 'dashboard_notifications_marked_read',
    });
  }
  return total;
}
