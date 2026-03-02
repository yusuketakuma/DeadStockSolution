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

vi.mock('../services/timeline-unread-counts', () => ({
  countAllUnread: vi.fn(),
  countUnreadNotifications: vi.fn(),
  countUnreadMatchNotifications: vi.fn(),
  countUnreadComments: vi.fn(),
  countUnreadAdminMessages: vi.fn(),
  countUnreadProposals: vi.fn(),
  countUnreadFeedback: vi.fn(),
  countUnreadExpiryRisk: vi.fn(),
  countUnreadUploads: vi.fn(),
  countUnreadExchangeHistory: vi.fn(),
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
import {
  countAllUnread,
  countUnreadNotifications,
  countUnreadMatchNotifications,
  countUnreadComments,
  countUnreadAdminMessages,
  countUnreadProposals,
  countUnreadFeedback,
  countUnreadExpiryRisk,
  countUnreadUploads,
  countUnreadExchangeHistory,
} from '../services/timeline-unread-counts';
import { decodeCursor } from '../utils/cursor-pagination';

// --- ヘルパー ---

function makeRawEvent(
  partial: Partial<RawTimelineEvent> & { id: string; timestamp: string },
): RawTimelineEvent {
  return {
    source: 'notification',
    type: 'request_update',
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

/** 全 COUNT 関数を 0 を返すようにリセットする */
function resetAllCounters() {
  vi.mocked(countAllUnread).mockResolvedValue(0);
  vi.mocked(countUnreadNotifications).mockResolvedValue(0);
  vi.mocked(countUnreadMatchNotifications).mockResolvedValue(0);
  vi.mocked(countUnreadComments).mockResolvedValue(0);
  vi.mocked(countUnreadAdminMessages).mockResolvedValue(0);
  vi.mocked(countUnreadProposals).mockResolvedValue(0);
  vi.mocked(countUnreadFeedback).mockResolvedValue(0);
  vi.mocked(countUnreadExpiryRisk).mockResolvedValue(0);
  vi.mocked(countUnreadUploads).mockResolvedValue(0);
  vi.mocked(countUnreadExchangeHistory).mockResolvedValue(0);
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
    resetAllCounters();
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

  it('getTimeline: timestamp が不正な値を含んでも有効日時を優先して降順ソートする', async () => {
    const validOld = makeRawEvent({ id: 'notification_old', timestamp: '2026-01-01T10:00:00.000Z', source: 'notification' });
    const validNew = makeRawEvent({ id: 'notification_new', timestamp: '2026-01-03T10:00:00.000Z', source: 'notification' });
    const invalid = makeRawEvent({ id: 'notification_invalid', timestamp: 'not-a-date', source: 'notification' });

    vi.mocked(fetchNotificationEvents).mockResolvedValue([invalid, validOld, validNew]);
    mockAssignPriority('low');

    const db = makeMockDb() as MockDb;
    const result = await getTimeline(db, pharmacyId);

    expect(result.events[0].id).toBe('notification_new');
    expect(result.events[1].id).toBe('notification_old');
    expect(result.events[2].id).toBe('notification_invalid');
  });

  // 2. getTimeline: cursor ページネーションが正しく動作する
  it('getTimeline: cursor を指定すると次ページを正しく返す', async () => {
    const events: RawTimelineEvent[] = Array.from({ length: 5 }, (_, i) =>
      makeRawEvent({
        id: `notification_${i + 1}`,
        timestamp: new Date(2026, 0, i + 1).toISOString(),
        source: 'notification',
      }),
    );
    vi.mocked(fetchNotificationEvents).mockResolvedValue(events);
    mockAssignPriority('low');

    const db = makeMockDb() as MockDb;
    const firstPage = await getTimeline(db, pharmacyId, { limit: 2 });
    expect(firstPage.events).toHaveLength(2);
    expect(firstPage.events[0].id).toBe('notification_5');
    expect(firstPage.events[1].id).toBe('notification_4');
    expect(firstPage.hasMore).toBe(true);
    expect(typeof firstPage.nextCursor).toBe('string');

    const cursorPayload = decodeCursor<{ timestamp: string; id: string }>(firstPage.nextCursor);
    expect(cursorPayload).not.toBeNull();
    const secondPage = await getTimeline(db, pharmacyId, {
      limit: 2,
      cursor: cursorPayload,
    });

    expect(secondPage.total).toBe(5);
    expect(secondPage.events).toHaveLength(2);
    expect(secondPage.events[0].id).toBe('notification_3');
    expect(secondPage.events[1].id).toBe('notification_2');
    expect(secondPage.hasMore).toBe(true);
  });

  it('getTimeline: 同一 timestamp で ID が可変長の数値でも正しく id 降順になる', async () => {
    const events: RawTimelineEvent[] = [
      makeRawEvent({
        id: 'notification_10',
        timestamp: '2026-01-01T00:00:00.000Z',
        source: 'notification',
      }),
      makeRawEvent({
        id: 'notification_2',
        timestamp: '2026-01-01T00:00:00.000Z',
        source: 'notification',
      }),
      makeRawEvent({
        id: 'notification_1',
        timestamp: '2026-01-01T00:00:00.000Z',
        source: 'notification',
      }),
    ];
    vi.mocked(fetchNotificationEvents).mockResolvedValue(events);
    mockAssignPriority('low');

    const db = makeMockDb() as MockDb;
    const firstPage = await getTimeline(db, pharmacyId, { limit: 2 });
    expect(firstPage.events).toHaveLength(2);
    expect(firstPage.events[0].id).toBe('notification_10');
    expect(firstPage.events[1].id).toBe('notification_2');
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const cursorPayload = decodeCursor<{ timestamp: string; id: string }>(firstPage.nextCursor);
    expect(cursorPayload).not.toBeNull();
    const secondPage = await getTimeline(db, pharmacyId, {
      limit: 2,
      cursor: cursorPayload,
    });

    expect(secondPage.events).toHaveLength(1);
    expect(secondPage.events[0].id).toBe('notification_1');
    expect(secondPage.hasMore).toBe(false);
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

  // 5. getTimelineUnreadCount: countAllUnread の結果を返す
  it('getTimelineUnreadCount: countAllUnread の合計を返す', async () => {
    vi.mocked(countAllUnread).mockResolvedValue(7);

    const db = makeMockDb() as MockDb;
    const count = await getTimelineUnreadCount(db, pharmacyId);

    expect(count).toBe(7);
    expect(vi.mocked(countAllUnread)).toHaveBeenCalledWith(db, pharmacyId);
  });

  // 6. getTimelineUnreadCount: countAllUnread の結果をそのまま返す
  it('getTimelineUnreadCount: countAllUnread の結果をそのまま返す', async () => {
    vi.mocked(countAllUnread).mockResolvedValue(3);

    const db = makeMockDb(null) as MockDb;
    const count = await getTimelineUnreadCount(db, pharmacyId);

    expect(count).toBe(3);
    expect(vi.mocked(countAllUnread)).toHaveBeenCalledWith(db, pharmacyId);
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

  // 9. getTimeline: priority フィルタあり → total/hasMore が正確な全件ベースになる
  it('getTimeline: priority フィルタあり時に total が正確な件数を返す', async () => {
    // critical 3件、low 2件 の合計5件を fetcher から返す
    const criticalEvents = [
      makeRawEvent({ id: 'expiry_1', timestamp: '2026-01-05T00:00:00.000Z', source: 'expiry_risk' }),
      makeRawEvent({ id: 'expiry_2', timestamp: '2026-01-04T00:00:00.000Z', source: 'expiry_risk' }),
      makeRawEvent({ id: 'expiry_3', timestamp: '2026-01-03T00:00:00.000Z', source: 'expiry_risk' }),
    ];
    const lowEvents = [
      makeRawEvent({ id: 'upload_1', timestamp: '2026-01-02T00:00:00.000Z', source: 'upload' }),
      makeRawEvent({ id: 'upload_2', timestamp: '2026-01-01T00:00:00.000Z', source: 'upload' }),
    ];

    vi.mocked(fetchExpiryRiskEvents).mockResolvedValue(criticalEvents);
    vi.mocked(fetchUploadEvents).mockResolvedValue(lowEvents);

    vi.mocked(assignPriority).mockImplementation((event) => {
      if (event.source === 'expiry_risk') return 'critical';
      return 'low';
    });

    const db = makeMockDb() as MockDb;
    // limit=2 でフィルタあり：critical は3件あるので hasMore=true になるべき
    const result = await getTimeline(db, pharmacyId, { priority: 'critical', limit: 2 });

    expect(result.total).toBe(3);      // priority フィルタ後の正確な総数
    expect(result.events).toHaveLength(2);
    expect(result.hasMore).toBe(true); // 全3件のうち2件表示、残り1件
  });

  it('getTimeline: priority フィルタなし時に全件ベースで total/hasMore を返す', async () => {
    const events: RawTimelineEvent[] = Array.from({ length: 5 }, (_, i) =>
      makeRawEvent({
        id: `notification_${i + 1}`,
        timestamp: new Date(2026, 0, i + 1).toISOString(),
        source: 'notification',
      }),
    );
    vi.mocked(fetchNotificationEvents).mockResolvedValue(events);
    mockAssignPriority('medium');

    const db = makeMockDb() as MockDb;
    const result = await getTimeline(db, pharmacyId, { limit: 3 });

    expect(vi.mocked(fetchNotificationEvents)).toHaveBeenCalledWith(db, pharmacyId, undefined, 12, undefined);
    expect(result.total).toBe(5);
    expect(result.events).toHaveLength(3);
    expect(result.hasMore).toBe(true);
  });
});
