import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RawTimelineEvent, TimelineEvent, TimelinePriority } from '../../types/timeline';
import {
  fetchAdminMessageEvents,
  fetchCommentEvents,
  fetchExchangeHistoryEvents,
  fetchExpiryRiskEvents,
  fetchFeedbackEvents,
  fetchMatchEvents,
  fetchNotificationEvents,
  fetchProposalEvents,
  fetchUploadEvents,
} from '../timeline-aggregators';
import { assignPriority } from '../timeline-priority-engine';
import {
  getSmartDigest,
  getTimeline,
  getTimelineUnreadCount,
  markTimelineViewed,
} from '../timeline-service';
import { countAllUnread } from '../timeline-unread-counts';
import { invalidateDashboardUnreadCache } from '../notification-service';

vi.mock('../timeline-aggregators', () => ({
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

vi.mock('../timeline-priority-engine', () => ({
  assignPriority: vi.fn(),
}));

vi.mock('../timeline-unread-counts', () => ({
  countAllUnread: vi.fn(),
}));

vi.mock('../notification-service', () => ({
  invalidateDashboardUnreadCache: vi.fn(),
}));

function event(id: string, timestamp: string): RawTimelineEvent {
  return {
    id,
    source: 'notification',
    type: 'proposal_status_changed',
    title: id,
    body: id,
    timestamp,
    isRead: false,
    actionPath: '/',
  };
}

function setOtherAggregatorResults(result: RawTimelineEvent[]) {
  vi.mocked(fetchMatchEvents).mockResolvedValue(result);
  vi.mocked(fetchProposalEvents).mockResolvedValue(result);
  vi.mocked(fetchCommentEvents).mockResolvedValue(result);
  vi.mocked(fetchFeedbackEvents).mockResolvedValue(result);
  vi.mocked(fetchUploadEvents).mockResolvedValue(result);
  vi.mocked(fetchAdminMessageEvents).mockResolvedValue(result);
  vi.mocked(fetchExchangeHistoryEvents).mockResolvedValue(result);
  vi.mocked(fetchExpiryRiskEvents).mockResolvedValue(result);
}

function createDbForViewedAt(lastTimelineViewedAt: string | null) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ lastTimelineViewedAt }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ id: 10 }]),
      })),
    })),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };
}

describe('timeline-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(countAllUnread).mockResolvedValue(0);

    vi.mocked(assignPriority).mockImplementation((input) => {
      if (input.type === 'proposal_confirmed') return 'critical';
      if (input.type === 'proposal_proposed') return 'high';
      return 'low';
    });
  });

  it('merges all aggregator events, sorts desc, and paginates', async () => {
    const db = createDbForViewedAt(null);
    vi.mocked(fetchNotificationEvents).mockResolvedValue([
      event('n1', '2026-01-02T00:00:00.000Z'),
      event('n2', '2026-01-01T00:00:00.000Z'),
    ]);
    setOtherAggregatorResults([]);

    const result = await getTimeline(db as never, 1, { limit: 1 });

    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.id).toBe('n1');
    expect(result.events[0]?.priority).toBe('low');
  });

  it('supports cursor-based pagination', async () => {
    const db = createDbForViewedAt(null);
    vi.mocked(fetchNotificationEvents).mockResolvedValue([
      event('n1', '2026-01-03T00:00:00.000Z'),
      event('n2', '2026-01-02T00:00:00.000Z'),
      event('n3', '2026-01-01T00:00:00.000Z'),
    ]);
    setOtherAggregatorResults([]);

    const result = await getTimeline(db as never, 1, {
      limit: 2,
      cursor: { timestamp: '2026-01-03T00:00:00.000Z', id: 'n1' },
    });

    expect(result.events.map((row: TimelineEvent) => row.id)).toEqual(['n2', 'n3']);
    expect(result.total).toBe(3);
  });

  it('filters by requested priority', async () => {
    const db = createDbForViewedAt(null);
    vi.mocked(fetchNotificationEvents).mockResolvedValue([
      { ...event('c1', '2026-01-02T00:00:00.000Z'), type: 'proposal_confirmed' as const },
      { ...event('h1', '2026-01-01T00:00:00.000Z'), type: 'proposal_proposed' as const },
      event('l1', '2025-12-31T00:00:00.000Z'),
    ]);
    setOtherAggregatorResults([]);

    const result = await getTimeline(db as never, 1, { limit: 10, priority: 'high' });

    expect(result.events.map((row: TimelineEvent) => row.id)).toEqual(['h1']);
    expect(result.total).toBe(1);
  });

  it('returns empty timeline state when all aggregators are empty', async () => {
    const db = createDbForViewedAt(null);
    vi.mocked(fetchNotificationEvents).mockResolvedValue([]);
    setOtherAggregatorResults([]);

    const result = await getTimeline(db as never, 1, { limit: 20 });

    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('derives read state for time-based timeline events from lastTimelineViewedAt', async () => {
    const db = createDbForViewedAt('2026-01-01T12:00:00.000Z');
    vi.mocked(fetchProposalEvents).mockResolvedValue([
      {
        id: 'proposal_old',
        source: 'proposal',
        type: 'proposal_proposed',
        title: 'old',
        body: 'old',
        timestamp: '2026-01-01T00:00:00.000Z',
        isRead: false,
        actionPath: '/proposals/1',
      },
      {
        id: 'proposal_new',
        source: 'proposal',
        type: 'proposal_proposed',
        title: 'new',
        body: 'new',
        timestamp: '2026-01-02T00:00:00.000Z',
        isRead: false,
        actionPath: '/proposals/2',
      },
    ]);
    setOtherAggregatorResults([]);
    vi.mocked(fetchNotificationEvents).mockResolvedValue([]);

    const result = await getTimeline(db as never, 1, { limit: 10 });

    expect(result.events.find((row) => row.id === 'proposal_new')?.isRead).toBe(false);
    expect(result.events.find((row) => row.id === 'proposal_old')?.isRead).toBe(true);
  });

  it('preserves source default isRead when lastTimelineViewedAt is null', async () => {
    const db = createDbForViewedAt(null);
    vi.mocked(fetchUploadEvents).mockResolvedValue([
      {
        id: 'upload_1',
        source: 'upload',
        type: 'upload_dead_stock',
        title: 'upload',
        body: 'upload',
        timestamp: '2026-01-03T00:00:00.000Z',
        isRead: true,
        actionPath: '/upload',
      },
    ]);
    vi.mocked(fetchExchangeHistoryEvents).mockResolvedValue([
      {
        id: 'exchange_history_1',
        source: 'exchange_history',
        type: 'exchange_completed',
        title: 'history',
        body: 'history',
        timestamp: '2026-01-02T00:00:00.000Z',
        isRead: true,
        actionPath: '/proposals/1',
      },
    ]);
    vi.mocked(fetchFeedbackEvents).mockResolvedValue([
      {
        id: 'feedback_1',
        source: 'feedback',
        type: 'exchange_feedback',
        title: 'feedback',
        body: 'feedback',
        timestamp: '2026-01-01T00:00:00.000Z',
        isRead: false,
        actionPath: '/proposals/2',
      },
    ]);
    vi.mocked(fetchNotificationEvents).mockResolvedValue([]);
    vi.mocked(fetchMatchEvents).mockResolvedValue([]);
    vi.mocked(fetchProposalEvents).mockResolvedValue([]);
    vi.mocked(fetchCommentEvents).mockResolvedValue([]);
    vi.mocked(fetchAdminMessageEvents).mockResolvedValue([]);
    vi.mocked(fetchExpiryRiskEvents).mockResolvedValue([]);

    const result = await getTimeline(db as never, 1, { limit: 10 });

    expect(result.events.find((row) => row.id === 'upload_1')?.isRead).toBe(true);
    expect(result.events.find((row) => row.id === 'exchange_history_1')?.isRead).toBe(true);
    expect(result.events.find((row) => row.id === 'feedback_1')?.isRead).toBe(false);
  });

  it('counts all events as unread when lastTimelineViewedAt is null', async () => {
    const db = createDbForViewedAt(null);
    vi.mocked(countAllUnread).mockResolvedValue(2);

    const unread = await getTimelineUnreadCount(db as never, 1);

    expect(unread).toBe(2);
  });

  it('counts only events newer than lastTimelineViewedAt', async () => {
    const db = createDbForViewedAt('2026-01-01T12:00:00.000Z');
    vi.mocked(countAllUnread).mockResolvedValue(1);

    const unread = await getTimelineUnreadCount(db as never, 1);

    expect(unread).toBe(1);
  });

  it('marks row-level unread items as read and updates lastTimelineViewedAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T08:00:00.000Z'));
    const db = createDbForViewedAt(null);

    const result = await markTimelineViewed(db as never, 1);

    expect(result).toBeUndefined();
    expect(db.update).toHaveBeenCalledTimes(4);
    expect(db.execute).toHaveBeenCalledTimes(1);
    const updateSetCalls = db.update.mock.results.map((result) => result.value.set.mock.calls[0]?.[0]);
    expect(updateSetCalls).toContainEqual({ isRead: true });
    expect(vi.mocked(invalidateDashboardUnreadCache)).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });

  it('returns smart digest with only critical/high and max 5 items', async () => {
    const prioritiesById: Record<string, TimelinePriority> = {
      a: 'critical',
      b: 'high',
      c: 'low',
      d: 'high',
      e: 'critical',
      f: 'high',
      g: 'critical',
    };
    vi.mocked(assignPriority).mockImplementation((input) => prioritiesById[(input as { id?: string }).id ?? ''] ?? 'low');

    vi.mocked(fetchNotificationEvents).mockResolvedValue([
      event('a', '2026-01-08T00:00:00.000Z'),
      event('b', '2026-01-07T00:00:00.000Z'),
      event('c', '2026-01-06T00:00:00.000Z'),
      event('d', '2026-01-05T00:00:00.000Z'),
      event('e', '2026-01-04T00:00:00.000Z'),
      event('f', '2026-01-03T00:00:00.000Z'),
      event('g', '2026-01-02T00:00:00.000Z'),
    ]);
    setOtherAggregatorResults([]);

    const db = createDbForViewedAt(null);
    const digest = await getSmartDigest(db as never, 1);

    expect(digest).toHaveLength(5);
    expect(digest.every((row: TimelineEvent) => row.priority === 'critical' || row.priority === 'high')).toBe(true);
    expect(digest.map((row: TimelineEvent) => row.id)).toEqual(['a', 'b', 'd', 'e', 'f']);
  });
});
