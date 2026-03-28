import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AuthProvider } from '../AuthContext';
import { setupFetchMock } from '../../test/helpers';
import { TimelineProvider, useTimeline } from '../TimelineContext';
import type { TimelineEvent } from '../../types/timeline';

function createEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'event-1',
    source: 'notification',
    type: 'match_update',
    title: 'New match',
    body: 'A new match is available',
    timestamp: new Date().toISOString(),
    priority: 'high',
    isRead: false,
    actionPath: '/matches/1',
    ...overrides,
  };
}

function createWrapper(options?: {
  disableBootstrap?: boolean;
  disableRealtimeRefresh?: boolean;
}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider
        initialUser={{
          id: 1,
          email: 'test@example.com',
          name: 'テスト',
          prefecture: '東京都',
          isAdmin: false,
        }}
        initialLoading={false}
        disableInitialRefresh
      >
        <TimelineProvider
          disableBootstrap={options?.disableBootstrap}
          disableRealtimeRefresh={options?.disableRealtimeRefresh}
        >
          {children}
        </TimelineProvider>
      </AuthProvider>
    );
  };
}

function setupTimelineFetchMock() {
  const firstEvent = createEvent({ id: 'event-1' });
  const secondEvent = createEvent({ id: 'event-2', type: 'new_comment', actionPath: '/comments/2' });

  return setupFetchMock({
    '/api/auth/me': {
      id: 1,
      email: 'test@example.com',
      name: 'テスト',
      prefecture: '東京都',
      isAdmin: false,
    },
    '/api/timeline/unread-count': { unreadCount: 5 },
    '/api/timeline/bootstrap': {
      timeline: {
        events: [firstEvent],
        total: 1,
        hasMore: false,
        nextCursor: null,
      },
      digest: { events: [firstEvent] },
      unreadCount: 5,
    },
    '/api/timeline?limit=20': {
      events: [firstEvent],
      total: 2,
      hasMore: true,
      nextCursor: 'cursor-1',
    },
    '/api/timeline?limit=20&cursor=cursor-1': {
      events: [secondEvent],
      total: 2,
      hasMore: false,
      nextCursor: null,
    },
    '/api/timeline/mark-viewed': {
      success: true,
      viewedAt: new Date().toISOString(),
    },
  });
}

describe('TimelineContext', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('TimelineProvider renders children', () => {
    setupTimelineFetchMock();
    const wrapper = createWrapper({ disableBootstrap: true, disableRealtimeRefresh: true });

    const { result } = renderHook(() => useTimeline(), { wrapper });

    expect(result.current).toBeTruthy();
  });

  it('useTimeline returns initial values', () => {
    setupTimelineFetchMock();
    const wrapper = createWrapper({ disableBootstrap: true, disableRealtimeRefresh: true });

    const { result } = renderHook(() => useTimeline(), { wrapper });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.events).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('fetchAll runs on mount when authenticated and updates unreadCount', async () => {
    const fetchMock = setupTimelineFetchMock();
    const wrapper = createWrapper();

    const { result } = renderHook(() => useTimeline(), { wrapper });

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(5);
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/timeline'))).toBe(true);
  });

  it('markViewed sets unreadCount to 0', async () => {
    setupTimelineFetchMock();
    const wrapper = createWrapper();

    const { result } = renderHook(() => useTimeline(), { wrapper });

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(5);
    });

    await act(async () => {
      await result.current.markViewed();
    });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.events.every((event) => event.isRead)).toBe(true);
    expect(result.current.digestEvents.every((event) => event.isRead)).toBe(true);
  });

  it('polling does not fetch when document is hidden', async () => {
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const fetchMock = setupTimelineFetchMock();
    const wrapper = createWrapper();

    const { result } = renderHook(() => useTimeline(), { wrapper });

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(5);
    });

    const timelineCallsBefore = fetchMock.mock.calls.filter(
      ([url]) => String(url).includes('/api/timeline'),
    ).length;

    const intervalCallback = setIntervalSpy.mock.calls[0]?.[0] as (() => void) | undefined;
    if (intervalCallback) {
      act(() => {
        intervalCallback();
      });
    }

    const timelineCallsAfter = fetchMock.mock.calls.filter(
      ([url]) => String(url).includes('/api/timeline'),
    ).length;

    expect(timelineCallsAfter).toBe(timelineCallsBefore);
    setIntervalSpy.mockRestore();
    visibilitySpy.mockRestore();
  });
});
