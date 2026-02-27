import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  adminMessages,
  adminMessageReads,
  matchNotifications,
  notifications,
  type NotificationReferenceType,
  type NotificationType,
} from '../db/schema';
import { rowCount } from '../utils/db-utils';
import { logger } from './logger';

interface CreateNotificationInput {
  pharmacyId: number;
  type: NotificationType;
  title: string;
  message: string;
  referenceType?: NotificationReferenceType;
  referenceId?: number;
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

export async function createNotification(
  input: CreateNotificationInput,
): Promise<{ id: number } | null> {
  try {
    const [result] = await db.insert(notifications).values({
      pharmacyId: input.pharmacyId,
      type: input.type,
      title: input.title,
      message: input.message,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
    }).returning({ id: notifications.id });
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

  return notificationsUnread + (adminUnreadRow?.count ?? 0) + (matchUnreadRow?.count ?? 0);
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
  const result = await db.update(notifications)
    .set({ isRead: true, readAt: new Date().toISOString() })
    .where(and(
      eq(notifications.id, notificationId),
      eq(notifications.pharmacyId, pharmacyId),
    ))
    .returning({ id: notifications.id });
  return result.length > 0;
}

export async function markAllAsRead(pharmacyId: number): Promise<number> {
  return markNotificationsAsRead(db, pharmacyId);
}

export async function markAllDashboardAsRead(pharmacyId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const notificationCount = await markNotificationsAsRead(tx, pharmacyId);

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

    return notificationCount + matchUpdateCount + adminMessageReadCount;
  });
}
