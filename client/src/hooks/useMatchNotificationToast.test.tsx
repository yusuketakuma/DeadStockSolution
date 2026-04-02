import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMatchNotificationToast } from './useMatchNotificationToast';
import type { ReactNode } from 'react';
import type { TimelineEvent } from '../types/timeline';

// Mock contexts
const mockShowInfo = vi.fn();
let mockEvents: TimelineEvent[] = [];

vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({
    toasts: [],
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
    showInfo: mockShowInfo,
    removeToast: vi.fn(),
  }),
}));

vi.mock('../contexts/TimelineContext', () => ({
  useTimeline: () => ({
    events: mockEvents,
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

describe('useMatchNotificationToast', () => {
  beforeEach(() => {
    mockEvents = [];
    mockShowInfo.mockClear();
  });

  it('should not show toast on initial render', () => {
    mockEvents = [
      {
        id: 'match_1',
        source: 'match',
        type: 'match_update',
        title: '候補更新',
        body: '候補が増えました',
        timestamp: '2026-04-01T00:00:00.000Z',
        priority: 'high',
        isRead: false,
        actionPath: '/matching',
      },
    ];
    renderHook(() => useMatchNotificationToast(), { wrapper });
    expect(mockShowInfo).not.toHaveBeenCalled();
  });

  it('should show toast when a new unread match event arrives', () => {
    mockEvents = [];
    const { rerender } = renderHook(() => useMatchNotificationToast(), { wrapper });
    expect(mockShowInfo).not.toHaveBeenCalled();

    mockEvents = [
      {
        id: 'match_2',
        source: 'match',
        type: 'match_update',
        title: '候補更新',
        body: '候補が増えました',
        timestamp: '2026-04-01T01:00:00.000Z',
        priority: 'high',
        isRead: false,
        actionPath: '/matching',
      },
    ];
    rerender();
    expect(mockShowInfo).toHaveBeenCalledWith('新しいマッチング候補が見つかりました');
  });

  it('should not show toast when only non-match unread events increase', () => {
    mockEvents = [];
    const { rerender } = renderHook(() => useMatchNotificationToast(), { wrapper });
    mockShowInfo.mockClear();

    mockEvents = [
      {
        id: 'notification_9',
        source: 'notification',
        type: 'proposal_received',
        title: '提案受信',
        body: '提案が届いています',
        timestamp: '2026-04-01T02:00:00.000Z',
        priority: 'high',
        isRead: false,
        actionPath: '/proposals/9',
      },
    ];
    rerender();
    expect(mockShowInfo).not.toHaveBeenCalled();
  });

  it('should not show toast for mirrored notification events typed as match_update', () => {
    mockEvents = [];
    const { rerender } = renderHook(() => useMatchNotificationToast(), { wrapper });
    mockShowInfo.mockClear();

    mockEvents = [
      {
        id: 'notification_match_1',
        source: 'notification',
        type: 'match_update',
        title: '候補更新通知',
        body: '通知ミラーです',
        timestamp: '2026-04-01T02:30:00.000Z',
        priority: 'high',
        isRead: false,
        actionPath: '/matching',
      },
    ];
    rerender();

    expect(mockShowInfo).not.toHaveBeenCalled();
  });

  it('should show toast when a different unread match event replaces the previous one', () => {
    mockEvents = [
      {
        id: 'match_3',
        source: 'match',
        type: 'match_update',
        title: '候補更新',
        body: '候補が増えました',
        timestamp: '2026-04-01T03:00:00.000Z',
        priority: 'high',
        isRead: false,
        actionPath: '/matching',
      },
    ];
    const { rerender } = renderHook(() => useMatchNotificationToast(), { wrapper });
    mockShowInfo.mockClear();

    mockEvents = [
      {
        id: 'match_4',
        source: 'match',
        type: 'match_update',
        title: '候補更新',
        body: '候補がさらに増えました',
        timestamp: '2026-04-01T04:00:00.000Z',
        priority: 'high',
        isRead: false,
        actionPath: '/matching',
      },
    ];
    rerender();

    expect(mockShowInfo).toHaveBeenCalledWith('新しいマッチング候補が見つかりました');
  });

  it('should not show toast when an older unread match event is appended later', () => {
    mockEvents = [
      {
        id: 'match_latest',
        source: 'match',
        type: 'match_update',
        title: '最新候補',
        body: '新しい候補です',
        timestamp: '2026-04-01T05:00:00.000Z',
        priority: 'high',
        isRead: false,
        actionPath: '/matching',
      },
    ];
    const { rerender } = renderHook(() => useMatchNotificationToast(), { wrapper });
    mockShowInfo.mockClear();

    mockEvents = [
      ...mockEvents,
      {
        id: 'match_older',
        source: 'match',
        type: 'match_update',
        title: '過去候補',
        body: '過去の未読候補です',
        timestamp: '2026-04-01T04:00:00.000Z',
        priority: 'high',
        isRead: false,
        actionPath: '/matching',
      },
    ];
    rerender();

    expect(mockShowInfo).not.toHaveBeenCalled();
  });
});
