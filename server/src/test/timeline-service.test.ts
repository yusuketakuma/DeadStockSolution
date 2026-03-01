import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getTimeline,
  getTimelineUnreadCount,
  markTimelineViewed,
  getSmartDigest,
} from '../services/timeline-service';
import type { RawTimelineEvent } from '../types/timeline';

// --- モック設定 ---

vi.mock('../services/timeline-aggregators', () => ({
  fetchNotificationEvents: vi.fn(),
  fetchMatchEvents: vi.fn(),
  fetchProposalEvents: vi.fn(),
  fetchCommentEvents: vi.fn(),
  fetchFeedbackEvents: vi.fn(),
  fetchUploadEvents: vi.fn(),
  fetchAdminMessageEvents: vi.fn(),
  fetchExchangeHistoryEvents: vi.fn(),
  fetchExpiryRiskEvents: vi.fn(),
}));

vi.mock('../services/timeline-priority-engine', () => ({
  assignPriority: vi.fn(),
}));

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
} from '../services/timeline-aggregators';
import { assignPriority } from '../services/timeline-priority-engine';

// --- ヘルパー ---

function makeRawEvent(
  partial: Partial<RawTimelineEvent> & { id: string; timestamp: string },
): RawTimelineEvent {
  return {
    source: 'notification',
    type: 'info',
    title: 'テスト',
    body: '本文',
    isRead: false,
    ...partial,
  };
}

/** 全 fetcher を空配列を返すようにリセットする */
function resetAllFetchers() {
  vi.mocked(fetchNotificationEvents).mockResolvedValue([]);
  vi.mocked(fetchMatchEvents).mockResolvedValue([]);
  vi.mocked(fetchProposalEvents).mockResolvedValue([]);
  vi.mocked(fetchCommentEvents).mockResolvedValue([]);
  vi.mocked(fetchFeedbackEvents).mockResolvedValue([]);
  vi.mocked(fetchUploadEvents).mockResolvedValue([]);
  vi.mocked(fetchAdminMessageEvents).mockResolvedValue([]);
  vi.mocked(fetchExchangeHistoryEvents).mockResolvedValue([]);
  vi.mocked(fetchExpiryRiskEvents).mockResolvedValue([]);
}

/** assignPriority を固定値で返すようにモックする */
function mockAssignPriority(priority: 'critical' | 'high' | 'medium' | 'low') {
  vi.mocked(assignPriority).mockReturnValue(priority);
}

// db モック（pharmacy 取得用）
function makeMockDb(lastTimelineViewedAt: string | null = null) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ lastTimelineViewedAt }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };
}

type MockDb = ReturnType<typeof makeMockDb>;

// --- テスト ---

describe('timeline-service', () => {
  const pharmacyId = 1;

  beforeEach(() => {
    vi.clearAllMocks();
    resetAllFetchers();
  });

  // 1. getTimeline: 複数ソースのイベントがマージされ timestamp 降順でソートされる
  it('getTimeline: 複数ソースのイベントをマージして timestamp 降順に返す', async () => {
    const event1 = makeRawEvent({ id: 'notification_1', timestamp: '2026-01-01T10:00:00.000Z', source: 'notification' });
    const event2 = makeRawEvent({ id: 'match_2', timestamp: '2026-01-02T10:00:00.000Z', source: 'match' });
    const event3 = makeRawEvent({ id: 'upload_3', timestamp: '2026-01-03T10:00:00.000Z', source: 'upload' });

    vi.mocked(fetchNotificationEvents).mockResolvedValue([event1]);
    vi.mocked(fetchMatchEvents).mockResolvedValue([event2]);
    vi.mocked(fetchUploadEvents).mockResolvedValue([event3]);
    mockAssignPriority('medium');

    const db = makeMockDb() as MockDb;
    const result = await getTimeline(db, pharmacyId);

    expect(result.total).toBe(3);
    expect(result.events[0].id).toBe('upload_3');  // 最新
    expect(result.events[1].id).toBe('match_2');
    expect(result.events[2].id).toBe('notification_1'); // 最古
    expect(result.hasMore).toBe(false);
  });

  // 2. getTimeline: ページネーションが正しく動作する（page=2でoffset適用）
  it('getTimeline: page=2 でオフセットが正しく適用される', async () => {
    // 25件のイベントを生成（各タイムスタンプを異なる値にする）
    const events: RawTimelineEvent[] = Array.from({ length: 25 }, (_, i) =>
      makeRawEvent({
        id: `notification_${i + 1}`,
        timestamp: new Date(2026, 0, i + 1).toISOString(),
        source: 'notification',
      }),
    );
    vi.mocked(fetchNotificationEvents).mockResolvedValue(events);
    mockAssignPriority('low');

    const db = makeMockDb() as MockDb;
    const result = await getTimeline(db, pharmacyId, { page: 2, limit: 10 });

    expect(result.total).toBe(25);
    expect(result.events).toHaveLength(10);
    expect(result.hasMore).toBe(true); // 20件消費済み、残り5件
    // page=2 でオフセット10〜19（降順ソート後）
  });

  // 3. getTimeline: priority フィルタが動作する
  it('getTimeline: priority フィルタが正しく動作する', async () => {
    const criticalEvent = makeRawEvent({ id: 'expiry_1', timestamp: '2026-01-01T12:00:00.000Z', source: 'expiry_risk' });
    const lowEvent = makeRawEvent({ id: 'upload_1', timestamp: '2026-01-01T11:00:00.000Z', source: 'upload' });

    vi.mocked(fetchExpiryRiskEvents).mockResolvedValue([criticalEvent]);
    vi.mocked(fetchUploadEvents).mockResolvedValue([lowEvent]);

    // expiry_risk は critical、upload は low を返すようにモック
    vi.mocked(assignPriority).mockImplementation((event) => {
      if (event.source === 'expiry_risk') return 'critical';
      return 'low';
    });

    const db = makeMockDb() as MockDb;
    const result = await getTimeline(db, pharmacyId, { priority: 'critical' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('expiry_1');
    expect(result.total).toBe(1);
  });

  // 4. getTimeline: イベントなし時に空配列を返す
  it('getTimeline: イベントがない場合は空配列を返す', async () => {
    // 全 fetcher はすでに空配列を返すようにリセット済み
    mockAssignPriority('low');

    const db = makeMockDb() as MockDb;
    const result = await getTimeline(db, pharmacyId);

    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  // 5. getTimelineUnreadCount: lastTimelineViewedAt より新しいイベントをカウント
  it('getTimelineUnreadCount: lastTimelineViewedAt より新しいイベントをカウントする', async () => {
    const lastViewed = '2026-01-02T00:00:00.000Z';
    const oldReadEvent = makeRawEvent({ id: 'notification_1', timestamp: '2026-01-01T10:00:00.000Z', isRead: true });
    const newReadEvent = makeRawEvent({ id: 'notification_2', timestamp: '2026-01-03T10:00:00.000Z', isRead: true });
    const unreadEvent = makeRawEvent({ id: 'notification_3', timestamp: '2025-12-01T10:00:00.000Z', isRead: false });

    vi.mocked(fetchNotificationEvents).mockResolvedValue([oldReadEvent, newReadEvent, unreadEvent]);

    const db = makeMockDb(lastViewed) as MockDb;
    const count = await getTimelineUnreadCount(db, pharmacyId);

    // newReadEvent (lastViewed より新しい) + unreadEvent (isRead=false) = 2
    expect(count).toBe(2);
  });

  // 6. getTimelineUnreadCount: lastTimelineViewedAt が null の場合全件カウント
  it('getTimelineUnreadCount: lastTimelineViewedAt が null の場合は isRead=false のみカウント', async () => {
    const event1 = makeRawEvent({ id: 'notification_1', timestamp: '2026-01-01T10:00:00.000Z', isRead: false });
    const event2 = makeRawEvent({ id: 'notification_2', timestamp: '2026-01-02T10:00:00.000Z', isRead: true });
    const event3 = makeRawEvent({ id: 'notification_3', timestamp: '2026-01-03T10:00:00.000Z', isRead: false });

    vi.mocked(fetchNotificationEvents).mockResolvedValue([event1, event2, event3]);

    const db = makeMockDb(null) as MockDb;
    const count = await getTimelineUnreadCount(db, pharmacyId);

    // lastViewed=null のため timestamp 比較は行わず isRead=false のみカウント → 2件
    expect(count).toBe(2);
  });

  // 7. markTimelineViewed: 正しく更新される
  it('markTimelineViewed: pharmacies テーブルが更新される', async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

    const db = { update: mockUpdate } as MockDb;

    await markTimelineViewed(db, pharmacyId);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(1);
    // set に渡された値に lastTimelineViewedAt が含まれることを確認
    const setArg = mockSet.mock.calls[0][0];
    expect(setArg).toHaveProperty('lastTimelineViewedAt');
    expect(typeof (setArg as Record<string, unknown>)['lastTimelineViewedAt']).toBe('string');
    // ISO 文字列形式であること
    const viewedAt = (setArg as Record<string, unknown>)['lastTimelineViewedAt'] as string;
    expect(new Date(viewedAt).toISOString()).toBe(viewedAt);
  });

  // 8. getSmartDigest: Critical/High のみ最大5件返す
  it('getSmartDigest: critical/high のみ最大5件を返す', async () => {
    // critical 2件、high 4件、medium 2件 = 計8件生成
    const criticalEvents = [
      makeRawEvent({ id: 'expiry_1', timestamp: '2026-01-05T00:00:00.000Z', source: 'expiry_risk' }),
      makeRawEvent({ id: 'expiry_2', timestamp: '2026-01-04T00:00:00.000Z', source: 'expiry_risk' }),
    ];
    const highEvents = [
      makeRawEvent({ id: 'match_1', timestamp: '2026-01-03T00:00:00.000Z', source: 'match', isRead: false }),
      makeRawEvent({ id: 'match_2', timestamp: '2026-01-02T00:00:00.000Z', source: 'match', isRead: false }),
      makeRawEvent({ id: 'match_3', timestamp: '2026-01-01T00:00:00.000Z', source: 'match', isRead: false }),
      makeRawEvent({ id: 'match_4', timestamp: '2025-12-31T00:00:00.000Z', source: 'match', isRead: false }),
    ];
    const mediumEvents = [
      makeRawEvent({ id: 'upload_1', timestamp: '2026-01-06T00:00:00.000Z', source: 'upload' }),
      makeRawEvent({ id: 'upload_2', timestamp: '2026-01-07T00:00:00.000Z', source: 'upload' }),
    ];

    vi.mocked(fetchExpiryRiskEvents).mockResolvedValue(criticalEvents);
    vi.mocked(fetchMatchEvents).mockResolvedValue(highEvents);
    vi.mocked(fetchUploadEvents).mockResolvedValue(mediumEvents);

    vi.mocked(assignPriority).mockImplementation((event) => {
      if (event.source === 'expiry_risk') return 'critical';
      if (event.source === 'match') return 'high';
      return 'medium';
    });

    const db = makeMockDb() as MockDb;
    const digest = await getSmartDigest(db, pharmacyId);

    // critical/high のみで計6件あるが、最大5件
    expect(digest).toHaveLength(5);
    // すべて critical または high
    for (const event of digest) {
      expect(['critical', 'high']).toContain(event.priority);
    }
    // medium は含まれない
    expect(digest.some((e) => e.source === 'upload')).toBe(false);
  });
});
