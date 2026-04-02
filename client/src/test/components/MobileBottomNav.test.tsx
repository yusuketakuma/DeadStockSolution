import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import MobileBottomNav from '../../components/layout/MobileBottomNav';
import { renderWithProviders, setupFetchMock, mockAdminUser, mockUser } from '../helpers';

// Mock TimelineContext unreadCount
vi.mock('../../contexts/TimelineContext', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../contexts/TimelineContext')>();
  return {
    ...original,
    useTimeline: vi.fn(() => ({
      unreadCount: 0,
      events: [],
      total: 0,
      hasMore: false,
      loading: false,
      error: '',
      digestEvents: [],
      digestLoading: false,
      selectedPriority: null,
      refreshTimeline: vi.fn(),
      refreshUnreadCount: vi.fn(),
      markViewed: vi.fn(),
      setSelectedPriority: vi.fn(),
      loadMore: vi.fn(),
    })),
  };
});

import { useTimeline } from '../../contexts/TimelineContext';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset useTimeline mock to default (unreadCount: 0)
  vi.mocked(useTimeline).mockReturnValue({
    unreadCount: 0,
    events: [],
    total: 0,
    hasMore: false,
    loading: false,
    error: '',
    digestEvents: [],
    digestLoading: false,
    selectedPriority: null,
    refreshTimeline: vi.fn() as unknown as () => Promise<void>,
    refreshUnreadCount: vi.fn() as unknown as () => Promise<void>,
    markViewed: vi.fn() as unknown as () => Promise<void>,
    setSelectedPriority: vi.fn(),
    loadMore: vi.fn() as unknown as () => Promise<void>,
  });
  setupFetchMock({
    '/api/auth/me': mockUser,
    '/api/timeline/bootstrap': { timeline: { events: [], total: 0, hasMore: false }, digest: { events: [] }, unreadCount: 0 },
    '/api/timeline/unread-count': { unreadCount: 0 },
  });
});

describe('MobileBottomNav', () => {
  it('renders user nav items', () => {
    renderWithProviders(<MobileBottomNav />, { route: '/' });

    expect(screen.getByText('ホーム')).toBeInTheDocument();
    expect(screen.getByText('マッチング')).toBeInTheDocument();
    expect(screen.getByText('提案')).toBeInTheDocument();
    expect(screen.getByText('メッセージ')).toBeInTheDocument();
    expect(screen.getByText('アラート')).toBeInTheDocument();
  });

  it('renders admin nav items for admin users', () => {
    renderWithProviders(<MobileBottomNav />, { route: '/admin', authUser: mockAdminUser });

    expect(screen.getByText('ホーム')).toBeInTheDocument();
    expect(screen.getByText('要望')).toBeInTheDocument();
    expect(screen.getByText('メッセージ')).toBeInTheDocument();
    expect(screen.getByText('マスター')).toBeInTheDocument();
    expect(screen.getByText('OpenClaw')).toBeInTheDocument();
    expect(screen.queryByText('マッチング')).not.toBeInTheDocument();
  });

  it('has mobile navigation role and aria-label', () => {
    renderWithProviders(<MobileBottomNav />, { route: '/' });

    const nav = screen.getByRole('navigation', { name: 'モバイルナビゲーション' });
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveClass('d-lg-none');
  });

  it('highlights active route for dashboard', () => {
    renderWithProviders(<MobileBottomNav />, { route: '/' });

    const dashLink = screen.getByText('ホーム').closest('a');
    expect(dashLink).toHaveClass('active');
  });

  it('highlights active route for matching', () => {
    renderWithProviders(<MobileBottomNav />, { route: '/matching' });

    const matchLink = screen.getByText('マッチング').closest('a');
    expect(matchLink).toHaveClass('active');
  });

  it('highlights active route for proposals', () => {
    renderWithProviders(<MobileBottomNav />, { route: '/proposals' });

    const propLink = screen.getByText('提案').closest('a');
    expect(propLink).toHaveClass('active');
  });

  it('keeps matching active on bookmarked candidates', () => {
    renderWithProviders(<MobileBottomNav />, { route: '/bookmarks' });

    const matchingLink = screen.getByText('マッチング').closest('a');
    expect(matchingLink).toHaveClass('active');
  });

  it('keeps proposals active on exchange history', () => {
    renderWithProviders(<MobileBottomNav />, { route: '/exchange-history' });

    const proposalLink = screen.getByText('提案').closest('a');
    expect(proposalLink).toHaveClass('active');
  });

  it('shows unread badge on alerts when count > 0', () => {
    vi.mocked(useTimeline).mockReturnValue({
      unreadCount: 5,
      events: [],
      total: 0,
      hasMore: false,
      loading: false,
      error: '',
      digestEvents: [],
      digestLoading: false,
      selectedPriority: null,
      refreshTimeline: vi.fn() as unknown as () => Promise<void>,
      refreshUnreadCount: vi.fn() as unknown as () => Promise<void>,
      markViewed: vi.fn() as unknown as () => Promise<void>,
      setSelectedPriority: vi.fn(),
      loadMore: vi.fn() as unknown as () => Promise<void>,
    });

    renderWithProviders(<MobileBottomNav />, { route: '/' });

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByLabelText('5件の未読')).toBeInTheDocument();
  });

  it('does not show badge when count is 0', () => {
    renderWithProviders(<MobileBottomNav />, { route: '/' });

    expect(screen.queryByLabelText(/件の未読/)).not.toBeInTheDocument();
  });

  it('truncates badge at 99+', () => {
    vi.mocked(useTimeline).mockReturnValue({
      unreadCount: 150,
      events: [],
      total: 0,
      hasMore: false,
      loading: false,
      error: '',
      digestEvents: [],
      digestLoading: false,
      selectedPriority: null,
      refreshTimeline: vi.fn() as unknown as () => Promise<void>,
      refreshUnreadCount: vi.fn() as unknown as () => Promise<void>,
      markViewed: vi.fn() as unknown as () => Promise<void>,
      setSelectedPriority: vi.fn(),
      loadMore: vi.fn() as unknown as () => Promise<void>,
    });

    renderWithProviders(<MobileBottomNav />, { route: '/' });

    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('does not render desktop sidebar items', () => {
    renderWithProviders(<MobileBottomNav />, { route: '/' });

    expect(screen.queryByText('アップロード')).not.toBeInTheDocument();
    expect(screen.queryByText('統計')).not.toBeInTheDocument();
  });
});
