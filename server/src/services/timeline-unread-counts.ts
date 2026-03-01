/**
 * タイムライン未読 COUNT クエリ
 *
 * テーブルごとに軽量な COUNT(*) クエリを発行し、全行フェッチを回避する。
 */

import { and, eq, gt, gte, isNull, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  notifications as notificationsTable,
  matchNotifications,
  exchangeProposals,
  proposalComments,
  exchangeFeedback,
  uploads,
  adminMessages,
  adminMessageReads,
  exchangeHistory,
  deadStockItems,
  pharmacies,
} from '../db/schema';
import type { DbClient } from '../types/timeline';
import { rowCount } from '../utils/db-utils';
import { getExpiryDateRange } from './timeline-aggregators';

/**
 * isRead フラグパターン共通ヘルパー。
 * pharmacyId 一致 + (isRead=false OR createdAt > lastViewed) の COUNT を返す。
 */
async function countUnreadByIsReadFlag(
  db: DbClient,
  table: PgTable,
  pharmacyIdCol: Column,
  isReadCol: Column,
  createdAtCol: Column,
  pharmacyId: number,
  lastViewed: string | null,
): Promise<number> {
  const conditions = [eq(pharmacyIdCol, pharmacyId)];

  if (lastViewed) {
    conditions.push(or(eq(isReadCol, false), gt(createdAtCol, lastViewed))!);
  } else {
    conditions.push(eq(isReadCol, false));
  }

  const rows = await db
    .select({ count: rowCount })
    .from(table)
    .where(and(...conditions));
  return rows[0]?.count ?? 0;
}

/** notifications: isRead=false OR createdAt > lastViewed */
export async function countUnreadNotifications(
  db: DbClient,
  pharmacyId: number,
  lastViewed: string | null,
): Promise<number> {
  return countUnreadByIsReadFlag(
    db,
    notificationsTable,
    notificationsTable.pharmacyId,
    notificationsTable.isRead,
    notificationsTable.createdAt,
    pharmacyId,
    lastViewed,
  );
}

/** matchNotifications: isRead=false OR createdAt > lastViewed */
export async function countUnreadMatchNotifications(
  db: DbClient,
  pharmacyId: number,
  lastViewed: string | null,
): Promise<number> {
  return countUnreadByIsReadFlag(
    db,
    matchNotifications,
    matchNotifications.pharmacyId,
    matchNotifications.isRead,
    matchNotifications.createdAt,
    pharmacyId,
    lastViewed,
  );
}

/** proposalComments: 参加中提案のみ + readByRecipient=false OR createdAt > lastViewed */
export async function countUnreadComments(
  db: DbClient,
  pharmacyId: number,
  lastViewed: string | null,
): Promise<number> {
  const baseConditions = [
    eq(proposalComments.isDeleted, false),
    ne(proposalComments.authorPharmacyId, pharmacyId),
    or(
      eq(exchangeProposals.pharmacyAId, pharmacyId),
      eq(exchangeProposals.pharmacyBId, pharmacyId),
    ),
  ];

  if (lastViewed) {
    baseConditions.push(
      or(eq(proposalComments.readByRecipient, false), gt(proposalComments.createdAt, lastViewed))!,
    );
  } else {
    baseConditions.push(eq(proposalComments.readByRecipient, false));
  }

  const rows = await db
    .select({ count: rowCount })
    .from(proposalComments)
    .innerJoin(exchangeProposals, eq(proposalComments.proposalId, exchangeProposals.id))
    .where(and(...baseConditions));
  return rows[0]?.count ?? 0;
}

/** adminMessages: LEFT JOIN adminMessageReads → IS NULL (未読) + lastViewed */
export async function countUnreadAdminMessages(
  db: DbClient,
  pharmacyId: number,
  lastViewed: string | null,
): Promise<number> {
  const targetCondition = or(
    eq(adminMessages.targetType, 'all'),
    and(eq(adminMessages.targetType, 'pharmacy'), eq(adminMessages.targetPharmacyId, pharmacyId)),
  );

  const unreadCondition = lastViewed
    ? or(isNull(adminMessageReads.id), gt(adminMessages.createdAt, lastViewed))
    : isNull(adminMessageReads.id);

  const rows = await db
    .select({ count: rowCount })
    .from(adminMessages)
    .leftJoin(
      adminMessageReads,
      and(
        eq(adminMessageReads.messageId, adminMessages.id),
        eq(adminMessageReads.pharmacyId, pharmacyId),
      ),
    )
    .where(and(targetCondition, unreadCondition));

  return rows[0]?.count ?? 0;
}

/** exchangeProposals: 常に unread → COUNT(*) */
export async function countUnreadProposals(
  db: DbClient,
  pharmacyId: number,
): Promise<number> {
  const rows = await db
    .select({ count: rowCount })
    .from(exchangeProposals)
    .where(
      or(
        eq(exchangeProposals.pharmacyAId, pharmacyId),
        eq(exchangeProposals.pharmacyBId, pharmacyId),
      ),
    );
  return rows[0]?.count ?? 0;
}

/** exchangeFeedback: 常に unread → COUNT(*) */
export async function countUnreadFeedback(
  db: DbClient,
  pharmacyId: number,
): Promise<number> {
  const rows = await db
    .select({ count: rowCount })
    .from(exchangeFeedback)
    .where(eq(exchangeFeedback.toPharmacyId, pharmacyId));
  return rows[0]?.count ?? 0;
}

/** deadStockItems: 常に unread (期限リスク条件付き) → COUNT(*) */
export async function countUnreadExpiryRisk(
  db: DbClient,
  pharmacyId: number,
): Promise<number> {
  const { todayStr, threeDaysLaterStr } = getExpiryDateRange();

  const rows = await db
    .select({ count: rowCount })
    .from(deadStockItems)
    .where(
      and(
        eq(deadStockItems.pharmacyId, pharmacyId),
        eq(deadStockItems.isAvailable, true),
        isNotNull(deadStockItems.expirationDateIso),
        gte(deadStockItems.expirationDateIso, todayStr),
        lte(deadStockItems.expirationDateIso, threeDaysLaterStr),
      ),
    );
  return rows[0]?.count ?? 0;
}

/** uploads: 常に read → createdAt > lastViewed のみ */
export async function countUnreadUploads(
  db: DbClient,
  pharmacyId: number,
  lastViewed: string | null,
): Promise<number> {
  if (!lastViewed) return 0;

  const rows = await db
    .select({ count: rowCount })
    .from(uploads)
    .where(
      and(
        eq(uploads.pharmacyId, pharmacyId),
        gt(uploads.createdAt, lastViewed),
      ),
    );
  return rows[0]?.count ?? 0;
}

/** exchangeHistory: 常に read → completedAt > lastViewed のみ */
export async function countUnreadExchangeHistory(
  db: DbClient,
  pharmacyId: number,
  lastViewed: string | null,
): Promise<number> {
  if (!lastViewed) return 0;

  const rows = await db
    .select({ count: rowCount })
    .from(exchangeHistory)
    .where(
      and(
        or(
          eq(exchangeHistory.pharmacyAId, pharmacyId),
          eq(exchangeHistory.pharmacyBId, pharmacyId),
        ),
        gt(exchangeHistory.completedAt, lastViewed),
      ),
    );
  return rows[0]?.count ?? 0;
}

/**
 * 全未読数を単一 SQL で集計する（1 round trip 版）。
 *
 * 9テーブルの COUNT をスカラーサブクエリで結合し、DBへの
 * ラウンドトリップを10回から1回に削減する。
 * last_timeline_viewed_at は外側クエリの `pharmacies` 行を再利用し、
 * 各サブクエリでの重複参照を避ける。
 */
export async function countAllUnread(
  db: DbClient,
  pharmacyId: number,
): Promise<number> {
  const { todayStr, threeDaysLaterStr } = getExpiryDateRange();

  const rows = await db
    .select({
      total: sql<number>`
        COALESCE((
          SELECT count(*)::int FROM notifications
          WHERE pharmacy_id = ${pharmacyId}
            AND (is_read = false OR (
              ${pharmacies.lastTimelineViewedAt} IS NOT NULL
              AND created_at > ${pharmacies.lastTimelineViewedAt}
            ))
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM match_notifications
          WHERE pharmacy_id = ${pharmacyId}
            AND (is_read = false OR (
              ${pharmacies.lastTimelineViewedAt} IS NOT NULL
              AND created_at > ${pharmacies.lastTimelineViewedAt}
            ))
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM exchange_proposals
          WHERE pharmacy_a_id = ${pharmacyId} OR pharmacy_b_id = ${pharmacyId}
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM proposal_comments pc
          WHERE pc.is_deleted = false
            AND pc.author_pharmacy_id != ${pharmacyId}
            AND EXISTS (
              SELECT 1 FROM exchange_proposals ep
              WHERE ep.id = pc.proposal_id
                AND (ep.pharmacy_a_id = ${pharmacyId} OR ep.pharmacy_b_id = ${pharmacyId})
            )
            AND (pc.read_by_recipient = false OR (
              ${pharmacies.lastTimelineViewedAt} IS NOT NULL
              AND pc.created_at > ${pharmacies.lastTimelineViewedAt}
            ))
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM exchange_feedback
          WHERE to_pharmacy_id = ${pharmacyId}
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM uploads
          WHERE pharmacy_id = ${pharmacyId}
            AND ${pharmacies.lastTimelineViewedAt} IS NOT NULL
            AND created_at > ${pharmacies.lastTimelineViewedAt}
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM admin_messages am
          LEFT JOIN admin_message_reads amr ON amr.message_id = am.id AND amr.pharmacy_id = ${pharmacyId}
          WHERE (am.target_type = 'all' OR (am.target_type = 'pharmacy' AND am.target_pharmacy_id = ${pharmacyId}))
            AND (amr.id IS NULL OR (
              ${pharmacies.lastTimelineViewedAt} IS NOT NULL
              AND am.created_at > ${pharmacies.lastTimelineViewedAt}
            ))
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM exchange_history
          WHERE (pharmacy_a_id = ${pharmacyId} OR pharmacy_b_id = ${pharmacyId})
            AND ${pharmacies.lastTimelineViewedAt} IS NOT NULL
            AND completed_at > ${pharmacies.lastTimelineViewedAt}
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM dead_stock_items
          WHERE pharmacy_id = ${pharmacyId}
            AND is_available = true
            AND expiration_date_iso IS NOT NULL
            AND expiration_date_iso >= ${todayStr}
            AND expiration_date_iso <= ${threeDaysLaterStr}
        ), 0)
      `,
    })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId));

  return rows[0]?.total ?? 0;
}
