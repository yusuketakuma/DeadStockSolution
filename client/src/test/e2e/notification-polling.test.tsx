/**
 * 双方ポーリング統合テスト (T061)
 *
 * NotificationContext は独自ポーリングを持たず、
 * TimelineContext の unreadCount を再利用することを検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { useNotifications } from '../../contexts/NotificationContext';
import { useTimeline } from '../../contexts/TimelineContext';
import { renderHookWithProviders } from '../helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/api/auth/me')) {
      return new Response(JSON.stringify({ id: 1, email: 'test@example.com', name: 'テスト', prefecture: '東京都', isAdmin: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // timeline/unread-count の応答
    if (url.includes('/api/timeline/unread-count')) {
      return new Response(JSON.stringify({ unreadCount: 5 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/timeline/bootstrap')) {
      return new Response(JSON.stringify({
        timeline: { events: [], total: 0, hasMore: false, nextCursor: null, limit: 20 },
        digest: { events: [] },
        unreadCount: 5,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('双方ポーリング統合', () => {
  it('/notifications/unread-count は呼ばれない', async () => {
    renderHookWithProviders(() => useNotifications());

    await act(async () => {
      await Promise.resolve();
    });

    const fetchMock = vi.mocked(fetch);
    const notificationCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/notifications/unread-count'),
    );
    expect(notificationCalls).toHaveLength(0);
  });

  it('60秒後にポーリングしても /notifications/unread-count は呼ばれない', async () => {
    renderHookWithProviders(() => useNotifications());

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    const fetchMock = vi.mocked(fetch);
    const notificationCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/notifications/unread-count'),
    );
    expect(notificationCalls).toHaveLength(0);
  });

  it('useNotifications().unreadCount と useTimeline().unreadCount が同一の値を返す', async () => {
    const { result: notifResult } = renderHookWithProviders(() => useNotifications());
    const { result: timelineResult } = renderHookWithProviders(() => useTimeline());

    await act(async () => {
      await Promise.resolve();
    });

    expect(notifResult.current.unreadCount).toBe(timelineResult.current.unreadCount);
  });
});
