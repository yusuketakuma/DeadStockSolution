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
  };
}

describe('timeline-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(assignPriority).mockImplementation((input) => {
      if (input.type === 'proposal_confirmed') return 'critical';
      if (input.type === 'proposal_proposed') return 'high';
      return 'low';
    });
  });

  it('merges all aggregator events, sorts desc, and paginates', async () => {
    vi.mocked(fetchNotificationEvents).mockResolvedValue([
      event('n1', '2026-01-02T00:00:00.000Z'),
      event('n2', '2026-01-01T00:00:00.000Z'),
    ]);
    setOtherAggregatorResults([]);

    const result = await getTimeline({} as never, 1, { limit: 1 });

    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.id).toBe('n1');
    expect(result.events[0]?.priority).toBe('low');
  });

  it('supports cursor-based pagination', async () => {
    vi.mocked(fetchNotificationEvents).mockResolvedValue([
      event('n1', '2026-01-03T00:00:00.000Z'),
      event('n2', '2026-01-02T00:00:00.000Z'),
      event('n3', '2026-01-01T00:00:00.000Z'),
    ]);
    setOtherAggregatorResults([]);

    const result = await getTimeline({} as never, 1, {
      limit: 2,
      cursor: { timestamp: '2026-01-03T00:00:00.000Z', id: 'n1' },
    });

    expect(result.events.map((row: TimelineEvent) => row.id)).toEqual(['n2', 'n3']);
    expect(result.total).toBe(3);
  });

  it('filters by requested priority', async () => {
    vi.mocked(fetchNotificationEvents).mockResolvedValue([
      { ...event('c1', '2026-01-02T00:00:00.000Z'), type: 'proposal_confirmed' as const },
      { ...event('h1', '2026-01-01T00:00:00.000Z'), type: 'proposal_proposed' as const },
      event('l1', '2025-12-31T00:00:00.000Z'),
    ]);
    setOtherAggregatorResults([]);

    const result = await getTimeline({} as never, 1, { limit: 10, priority: 'high' });

    expect(result.events.map((row: TimelineEvent) => row.id)).toEqual(['h1']);
    expect(result.total).toBe(1);
  });

  it('returns empty timeline state when all aggregators are empty', async () => {
    vi.mocked(fetchNotificationEvents).mockResolvedValue([]);
    setOtherAggregatorResults([]);

    const result = await getTimeline({} as never, 1, { limit: 20 });

    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('counts all events as unread when lastTimelineViewedAt is null', async () => {
    const db = createDbForViewedAt(null);
    vi.mocked(fetchNotificationEvents).mockResolvedValue([
      event('n1', '2026-01-02T00:00:00.000Z'),
      event('n2', '2026-01-01T00:00:00.000Z'),
    ]);
    setOtherAggregatorResults([]);

    const unread = await getTimelineUnreadCount(db as never, 1);

    expect(unread).toBe(2);
  });

  it('counts only events newer than lastTimelineViewedAt', async () => {
    const db = createDbForViewedAt('2026-01-01T12:00:00.000Z');
    vi.mocked(fetchNotificationEvents).mockResolvedValue([
      event('n1', '2026-01-02T00:00:00.000Z'),
      event('n2', '2026-01-01T00:00:00.000Z'),
    ]);
    setOtherAggregatorResults([]);

    const unread = await getTimelineUnreadCount(db as never, 1);

    expect(unread).toBe(1);
  });

  it('updates lastTimelineViewedAt and returns viewedAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T08:00:00.000Z'));
    const db = createDbForViewedAt(null);

    const result = await markTimelineViewed(db as never, 1);

    expect(result).toEqual({ viewedAt: '2026-01-10T08:00:00.000Z' });
    expect(db.update).toHaveBeenCalledTimes(1);
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

    const digest = await getSmartDigest({} as never, 1);

    expect(digest).toHaveLength(5);
    expect(digest.every((row: TimelineEvent) => row.priority === 'critical' || row.priority === 'high')).toBe(true);
    expect(digest.map((row: TimelineEvent) => row.id)).toEqual(['a', 'b', 'd', 'e', 'f']);
  });
});
