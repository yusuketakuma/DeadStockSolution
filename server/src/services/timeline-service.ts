/**
 * タイムラインサービス
 *
 * 全 aggregator を並列実行し、優先度付与・ページネーションを行うメイン API。
 */

import { and, eq, ne, sql } from 'drizzle-orm';
import {
  adminMessageReads,
  adminMessages,
  matchNotifications,
  notifications as notificationsTable,
  pharmacies,
  proposalComments,
} from '../db/schema';
import type {
  TimelineEvent,
  TimelinePriority,
  TimelineResponse,
  RawTimelineEvent,
  DbClient,
  TimelineCursor,
} from '../types/timeline';
import {
  fetchNotificationEvents,
  fetchMatchEvents,
  fetchProposalEvents,
  fetchCommentEvents,
  fetchFeedbackEvents,
  fetchUploadEvents,
  fetchAdminMessageEvents,
  fetchExchangeHistoryEvents,
  fetchExpiryRiskEvents,
} from './timeline-aggregators';
import { assignPriority } from './timeline-priority-engine';
import { countAllUnread } from './timeline-unread-counts';
import { invalidateDashboardUnreadCache } from './notification-service';
import { encodeCursor } from '../utils/cursor-pagination';

export interface TimelineQueryOptions {
  limit?: number;
  priority?: TimelinePriority;
  since?: string;
  cursor?: TimelineCursor | null;
}

// デフォルト値定数
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DIGEST_PER_TABLE_LIMIT = 100;
const CURSOR_FETCH_FACTOR = 4;
const CURSOR_PER_TABLE_LIMIT_MAX = 200;
const DEFAULT_FETCH_CONCURRENCY = 4;
const EXPLICIT_READ_SOURCES = new Set<RawTimelineEvent['source']>([
  'notification',
  'match',
  'comment',
  'admin_message',
]);

interface TimelineSortable {
  timestamp: string;
  id: string;
}

function timestampSortValue(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function eventIdForSort(id: string): number | null {
  const separator = id.lastIndexOf('_');
  if (separator < 0) return null;

  const suffix = id.slice(separator + 1);
  if (!/^\d+$/.test(suffix)) return null;

  const parsed = Number(suffix);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Timeline の並び順:
 * 1) timestamp DESC
 * 2) id DESC (同時刻時の決定論的 tie-break)
 */
function compareTimelineOrder(a: TimelineSortable, b: TimelineSortable): number {
  const left = timestampSortValue(a.timestamp);
  const right = timestampSortValue(b.timestamp);
  if (left !== right) return right - left;

  const aId = eventIdForSort(a.id);
  const bId = eventIdForSort(b.id);
  if (aId !== null && bId !== null) {
    return bId - aId;
  }

  return a.id.localeCompare(b.id);
}

function buildCursorFromEvent(event: TimelineSortable): TimelineCursor {
  return { timestamp: event.timestamp, id: event.id };
}

function filterEventsByCursor(events: TimelineEvent[], cursor: TimelineCursor | null): TimelineEvent[] {
  if (!cursor) {
    return events;
  }
  return events.filter((event) => compareTimelineOrder(event, cursor) > 0);
}

function buildNextCursor(events: TimelineEvent[], hasMore: boolean): string | null {
  if (!hasMore || events.length === 0) return null;
  const tail = events[events.length - 1];
  return encodeCursor(buildCursorFromEvent(tail));
}

async function getLastTimelineViewedAt(
  db: DbClient,
  pharmacyId: number,
): Promise<string | null> {
  const rows = await db
    .select({ lastTimelineViewedAt: pharmacies.lastTimelineViewedAt })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId));

  return rows[0]?.lastTimelineViewedAt ?? null;
}

function resolveReadState(raw: RawTimelineEvent, lastViewedAt: string | null): boolean {
  if (EXPLICIT_READ_SOURCES.has(raw.source)) {
    return raw.isRead;
  }

  if (!lastViewedAt) {
    return raw.isRead;
  }

  return timestampSortValue(raw.timestamp) <= timestampSortValue(lastViewedAt);
}

/**
 * RawTimelineEvent に優先度を付与して TimelineEvent に変換する。
 */
function enrichEvent(raw: RawTimelineEvent, now: Date, lastViewedAt: string | null): TimelineEvent {
  const isRead = resolveReadState(raw, lastViewedAt);
  return {
    ...raw,
    isRead,
    priority: assignPriority(raw, now),
  };
}

/**
 * 全 fetcher を並列実行して flatten されたイベント配列を返す。
 */
async function fetchAllEvents(
  db: DbClient,
  pharmacyId: number,
  since?: string,
  perTableLimit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const configuredConcurrency = Number.parseInt(process.env.TIMELINE_FETCH_CONCURRENCY ?? '', 10);
  const concurrency = Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
    ? configuredConcurrency
    : DEFAULT_FETCH_CONCURRENCY;

  const tasks = [
    () => fetchNotificationEvents(db, pharmacyId, since, perTableLimit, before),
    () => fetchMatchEvents(db, pharmacyId, since, perTableLimit, before),
    () => fetchProposalEvents(db, pharmacyId, since, perTableLimit, before),
    () => fetchCommentEvents(db, pharmacyId, since, perTableLimit, before),
    () => fetchFeedbackEvents(db, pharmacyId, since, perTableLimit, before),
    () => fetchUploadEvents(db, pharmacyId, since, perTableLimit, before),
    () => fetchAdminMessageEvents(db, pharmacyId, since, perTableLimit, before),
    () => fetchExchangeHistoryEvents(db, pharmacyId, since, perTableLimit, before),
    () => fetchExpiryRiskEvents(db, pharmacyId, perTableLimit, before),
  ];

  const results: RawTimelineEvent[][] = [];
  for (let index = 0; index < tasks.length; index += concurrency) {
    const batch = tasks.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map((task) => task()));
    results.push(...batchResults);
  }

  return results.flat();
}

/**
 * タイムライン取得（メイン関数）
 *
 * - 全9 fetcher を Promise.all() で並列実行
 * - 優先度付与、timestamp 降順ソート
 * - priority フィルタ（任意）
 * - cursor-based ページネーション
 */
export async function getTimeline(
  db: DbClient,
  pharmacyId: number,
  options?: TimelineQueryOptions,
): Promise<TimelineResponse> {
  const limit = Math.min(Math.max(1, options?.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const priority = options?.priority;
  const since = options?.since;
  const cursor = options?.cursor ?? null;
  const cursorBefore = cursor?.timestamp;
  const perTableLimit = Math.min(
    Math.max(limit * CURSOR_FETCH_FACTOR, limit + 1),
    CURSOR_PER_TABLE_LIMIT_MAX,
  );

  const now = new Date();
  const [rawEvents, lastViewedAt] = await Promise.all([
    fetchAllEvents(db, pharmacyId, since, perTableLimit, cursorBefore),
    getLastTimelineViewedAt(db, pharmacyId),
  ]);

  // 優先度付与
  let enriched = rawEvents.map((raw) => enrichEvent(raw, now, lastViewedAt));

  // 優先度フィルタ
  if (priority) {
    enriched = enriched.filter((e) => e.priority === priority);
  }

  // timestamp 降順ソート
  enriched.sort(compareTimelineOrder);

  const filteredForCursor = filterEventsByCursor(enriched, cursor);
  const total = enriched.length;

  const hasMore = filteredForCursor.length > limit;
  const events = filteredForCursor.slice(0, limit);

  return {
    events,
    total,
    hasMore,
    nextCursor: buildNextCursor(events, hasMore),
  };
}

/**
 * 未読数取得
 *
 * 全テーブルの COUNT を単一 SQL で集計する（1 round trip）。
 */
export async function getTimelineUnreadCount(
  db: DbClient,
  pharmacyId: number,
): Promise<number> {
  return countAllUnread(db, pharmacyId);
}

/**
 * 閲覧済みマーク
 *
 * pharmacies.lastTimelineViewedAt を現在時刻に更新する。
 */
export async function markTimelineViewed(
  db: DbClient,
  pharmacyId: number,
): Promise<void> {
  const viewedAt = new Date().toISOString();

  await db
    .update(notificationsTable)
    .set({ isRead: true, readAt: viewedAt })
    .where(and(
      eq(notificationsTable.pharmacyId, pharmacyId),
      eq(notificationsTable.isRead, false),
    ));

  await db
    .update(matchNotifications)
    .set({ isRead: true })
    .where(and(
      eq(matchNotifications.pharmacyId, pharmacyId),
      eq(matchNotifications.isRead, false),
    ));

  await db
    .update(proposalComments)
    .set({ readByRecipient: true })
    .where(and(
      eq(proposalComments.readByRecipient, false),
      eq(proposalComments.isDeleted, false),
      ne(proposalComments.authorPharmacyId, pharmacyId),
      sql`EXISTS (
        SELECT 1
        FROM exchange_proposals ep
        WHERE ep.id = ${proposalComments.proposalId}
          AND (ep.pharmacy_a_id = ${pharmacyId} OR ep.pharmacy_b_id = ${pharmacyId})
      )`,
    ));

  await db.execute(sql`
    INSERT INTO admin_message_reads (message_id, pharmacy_id)
    SELECT m.id, ${pharmacyId}
    FROM ${adminMessages} AS m
    LEFT JOIN ${adminMessageReads} AS reads
      ON reads.message_id = m.id AND reads.pharmacy_id = ${pharmacyId}
    WHERE (
      m.target_type = 'all'
      OR (m.target_type = 'pharmacy' AND m.target_pharmacy_id = ${pharmacyId})
    )
      AND reads.message_id IS NULL
    ON CONFLICT (message_id, pharmacy_id) DO NOTHING
  `);

  await db
    .update(pharmacies)
    .set({ lastTimelineViewedAt: viewedAt })
    .where(eq(pharmacies.id, pharmacyId));

  invalidateDashboardUnreadCache(pharmacyId);
}

/**
 * スマートダイジェスト
 *
 * Critical/High のイベントのみ抽出（最大5件）、timestamp 降順。
 */
export async function getSmartDigest(
  db: DbClient,
  pharmacyId: number,
): Promise<TimelineEvent[]> {
  const now = new Date();
  const [rawEvents, lastViewedAt] = await Promise.all([
    fetchAllEvents(db, pharmacyId, undefined, DIGEST_PER_TABLE_LIMIT),
    getLastTimelineViewedAt(db, pharmacyId),
  ]);

  const enriched = rawEvents.map((raw) => enrichEvent(raw, now, lastViewedAt));

  const highPriority = enriched.filter(
    (e) => e.priority === 'critical' || e.priority === 'high',
  );

  highPriority.sort(compareTimelineOrder);

  return highPriority.slice(0, 5);
}
