/**
 * タイムラインサービス
 *
 * 全 aggregator を並列実行し、優先度付与・ページネーションを行うメイン API。
 */

import { eq } from 'drizzle-orm';
import { pharmacies } from '../db/schema';
import type { TimelineEvent, TimelinePriority, TimelineResponse, RawTimelineEvent } from '../types/timeline';
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

// aggregators.ts と同じ緩い型定義。テスト時のモック注入を可能にする。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = { select: (...args: any[]) => any; update: (...args: any[]) => any };

export interface TimelineQueryOptions {
  page?: number;
  limit?: number;
  priority?: TimelinePriority;
  since?: string;
}

// デフォルト値定数
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

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
): Promise<RawTimelineEvent[]> {
  const results = await Promise.all([
    fetchNotificationEvents(db, pharmacyId, since),
    fetchMatchEvents(db, pharmacyId, since),
    fetchProposalEvents(db, pharmacyId, since),
    fetchCommentEvents(db, pharmacyId, since),
    fetchFeedbackEvents(db, pharmacyId, since),
    fetchUploadEvents(db, pharmacyId, since),
    fetchAdminMessageEvents(db, pharmacyId, since),
    fetchExchangeHistoryEvents(db, pharmacyId, since),
    fetchExpiryRiskEvents(db, pharmacyId),
  ]);

  return results.flat();
}

/**
 * タイムライン取得（メイン関数）
 *
 * - 全9 fetcher を Promise.all() で並列実行
 * - 優先度付与、timestamp 降順ソート
 * - priority フィルタ（任意）
 * - offset-based ページネーション
 */
export async function getTimeline(
  db: DbClient,
  pharmacyId: number,
  options?: TimelineQueryOptions,
): Promise<TimelineResponse> {
  const page = Math.max(1, options?.page ?? DEFAULT_PAGE);
  const limit = Math.min(Math.max(1, options?.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const offset = (page - 1) * limit;
  const priority = options?.priority;
  const since = options?.since;

  const now = new Date();
  const rawEvents = await fetchAllEvents(db, pharmacyId, since);

  // 優先度付与
  let enriched = rawEvents.map((raw) => enrichEvent(raw, now));

  // 優先度フィルタ
  if (priority) {
    enriched = enriched.filter((e) => e.priority === priority);
  }

  // timestamp 降順ソート
  enriched.sort((a, b) => {
    const tA = new Date(a.timestamp).getTime();
    const tB = new Date(b.timestamp).getTime();
    return tB - tA;
  });

  const total = enriched.length;
  const events = enriched.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  return { events, total, hasMore };
}

/**
 * 未読数取得
 *
 * - pharmacies.lastTimelineViewedAt を取得
 * - lastTimelineViewedAt より新しい OR isRead=false のイベントを数える
 */
export async function getTimelineUnreadCount(
  db: DbClient,
  pharmacyId: number,
): Promise<number> {
  const rows = await db
    .select({ lastTimelineViewedAt: pharmacies.lastTimelineViewedAt })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId));

  const lastViewed = rows[0]?.lastTimelineViewedAt ?? null;

  const rawEvents = await fetchAllEvents(db, pharmacyId);

  let unreadCount = 0;
  for (const event of rawEvents) {
    if (!event.isRead) {
      unreadCount++;
    } else if (lastViewed !== null && event.timestamp > lastViewed) {
      unreadCount++;
    }
  }

  return unreadCount;
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
  const rawEvents = await fetchAllEvents(db, pharmacyId);

  const enriched = rawEvents.map((raw) => enrichEvent(raw, now));

  const highPriority = enriched.filter(
    (e) => e.priority === 'critical' || e.priority === 'high',
  );

  highPriority.sort((a, b) => {
    const tA = new Date(a.timestamp).getTime();
    const tB = new Date(b.timestamp).getTime();
    return tB - tA;
  });

  return highPriority.slice(0, 5);
}
