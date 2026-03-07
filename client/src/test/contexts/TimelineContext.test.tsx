import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TimelineProvider, useTimeline } from '../../contexts/TimelineContext';
import { timelineApi } from '../../api/timeline';
import React from 'react';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';

import type { TimelineEvent } from '../../types/timeline';

// モック
vi.mock('../../api/timeline', () => ({
  timelineApi: {
    getTimeline: vi.fn(),
    getBootstrap: vi.fn(),
    getUnreadCount: vi.fn(),
    markViewed: vi.fn(),
  },
}));

vi.mock('../../contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: vi.fn(() => ({ user: null })),
}));

const mockTimelineApi = vi.mocked(timelineApi);
const mockUseAuth = vi.mocked(useAuth);

// テスト用イベントデータを作成するヘルパー関数
function createMockEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: '1',
    source: 'notification',
    type: 'proposal_status_changed',
    title: 'テストイベント',
    body: 'テスト本文',
    timestamp: '2026-01-01T00:00:00Z',
    priority: overrides.priority || 'critical',
    isRead: false,
    ...overrides,
  };
}

// テスト用コンポーネント
function TestConsumer() {
  const { events, loading, unreadCount } = useTimeline();
  return (
    <div>
      <span data-testid="events">{events.length}</span>
      <span data-testid="loading">{loading.toString()}</span>
      <span data-testid="unreadCount">{unreadCount}</span>
    </div>
  );
}

function createMockUser() {
  return {
    id: 1,
    email: 'test@example.com',
    name: 'テスト薬局',
    prefecture: '東京都',
    isAdmin: false,
  };
}

function createMockAuthContext(user: ReturnType<typeof createMockUser> | null) {
  return {
    user,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  };
}

function renderTimelineContext(user: ReturnType<typeof createMockUser> | null = createMockUser()) {
  mockUseAuth.mockReturnValue(createMockAuthContext(user));
  return render(
    <AuthProvider>
      <TimelineProvider>
        <TestConsumer />
      </TimelineProvider>
    </AuthProvider>
  );
}

describe('TimelineContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineApi.getTimeline.mockReset();
    mockTimelineApi.getUnreadCount.mockReset();
    mockTimelineApi.getBootstrap.mockReset();
    mockTimelineApi.markViewed.mockReset();
    mockUseAuth.mockReturnValue(createMockAuthContext(createMockUser()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初期状態', () => {
    it('初期ローディング状態がtrueで始まる', async () => {
      mockTimelineApi.getBootstrap.mockImplementation(() => new Promise(() => {}));
      
      renderTimelineContext();
      
      expect(screen.getByTestId('loading').textContent).toBe('true');
    });

    it('イベントと未読数が設定される', async () => {
      mockTimelineApi.getBootstrap.mockResolvedValue({
        timeline: {
          events: [createMockEvent({ id: '1', priority: 'critical' })],
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
        digest: {
          events: [createMockEvent({ id: 'digest-1', priority: 'critical' })],
        },
        unreadCount: 3,
      });
      
      renderTimelineContext();
      
      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });
      
      await waitFor(() => {
        expect(screen.getByTestId('events').textContent).toBe('1');
      });
      
      expect(screen.getByTestId('unreadCount').textContent).toBe('3');
    });
  });

  describe('ユーザー未認証時', () => {
    it('ユーザーがnullの場合何も動作しない', async () => {
      renderTimelineContext(null);
      
      await waitFor(() => {
        expect(screen.getByTestId('events').textContent).toBe('0');
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });
    });
  });

  describe('useTimeline', () => {
    it('TimelineProvider外ではデフォルト値を返す', () => {
      render(<TestConsumer />);

      expect(screen.getByTestId('events').textContent).toBe('0');
      expect(screen.getByTestId('loading').textContent).toBe('false');
      expect(screen.getByTestId('unreadCount').textContent).toBe('0');
    });
  });
});
