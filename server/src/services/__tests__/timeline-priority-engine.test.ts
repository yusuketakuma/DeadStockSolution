import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RawTimelineEvent, TimelineSource, TimelineEventType } from '../../types/timeline';
import { assignPriority } from '../timeline-priority-engine';

function raw(
  source: TimelineSource,
  type: TimelineEventType,
  overrides: Partial<RawTimelineEvent> = {},
): RawTimelineEvent {
  return {
    id: `${source}_1`,
    source,
    type,
    title: 'test',
    body: 'test',
    timestamp: '2026-03-01T11:00:00.000Z',
    isRead: false,
    ...overrides,
  };
}

describe('timeline-priority-engine assignPriority', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns critical for confirmed proposal without completedAt', () => {
    expect(assignPriority(raw('proposal', 'proposal_confirmed', { metadata: {} }))).toBe('critical');
  });

  it('returns critical for confirmed proposal with completedAt as null', () => {
    expect(assignPriority(raw('proposal', 'proposal_confirmed', { metadata: { completedAt: null } }))).toBe('critical');
  });

  it('returns critical for expiry risk events', () => {
    expect(assignPriority(raw('expiry_risk', 'near_expiry'))).toBe('critical');
  });

  it('returns high for unread recipient comments older than 24 hours', () => {
    expect(
      assignPriority(raw('comment', 'new_comment', {
        isRead: false,
        timestamp: '2026-02-28T11:59:59.000Z',
      })),
    ).toBe('high');
  });

  it('returns high for inbound proposed proposals', () => {
    expect(assignPriority(raw('proposal', 'proposal_proposed', { metadata: { isInbound: true } }))).toBe('high');
  });

  it('returns high for unread match events', () => {
    expect(assignPriority(raw('match', 'match_update', { isRead: false }))).toBe('high');
  });

  it('returns medium for proposal status changed notifications', () => {
    expect(assignPriority(raw('notification', 'proposal_status_changed'))).toBe('medium');
  });

  it('returns medium for new comment notifications', () => {
    expect(assignPriority(raw('notification', 'new_comment'))).toBe('medium');
  });

  it('returns medium for upload activity events', () => {
    expect(assignPriority(raw('upload', 'upload_dead_stock'))).toBe('medium');
  });

  it('returns low for admin messages', () => {
    expect(assignPriority(raw('admin_message', 'admin_message'))).toBe('low');
  });

  it('returns low for exchange history events', () => {
    expect(assignPriority(raw('exchange_history', 'exchange_completed'))).toBe('low');
  });

  it('returns low by default for unmatched events', () => {
    expect(assignPriority(raw('feedback', 'exchange_feedback'))).toBe('low');
  });
});
