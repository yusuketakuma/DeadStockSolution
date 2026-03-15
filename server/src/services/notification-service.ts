import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import {
  adminMessages,
  adminMessageReads,
  matchNotifications,
  notifications,
  type NotificationReferenceType,
  type NotificationType,
} from '../db/schema';
import { rowCount } from '../utils/db-utils';
import { getServiceDeps, type ServiceDependencies } from './service-container';

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

type NotificationSqlExecutor = Pick<ServiceDependencies['db'], 'execute'>;
type CountRow = { count?: number | string | null };
type ExistsRow = { exists?: boolean | string | number | null };

function isUndefinedTableError(err: unknown): err is PostgresErrorLike {
  return typeof err === 'object' && err !== null && (err as PostgresErrorLike).code === '42P01';
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['t', 'true', '1'].includes(value.toLowerCase());
  return false;
}

function toCount(value: unknown): number {
  return Number(value ?? 0);
}

const DASHBOARD_UNREAD_CACHE_TTL_MS = 15_000;
const DASHBOARD_UNREAD_CACHE_MAX_SIZE = 500;
const DASHBOARD_UNREAD_CACHE_ENABLED = process.env.NODE_ENV !== 'test';
const dashboardUnreadCache = new Map<number, { value: number; expiresAt: number }>();

type PreparedNotificationUnreadCountByPharmacy = {
  execute(params: { pharmacyId: number }): Promise<Array<{ value: number }>>;
};

let prepared_notification_unread_count_by_pharmacy: PreparedNotificationUnreadCountByPharmacy | null = null;

function bindParam<T>(name: string): T {
  const placeholderFn = (sql as typeof sql & { placeholder?: (placeholderName: string) => unknown }).placeholder;
  if (typeof placeholderFn === 'function') {
    return placeholderFn(name) as T;
  }
  return name as T;
}

function getPreparedNotificationUnreadCountByPharmacy(
  deps: ServiceDependencies,
): PreparedNotificationUnreadCountByPharmacy | null {
  const placeholderFn = (sql as (typeof sql | undefined) & { placeholder?: unknown })?.placeholder;
  if (process.env.NODE_ENV === 'test' || typeof placeholderFn !== 'function') {
    return null;
  }
  if (deps.db !== getServiceDeps().db) {
    return null;
  }
  if (prepared_notification_unread_count_by_pharmacy) {
    return prepared_notification_unread_count_by_pharmacy;
  }
  const query = deps.db.select({ value: count() })
    .from(notifications)
    .where(and(
      eq(notifications.pharmacyId, bindParam<number>('pharmacyId')),
      eq(notifications.isRead, false),
    ));
  if (typeof (query as { prepare?: unknown }).prepare === 'function') {
    prepared_notification_unread_count_by_pharmacy = (query as { prepare(name: string): PreparedNotificationUnreadCountByPharmacy })
      .prepare('prepared_notification_unread_count_by_pharmacy');
  }
  return prepared_notification_unread_count_by_pharmacy;
}

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

function invalidateDashboardUnreadCacheIfNeeded(pharmacyId: number, affectedCount: number): void {
  if (affectedCount <= 0) return;
  invalidateDashboardUnreadCache(pharmacyId);
}

async function markNotificationsAsRead(executor: NotificationSqlExecutor, pharmacyId: number): Promise<number> {
  const updatedRows = await executor.execute<CountRow>(sql`
    WITH updated AS (
      UPDATE notifications
      SET is_read = true, read_at = now()
      WHERE pharmacy_id = ${pharmacyId} AND is_read = false
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM updated
  `);
  return toCount(updatedRows.rows[0]?.count);
}

async function getAdminUnreadCount(
  pharmacyId: number,
  deps: ServiceDependencies,
): Promise<number> {
  const [adminUnreadRow] = await deps.db.select({ count: rowCount })
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
    ));

  return toCount(adminUnreadRow?.count);
}

async function countUnreadSources(pharmacyId: number, deps: ServiceDependencies): Promise<{
  notificationsUnread: number;
  adminUnread: number;
  matchUnread: number;
}> {
  const matchUnreadPromise = getMatchUnreadCount(pharmacyId, deps);
  const [matchUnread, notificationsUnread, adminUnread] = await Promise.all([
    matchUnreadPromise,
    getUnreadCount(pharmacyId, deps),
    getAdminUnreadCount(pharmacyId, deps),
  ]);

  return { notificationsUnread, adminUnread, matchUnread };
}

async function getMatchUnreadCount(pharmacyId: number, deps: ServiceDependencies): Promise<number> {
  const [matchUnreadRow] = await deps.db.select({ count: rowCount })
    .from(matchNotifications)
    .where(and(
      eq(matchNotifications.pharmacyId, pharmacyId),
      eq(matchNotifications.isRead, false),
    ))
    .catch((err) => {
      if (!isUndefinedTableError(err)) {
        throw err;
      }
      deps.logger.warn('match_notifications unread count query failed (table may not exist)', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [{ count: 0 }];
    });

  return toCount(matchUnreadRow?.count);
}

async function hasMatchNotificationsTable(executor: NotificationSqlExecutor): Promise<boolean> {
  const matchTableExistsRows = await executor.execute<ExistsRow>(sql`
    SELECT to_regclass('public.match_notifications') IS NOT NULL AS exists
  `);

  return toBoolean(matchTableExistsRows.rows[0]?.exists);
}

async function markMatchNotificationsAsRead(
  executor: NotificationSqlExecutor,
  pharmacyId: number,
): Promise<number> {
  if (!(await hasMatchNotificationsTable(executor))) {
    return 0;
  }

  const matchUpdateRows = await executor.execute<CountRow>(sql`
    WITH updated AS (
      UPDATE match_notifications
      SET is_read = true
      WHERE pharmacy_id = ${pharmacyId} AND is_read = false
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM updated
  `);

  return toCount(matchUpdateRows.rows[0]?.count);
}

async function markAdminMessagesAsRead(
  executor: NotificationSqlExecutor,
  pharmacyId: number,
): Promise<number> {
  const insertedAdminReadRows = await executor.execute<CountRow>(sql`
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

  return toCount(insertedAdminReadRows.rows[0]?.count);
}

export async function createNotification(
  input: CreateNotificationInput,
  deps: ServiceDependencies = getServiceDeps(),
): Promise<{ id: number } | null> {
  try {
    const [result] = await deps.db.insert(notifications).values({
      pharmacyId: input.pharmacyId,
      type: input.type,
      title: input.title,
      message: input.message,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
    }).returning({ id: notifications.id });
    invalidateDashboardUnreadCache(input.pharmacyId);
    return result ?? null;
  } catch (err) {
    deps.logger.error('Failed to create notification', { error: (err as Error).message });
    return null;
  }
}

export async function getUnreadCount(
  pharmacyId: number,
  deps: ServiceDependencies = getServiceDeps(),
): Promise<number> {
  const prepared = getPreparedNotificationUnreadCountByPharmacy(deps);
  const [result] = prepared
    ? await prepared.execute({ pharmacyId })
    : await deps.db.select({ value: count() })
      .from(notifications)
      .where(and(
        eq(notifications.pharmacyId, pharmacyId),
        eq(notifications.isRead, false),
      ));
  return result?.value ?? 0;
}

export async function getDashboardUnreadCount(
  pharmacyId: number,
  deps: ServiceDependencies = getServiceDeps(),
): Promise<number> {
  const cached = getCachedDashboardUnreadCount(pharmacyId);
  if (cached !== null) {
    return cached;
  }

  const { notificationsUnread, adminUnread, matchUnread } = await countUnreadSources(pharmacyId, deps);
  const totalUnread = notificationsUnread + adminUnread + matchUnread;
  setCachedDashboardUnreadCount(pharmacyId, totalUnread);
  return totalUnread;
}

export async function getNotifications(
  pharmacyId: number,
  page: number = 1,
  limit: number = 20,
  deps: ServiceDependencies = getServiceDeps(),
): Promise<{ rows: typeof notifications.$inferSelect[]; total: number }> {
  const offset = (page - 1) * limit;

  const [countResult] = await deps.db.select({ value: count() })
    .from(notifications)
    .where(eq(notifications.pharmacyId, pharmacyId));

  const rows = await deps.db.select()
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
  deps: ServiceDependencies = getServiceDeps(),
): Promise<boolean> {
  const result = await deps.db.update(notifications)
    .set({ isRead: true, readAt: new Date().toISOString() })
    .where(and(
      eq(notifications.id, notificationId),
      eq(notifications.pharmacyId, pharmacyId),
    ))
    .returning({ id: notifications.id });
  const wasUpdated = result.length > 0;
  invalidateDashboardUnreadCacheIfNeeded(pharmacyId, wasUpdated ? 1 : 0);
  return wasUpdated;
}

export async function markAllAsRead(
  pharmacyId: number,
  deps: ServiceDependencies = getServiceDeps(),
): Promise<number> {
  const count = await markNotificationsAsRead(deps.db, pharmacyId);
  invalidateDashboardUnreadCacheIfNeeded(pharmacyId, count);
  return count;
}

export async function markAllDashboardAsRead(
  pharmacyId: number,
  deps: ServiceDependencies = getServiceDeps(),
): Promise<number> {
  const total = await deps.db.transaction(async (tx) => {
    const notificationCount = await markNotificationsAsRead(tx, pharmacyId);
    const matchUpdateCount = await markMatchNotificationsAsRead(tx, pharmacyId);
    const adminMessageReadCount = await markAdminMessagesAsRead(tx, pharmacyId);
    return notificationCount + matchUpdateCount + adminMessageReadCount;
  });
  invalidateDashboardUnreadCacheIfNeeded(pharmacyId, total);
  return total;
}

export function createNotificationService(deps: ServiceDependencies = getServiceDeps()) {
  return {
    createNotification: (input: CreateNotificationInput) => createNotification(input, deps),
    getUnreadCount: (pharmacyId: number) => getUnreadCount(pharmacyId, deps),
    getDashboardUnreadCount: (pharmacyId: number) => getDashboardUnreadCount(pharmacyId, deps),
    getNotifications: (pharmacyId: number, page?: number, limit?: number) => getNotifications(pharmacyId, page, limit, deps),
    markAsRead: (notificationId: number, pharmacyId: number) => markAsRead(notificationId, pharmacyId, deps),
    markAllAsRead: (pharmacyId: number) => markAllAsRead(pharmacyId, deps),
    markAllDashboardAsRead: (pharmacyId: number) => markAllDashboardAsRead(pharmacyId, deps),
    invalidateDashboardUnreadCache,
  };
}
