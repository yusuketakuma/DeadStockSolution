import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  directMessageAttachments,
  directMessages,
  pharmacies,
} from '../db/schema';
import {
  decodeAttachmentContent,
  encodeAttachmentContent,
  sanitizeAttachmentFileName,
} from '../utils/attachment-utils';
import { escapeLikeWildcards } from '../utils/request-utils';

export interface DirectMessageAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface DirectMessage {
  id: number;
  fromPharmacyId: number;
  toPharmacyId: number;
  body: string;
  isRead: boolean;
  readAt: Date | null;
  isDeleted: boolean;
  createdAt: Date;
  attachments: DirectMessageAttachment[];
}

export interface Thread {
  otherPharmacyId: number;
  otherPharmacyName: string;
  lastMessageBody: string;
  lastMessageAt: Date;
  lastMessageSenderId: number;
  unreadCount: number;
  waitingOn: 'me' | 'them' | null;
  isOverdue: boolean;
  hasAttachments: boolean;
}

export interface PaginatedMessages {
  messages: DirectMessage[];
  total: number;
}

export interface AdminDirectMessageThread {
  pharmacyAId: number;
  pharmacyAName: string;
  pharmacyBId: number;
  pharmacyBName: string;
  lastMessage: string;
  lastMessageAt: Date;
  lastMessageSenderId: number;
  messageCount: number;
  waitingOn: string | null;
  isOverdue: boolean;
  hasAttachments: boolean;
}

export interface AdminDirectMessageThreadsResult {
  threads: AdminDirectMessageThread[];
  total: number;
}

export interface AdminDirectMessageThreadDetail {
  pharmacyAId: number;
  pharmacyAName: string;
  pharmacyBId: number;
  pharmacyBName: string;
}

interface RawThreadRow {
  [key: string]: unknown;
  other_pharmacy_id: number;
  other_pharmacy_name: string;
  last_message_body: string;
  last_message_at: Date;
  last_message_sender_id: number;
  unread_count: string;
  has_attachments: boolean;
}

interface RawAdminThreadRow {
  [key: string]: unknown;
  pharmacy_a_id: number;
  pharmacy_a_name: string;
  pharmacy_b_id: number;
  pharmacy_b_name: string;
  last_message: string;
  last_message_at: Date;
  last_message_sender_id: number;
  message_count: string;
  has_attachments: boolean;
}

function computeThreadWatchState(lastMessageAt: Date, waitingOn: 'me' | 'them' | null): boolean {
  if (!waitingOn) {
    return false;
  }
  const hoursSinceLastMessage = (Date.now() - lastMessageAt.getTime()) / (1000 * 60 * 60);
  return hoursSinceLastMessage >= 24;
}

function normalizeThread(row: RawThreadRow, myPharmacyId: number): Thread {
  const waitingOn = row.last_message_sender_id === myPharmacyId ? 'them' : 'me';
  const lastMessageAt = new Date(row.last_message_at);
  return {
    otherPharmacyId: row.other_pharmacy_id,
    otherPharmacyName: row.other_pharmacy_name,
    lastMessageBody: row.last_message_body,
    lastMessageAt,
    lastMessageSenderId: row.last_message_sender_id,
    unreadCount: Number(row.unread_count),
    waitingOn,
    isOverdue: computeThreadWatchState(lastMessageAt, waitingOn),
    hasAttachments: Boolean(row.has_attachments),
  };
}

function normalizeAdminThread(row: RawAdminThreadRow): AdminDirectMessageThread {
  const waitingOn = row.last_message_sender_id === row.pharmacy_a_id
    ? row.pharmacy_b_name
    : row.pharmacy_a_name;
  const lastMessageAt = new Date(row.last_message_at);
  return {
    pharmacyAId: row.pharmacy_a_id,
    pharmacyAName: row.pharmacy_a_name,
    pharmacyBId: row.pharmacy_b_id,
    pharmacyBName: row.pharmacy_b_name,
    lastMessage: row.last_message,
    lastMessageAt,
    lastMessageSenderId: row.last_message_sender_id,
    messageCount: Number(row.message_count),
    waitingOn,
    isOverdue: computeThreadWatchState(lastMessageAt, waitingOn ? 'them' : null),
    hasAttachments: Boolean(row.has_attachments),
  };
}

async function listDirectMessageAttachmentsByMessageIds(messageIds: number[]): Promise<Map<number, DirectMessageAttachment[]>> {
  if (messageIds.length === 0) {
    return new Map();
  }

  const rows = await db.select({
    id: directMessageAttachments.id,
    messageId: directMessageAttachments.messageId,
    fileName: directMessageAttachments.fileName,
    mimeType: directMessageAttachments.mimeType,
    fileSize: directMessageAttachments.fileSize,
  })
    .from(directMessageAttachments)
    .where(inArray(directMessageAttachments.messageId, messageIds))
    .orderBy(asc(directMessageAttachments.createdAt), asc(directMessageAttachments.id));

  const map = new Map<number, DirectMessageAttachment[]>();
  for (const row of rows) {
    const list = map.get(row.messageId) ?? [];
    list.push({
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
    });
    map.set(row.messageId, list);
  }
  return map;
}

export async function sendMessage(
  fromId: number,
  toId: number,
  body: string,
  files: Express.Multer.File[] = [],
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

  let attachments: DirectMessageAttachment[] = [];
  if (files.length > 0) {
    attachments = await db.insert(directMessageAttachments)
      .values(files.map((file) => ({
        messageId: inserted.id,
        fileName: sanitizeAttachmentFileName(file.originalname),
        mimeType: file.mimetype,
        fileSize: file.size,
        contentBase64: encodeAttachmentContent(file.buffer),
      })))
      .returning({
        id: directMessageAttachments.id,
        fileName: directMessageAttachments.fileName,
        mimeType: directMessageAttachments.mimeType,
        fileSize: directMessageAttachments.fileSize,
      });
  }

  return {
    ...(inserted as Omit<DirectMessage, 'attachments'>),
    attachments,
  };
}

export async function getThreads(pharmacyId: number, search: string | null = null): Promise<Thread[]> {
  const normalizedSearch = search?.trim() ? `%${escapeLikeWildcards(search.trim())}%` : null;
  const searchFilter = normalizedSearch
    ? sql`
      AND (
        p.name ILIKE ${normalizedSearch}
        OR EXISTS (
          SELECT 1
          FROM direct_messages dm_search
          WHERE dm_search.is_deleted = false
            AND (
              (dm_search.from_pharmacy_id = ${pharmacyId} AND dm_search.to_pharmacy_id = partners.partner_id)
              OR (dm_search.from_pharmacy_id = partners.partner_id AND dm_search.to_pharmacy_id = ${pharmacyId})
            )
            AND dm_search.body ILIKE ${normalizedSearch}
        )
      )
    `
    : sql``;

  const rows = await db.execute<RawThreadRow>(sql`
    SELECT
      p.id AS other_pharmacy_id,
      p.name AS other_pharmacy_name,
      latest.body AS last_message_body,
      latest.created_at AS last_message_at,
      latest.from_pharmacy_id AS last_message_sender_id,
      COALESCE(unread.cnt, 0) AS unread_count,
      EXISTS (
        SELECT 1
        FROM direct_message_attachments dma
        WHERE dma.message_id = latest.id
      ) AS has_attachments
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
      SELECT id, body, created_at, from_pharmacy_id
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
    WHERE 1 = 1
    ${searchFilter}
    ORDER BY latest.created_at DESC
  `);

  return rows.rows.map((row) => normalizeThread(row, pharmacyId));
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

  const attachmentsByMessageId = await listDirectMessageAttachmentsByMessageIds(messages.map((message) => message.id));
  const total = Number(countRows[0]?.count ?? 0);

  return {
    messages: messages.map((message) => ({
      ...(message as Omit<DirectMessage, 'attachments'>),
      attachments: attachmentsByMessageId.get(message.id) ?? [],
    })),
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

export async function pharmacyExists(pharmacyId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1);
  return !!row;
}

export async function getAdminDirectMessageThreads(
  page: number,
  limit: number,
  search: string | null,
): Promise<AdminDirectMessageThreadsResult> {
  const offset = (page - 1) * limit;
  const normalizedSearch = search?.trim() ? `%${escapeLikeWildcards(search.trim())}%` : null;
  const searchFilter = normalizedSearch
    ? sql`
      AND (
        pa.name ILIKE ${normalizedSearch}
        OR pb.name ILIKE ${normalizedSearch}
        OR EXISTS (
          SELECT 1
          FROM direct_messages dm_search
          WHERE dm_search.is_deleted = false
            AND LEAST(dm_search.from_pharmacy_id, dm_search.to_pharmacy_id) = tp.pharmacy_a_id
            AND GREATEST(dm_search.from_pharmacy_id, dm_search.to_pharmacy_id) = tp.pharmacy_b_id
            AND dm_search.body ILIKE ${normalizedSearch}
        )
      )
    `
    : sql``;

  const rows = await db.execute<RawAdminThreadRow>(sql`
    WITH thread_pairs AS (
      SELECT
        LEAST(from_pharmacy_id, to_pharmacy_id) AS pharmacy_a_id,
        GREATEST(from_pharmacy_id, to_pharmacy_id) AS pharmacy_b_id
      FROM direct_messages
      WHERE is_deleted = false
      GROUP BY 1, 2
    )
    SELECT
      tp.pharmacy_a_id,
      pa.name AS pharmacy_a_name,
      tp.pharmacy_b_id,
      pb.name AS pharmacy_b_name,
      latest.body AS last_message,
      latest.created_at AS last_message_at,
      latest.from_pharmacy_id AS last_message_sender_id,
      counts.message_count,
      EXISTS (
        SELECT 1
        FROM direct_message_attachments dma
        WHERE dma.message_id = latest.id
      ) AS has_attachments
    FROM thread_pairs tp
    JOIN pharmacies pa ON pa.id = tp.pharmacy_a_id
    JOIN pharmacies pb ON pb.id = tp.pharmacy_b_id
    JOIN LATERAL (
      SELECT id, body, created_at, from_pharmacy_id
      FROM direct_messages dm
      WHERE dm.is_deleted = false
        AND LEAST(dm.from_pharmacy_id, dm.to_pharmacy_id) = tp.pharmacy_a_id
        AND GREATEST(dm.from_pharmacy_id, dm.to_pharmacy_id) = tp.pharmacy_b_id
      ORDER BY dm.created_at DESC, dm.id DESC
      LIMIT 1
    ) AS latest ON true
    JOIN LATERAL (
      SELECT COUNT(*)::text AS message_count
      FROM direct_messages dm
      WHERE dm.is_deleted = false
        AND LEAST(dm.from_pharmacy_id, dm.to_pharmacy_id) = tp.pharmacy_a_id
        AND GREATEST(dm.from_pharmacy_id, dm.to_pharmacy_id) = tp.pharmacy_b_id
    ) AS counts ON true
    WHERE 1 = 1
    ${searchFilter}
    ORDER BY latest.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const countRows = await db.execute<{ count: string }>(sql`
    WITH thread_pairs AS (
      SELECT
        LEAST(from_pharmacy_id, to_pharmacy_id) AS pharmacy_a_id,
        GREATEST(from_pharmacy_id, to_pharmacy_id) AS pharmacy_b_id
      FROM direct_messages
      WHERE is_deleted = false
      GROUP BY 1, 2
    )
    SELECT COUNT(*)::text AS count
    FROM thread_pairs tp
    JOIN pharmacies pa ON pa.id = tp.pharmacy_a_id
    JOIN pharmacies pb ON pb.id = tp.pharmacy_b_id
    WHERE 1 = 1
    ${searchFilter}
  `);

  return {
    threads: rows.rows.map(normalizeAdminThread),
    total: Number(countRows.rows[0]?.count ?? 0),
  };
}

export async function getAdminDirectMessageThreadDetail(
  pharmacyAId: number,
  pharmacyBId: number,
): Promise<AdminDirectMessageThreadDetail | null> {
  const [first, second] = pharmacyAId < pharmacyBId
    ? [pharmacyAId, pharmacyBId]
    : [pharmacyBId, pharmacyAId];

  const rows = await db
    .select({
      id: pharmacies.id,
      name: pharmacies.name,
    })
    .from(pharmacies)
    .where(or(
      eq(pharmacies.id, first),
      eq(pharmacies.id, second),
    ));

  const firstPharmacy = rows.find((row) => row.id === first);
  const secondPharmacy = rows.find((row) => row.id === second);
  if (!firstPharmacy || !secondPharmacy) {
    return null;
  }

  return {
    pharmacyAId: first,
    pharmacyAName: firstPharmacy.name,
    pharmacyBId: second,
    pharmacyBName: secondPharmacy.name,
  };
}

export async function getDirectMessageAttachmentDownload(
  attachmentId: number,
): Promise<{
  messageId: number;
  fromPharmacyId: number;
  toPharmacyId: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  content: Buffer;
} | null> {
  const [row] = await db.select({
    messageId: directMessages.id,
    fromPharmacyId: directMessages.fromPharmacyId,
    toPharmacyId: directMessages.toPharmacyId,
    fileName: directMessageAttachments.fileName,
    mimeType: directMessageAttachments.mimeType,
    fileSize: directMessageAttachments.fileSize,
    contentBase64: directMessageAttachments.contentBase64,
  })
    .from(directMessageAttachments)
    .innerJoin(directMessages, eq(directMessages.id, directMessageAttachments.messageId))
    .where(eq(directMessageAttachments.id, attachmentId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    messageId: row.messageId,
    fromPharmacyId: row.fromPharmacyId,
    toPharmacyId: row.toPharmacyId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    content: decodeAttachmentContent(row.contentBase64),
  };
}
