/**
 * タイムラインサービス
 *
 * 全 aggregator を並列実行し、優先度付与・ページネーションを行うメイン API。
 */

import { eq } from 'drizzle-orm';
import { pharmacies } from '../db/schema';
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

function buildNextCursor(events: TimelineEvent[], hasMore: boolean): string | null {
  if (!hasMore || events.length === 0) return null;
  const tail = events[events.length - 1];
  return encodeCursor(buildCursorFromEvent(tail));
}

/**
 * RawTimelineEvent に優先度を付与して TimelineEvent に変換する。
 */
function enrichEvent(raw: RawTimelineEvent, now: Date): TimelineEvent {
  return {
    ...raw,
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
  const results = await Promise.all([
    fetchNotificationEvents(db, pharmacyId, since, perTableLimit, before),
    fetchMatchEvents(db, pharmacyId, since, perTableLimit, before),
    fetchProposalEvents(db, pharmacyId, since, perTableLimit, before),
    fetchCommentEvents(db, pharmacyId, since, perTableLimit, before),
    fetchFeedbackEvents(db, pharmacyId, since, perTableLimit, before),
    fetchUploadEvents(db, pharmacyId, since, perTableLimit, before),
    fetchAdminMessageEvents(db, pharmacyId, since, perTableLimit, before),
    fetchExchangeHistoryEvents(db, pharmacyId, since, perTableLimit, before),
    fetchExpiryRiskEvents(db, pharmacyId, perTableLimit, before),
  ]);

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
  const rawEvents = await fetchAllEvents(db, pharmacyId, since, perTableLimit, cursorBefore);

  // 優先度付与
  let enriched = rawEvents.map((raw) => enrichEvent(raw, now));

  // 優先度フィルタ
  if (priority) {
    enriched = enriched.filter((e) => e.priority === priority);
  }

  // timestamp 降順ソート
  enriched.sort(compareTimelineOrder);

  const filteredForCursor = cursor
    ? enriched.filter((event) => compareTimelineOrder(event, cursor) > 0)
    : enriched;
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
  await db
    .update(pharmacies)
    .set({ lastTimelineViewedAt: new Date().toISOString() })
    .where(eq(pharmacies.id, pharmacyId));
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
  const rawEvents = await fetchAllEvents(db, pharmacyId, undefined, DIGEST_PER_TABLE_LIMIT);

  const enriched = rawEvents.map((raw) => enrichEvent(raw, now));

  const highPriority = enriched.filter(
    (e) => e.priority === 'critical' || e.priority === 'high',
  );

  highPriority.sort(compareTimelineOrder);

  return highPriority.slice(0, 5);
}
