/**
 * タイムライン未読 COUNT クエリ
 *
 * テーブルごとに軽量な COUNT(*) クエリを発行し、全行フェッチを回避する。
 */

import { and, eq, gt, gte, isNull, isNotNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  notifications as notificationsTable,
  exchangeProposals,
  proposalComments,
  exchangeFeedback,
  uploadJobs,
  adminMessages,
  adminMessageReads,
  deadStockItems,
  pharmacies,
} from '../db/schema';
import type { DbClient } from '../types/timeline';
import { rowCount } from '../utils/db-utils';
import { getExpiryDateRange } from './timeline-aggregators';
import {
  TIMELINE_SEPARATE_NOTIFICATION_TYPES,
  buildTimelineExcludedNotificationTypesSql,
} from './timeline-notification-rules';

async function countRows(
  db: DbClient,
  table: PgTable,
  whereCondition: ReturnType<typeof and> | ReturnType<typeof or> | ReturnType<typeof eq>,
): Promise<number> {
  const rows = await db
    .select({ count: rowCount })
    .from(table)
    .where(whereCondition);
  return rows[0]?.count ?? 0;
}

/** notifications: 明示的な isRead=false のみを未読として数える */
export async function countUnreadNotifications(
  db: DbClient,
  pharmacyId: number,
  _lastViewed: string | null,
): Promise<number> {
  const conditions = [
    eq(notificationsTable.pharmacyId, pharmacyId),
    eq(notificationsTable.isRead, false),
    notInArray(notificationsTable.type, TIMELINE_SEPARATE_NOTIFICATION_TYPES),
  ];

  const rows = await db
    .select({ count: rowCount })
    .from(notificationsTable)
    .where(and(...conditions));
  return rows[0]?.count ?? 0;
}

/** proposalComments: 参加中提案のみ + readByRecipient=false */
export async function countUnreadComments(
  db: DbClient,
  pharmacyId: number,
  _lastViewed: string | null,
): Promise<number> {
  const baseConditions = [
    eq(proposalComments.isDeleted, false),
    ne(proposalComments.authorPharmacyId, pharmacyId),
    or(
      eq(exchangeProposals.pharmacyAId, pharmacyId),
      eq(exchangeProposals.pharmacyBId, pharmacyId),
    ),
    eq(proposalComments.readByRecipient, false),
  ];

  const rows = await db
    .select({ count: rowCount })
    .from(proposalComments)
    .innerJoin(exchangeProposals, eq(proposalComments.proposalId, exchangeProposals.id))
    .where(and(...baseConditions));
  return rows[0]?.count ?? 0;
}

/** adminMessages: LEFT JOIN adminMessageReads → IS NULL (未読) */
export async function countUnreadAdminMessages(
  db: DbClient,
  pharmacyId: number,
  _lastViewed: string | null,
): Promise<number> {
  const targetCondition = or(
    eq(adminMessages.targetType, 'all'),
    and(eq(adminMessages.targetType, 'pharmacy'), eq(adminMessages.targetPharmacyId, pharmacyId)),
  );

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
    .where(and(targetCondition, isNull(adminMessageReads.id)));

  return rows[0]?.count ?? 0;
}

/** exchangeProposals: createdAt > lastViewed のみ */
export async function countUnreadProposals(
  db: DbClient,
  pharmacyId: number,
  lastViewed: string | null,
): Promise<number> {
  const ownershipCondition = or(
    eq(exchangeProposals.pharmacyAId, pharmacyId),
    eq(exchangeProposals.pharmacyBId, pharmacyId),
  )!;
  const base = and(
    ownershipCondition,
    ne(exchangeProposals.status, 'completed'),
  );
  if (!lastViewed) return countRows(db, exchangeProposals, base);
  return countRows(db, exchangeProposals, and(base, gt(exchangeProposals.proposedAt, lastViewed)));
}

/** exchangeFeedback: createdAt > lastViewed のみ */
export async function countUnreadFeedback(
  db: DbClient,
  pharmacyId: number,
  lastViewed: string | null,
): Promise<number> {
  const base = eq(exchangeFeedback.toPharmacyId, pharmacyId);
  if (!lastViewed) return countRows(db, exchangeFeedback, base);
  return countRows(db, exchangeFeedback, and(base, gt(exchangeFeedback.createdAt, lastViewed)));
}

/** deadStockItems: 常に unread (期限リスク条件付き) → COUNT(*) */
export async function countUnreadExpiryRisk(
  db: DbClient,
  pharmacyId: number,
): Promise<number> {
  const { todayStr, threeDaysLaterStr } = getExpiryDateRange();
  return countRows(db, deadStockItems, and(
    eq(deadStockItems.pharmacyId, pharmacyId),
    eq(deadStockItems.isAvailable, true),
    isNotNull(deadStockItems.expirationDateIso),
    gte(deadStockItems.expirationDateIso, todayStr),
    lte(deadStockItems.expirationDateIso, threeDaysLaterStr),
  ));
}

/** upload_confirm_jobs: 常に read → createdAt > lastViewed のみ */
export async function countUnreadUploads(
  db: DbClient,
  pharmacyId: number,
  lastViewed: string | null,
): Promise<number> {
  if (!lastViewed) return 0;
  return countRows(db, uploadJobs, and(
    eq(uploadJobs.pharmacyId, pharmacyId),
    gt(uploadJobs.createdAt, lastViewed),
  ));
}

/** exchangeProposals(completed): completedAt > lastViewed のみ */
export async function countUnreadExchangeHistory(
  db: DbClient,
  pharmacyId: number,
  lastViewed: string | null,
): Promise<number> {
  if (!lastViewed) return 0;
  return countRows(db, exchangeProposals, and(
    eq(exchangeProposals.status, 'completed'),
    or(
      eq(exchangeProposals.pharmacyAId, pharmacyId),
      eq(exchangeProposals.pharmacyBId, pharmacyId),
    ),
    gt(exchangeProposals.completedAt, lastViewed),
  ));
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
            AND is_read = false
            AND type NOT IN (${buildTimelineExcludedNotificationTypesSql()})
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM match_notifications
          WHERE pharmacy_id = ${pharmacyId}
            AND is_read = false
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM exchange_proposals
          WHERE (pharmacy_a_id = ${pharmacyId} OR pharmacy_b_id = ${pharmacyId})
            AND status != 'completed'
            AND (
              ${pharmacies.lastTimelineViewedAt} IS NULL
              OR proposed_at > ${pharmacies.lastTimelineViewedAt}
            )
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
            AND pc.read_by_recipient = false
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM exchange_feedback
          WHERE to_pharmacy_id = ${pharmacyId}
            AND (
              ${pharmacies.lastTimelineViewedAt} IS NULL
              OR created_at > ${pharmacies.lastTimelineViewedAt}
            )
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM upload_confirm_jobs
          WHERE pharmacy_id = ${pharmacyId}
            AND ${pharmacies.lastTimelineViewedAt} IS NOT NULL
            AND created_at > ${pharmacies.lastTimelineViewedAt}
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM admin_messages am
          LEFT JOIN admin_message_reads amr ON amr.message_id = am.id AND amr.pharmacy_id = ${pharmacyId}
          WHERE (am.target_type = 'all' OR (am.target_type = 'pharmacy' AND am.target_pharmacy_id = ${pharmacyId}))
            AND amr.id IS NULL
        ), 0)
        + COALESCE((
          SELECT count(*)::int FROM exchange_proposals
          WHERE status = 'completed'
            AND (pharmacy_a_id = ${pharmacyId} OR pharmacy_b_id = ${pharmacyId})
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
            AND (
              ${pharmacies.lastTimelineViewedAt} IS NULL
              OR created_at > ${pharmacies.lastTimelineViewedAt}
            )
        ), 0)
      `,
    })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId));

  return rows[0]?.total ?? 0;
}
