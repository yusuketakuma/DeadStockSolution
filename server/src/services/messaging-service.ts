import { and, desc, eq, ne, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { directMessages, pharmacies } from '../db/schema';

export interface DirectMessage {
  id: number;
  fromPharmacyId: number;
  toPharmacyId: number;
  body: string;
  isRead: boolean;
  readAt: Date | null;
  isDeleted: boolean;
  createdAt: Date;
}

export interface Thread {
  otherPharmacyId: number;
  otherPharmacyName: string;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
}

export interface PaginatedMessages {
  messages: DirectMessage[];
  total: number;
}

export async function sendMessage(
  fromId: number,
  toId: number,
  body: string,
): Promise<DirectMessage> {
  const [inserted] = await db
    .insert(directMessages)
    .values({
      fromPharmacyId: fromId,
      toPharmacyId: toId,
      body,
      isRead: false,
      isDeleted: false,
    })
    .returning({
      id: directMessages.id,
      fromPharmacyId: directMessages.fromPharmacyId,
      toPharmacyId: directMessages.toPharmacyId,
      body: directMessages.body,
      isRead: directMessages.isRead,
      readAt: directMessages.readAt,
      isDeleted: directMessages.isDeleted,
      createdAt: directMessages.createdAt,
    });
  return inserted as DirectMessage;
}

export async function getThreads(pharmacyId: number): Promise<Thread[]> {
  // Find all conversation partners and aggregate last message + unread count
  const rows = await db.execute<{
    other_pharmacy_id: number;
    other_pharmacy_name: string;
    last_message: string;
    last_message_at: Date;
    unread_count: string;
  }>(sql`
    SELECT
      p.id AS other_pharmacy_id,
      p.name AS other_pharmacy_name,
      latest.body AS last_message,
      latest.created_at AS last_message_at,
      COALESCE(unread.cnt, 0) AS unread_count
    FROM (
      SELECT DISTINCT
        CASE
          WHEN from_pharmacy_id = ${pharmacyId} THEN to_pharmacy_id
          ELSE from_pharmacy_id
        END AS partner_id
      FROM direct_messages
      WHERE (from_pharmacy_id = ${pharmacyId} OR to_pharmacy_id = ${pharmacyId})
        AND is_deleted = false
    ) AS partners
    JOIN pharmacies p ON p.id = partners.partner_id
    JOIN LATERAL (
      SELECT body, created_at
      FROM direct_messages
      WHERE (
        (from_pharmacy_id = ${pharmacyId} AND to_pharmacy_id = partners.partner_id)
        OR (from_pharmacy_id = partners.partner_id AND to_pharmacy_id = ${pharmacyId})
      )
      AND is_deleted = false
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) AS latest ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt
      FROM direct_messages
      WHERE to_pharmacy_id = ${pharmacyId}
        AND from_pharmacy_id = partners.partner_id
        AND is_read = false
        AND is_deleted = false
    ) AS unread ON true
    ORDER BY latest.created_at DESC
  `);

  return rows.rows.map((row) => ({
    otherPharmacyId: row.other_pharmacy_id,
    otherPharmacyName: row.other_pharmacy_name,
    lastMessage: row.last_message,
    lastMessageAt: new Date(row.last_message_at),
    unreadCount: Number(row.unread_count),
  }));
}

export async function getThread(
  pharmacyId: number,
  otherPharmacyId: number,
  page: number,
  limit: number,
): Promise<PaginatedMessages> {
  const offset = (page - 1) * limit;

  const condition = and(
    or(
      and(
        eq(directMessages.fromPharmacyId, pharmacyId),
        eq(directMessages.toPharmacyId, otherPharmacyId),
      ),
      and(
        eq(directMessages.fromPharmacyId, otherPharmacyId),
        eq(directMessages.toPharmacyId, pharmacyId),
      ),
    ),
    eq(directMessages.isDeleted, false),
  );

  const [messages, countRows] = await Promise.all([
    db
      .select({
        id: directMessages.id,
        fromPharmacyId: directMessages.fromPharmacyId,
        toPharmacyId: directMessages.toPharmacyId,
        body: directMessages.body,
        isRead: directMessages.isRead,
        readAt: directMessages.readAt,
        isDeleted: directMessages.isDeleted,
        createdAt: directMessages.createdAt,
      })
      .from(directMessages)
      .where(condition)
      .orderBy(desc(directMessages.createdAt), desc(directMessages.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<string>`COUNT(*)` })
      .from(directMessages)
      .where(condition),
  ]);

  const total = Number(countRows[0]?.count ?? 0);

  return {
    messages: messages as DirectMessage[],
    total,
  };
}

export async function markThreadRead(
  pharmacyId: number,
  otherPharmacyId: number,
): Promise<number> {
  const result = await db
    .update(directMessages)
    .set({
      isRead: true,
      readAt: new Date(),
    })
    .where(
      and(
        eq(directMessages.toPharmacyId, pharmacyId),
        eq(directMessages.fromPharmacyId, otherPharmacyId),
        eq(directMessages.isRead, false),
        eq(directMessages.isDeleted, false),
      ),
    )
    .returning({ id: directMessages.id });

  return result.length;
}

export async function getUnreadCount(pharmacyId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(directMessages)
    .where(
      and(
        eq(directMessages.toPharmacyId, pharmacyId),
        eq(directMessages.isRead, false),
        eq(directMessages.isDeleted, false),
      ),
    );

  return Number(row?.count ?? 0);
}

// Export for use in route to check if the other pharmacy exists
export async function pharmacyExists(pharmacyId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1);
  return !!row;
}
