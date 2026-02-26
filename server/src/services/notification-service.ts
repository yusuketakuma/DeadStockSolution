import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { notifications } from '../db/schema';
import { logger } from './logger';

interface CreateNotificationInput {
  pharmacyId: number;
  type: string;
  title: string;
  message: string;
  referenceType?: string;
  referenceId?: number;
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
  const result = await db.update(notifications)
    .set({ isRead: true, readAt: new Date().toISOString() })
    .where(and(
      eq(notifications.pharmacyId, pharmacyId),
      eq(notifications.isRead, false),
    ))
    .returning({ id: notifications.id });
  return result.length;
}
