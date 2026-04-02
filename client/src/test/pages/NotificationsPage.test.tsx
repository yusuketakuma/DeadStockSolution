import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import NotificationsPage from '../../pages/NotificationsPage';
import { mockUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a skeleton while the initial notices request is loading', () => {
    const pendingFetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', pendingFetch);

    renderWithProviders(<NotificationsPage />, { route: '/notifications', authUser: mockUser });

    expect(screen.getByLabelText('通知一覧を読み込み中')).toBeInTheDocument();
  });

  it('filters notices by unread state and renders the notification center link target', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/notifications?')) {
        return jsonResponse({
          notices: [
            {
              id: 'notification-1',
              type: 'status_update',
              title: '提案の確認が必要です',
              body: '提案 #55 を確認してください',
              actionPath: '/proposals/55',
              actionLabel: '詳細へ',
              createdAt: '2026-03-28T00:00:00.000Z',
              deadlineAt: '2026-03-28T12:00:00.000Z',
              unread: true,
              priority: 1,
            },
            {
              id: 'message-2',
              type: 'admin_message',
              title: '運営からのお知らせ',
              body: 'メンテナンスのご案内',
              actionPath: '/',
              actionLabel: '確認する',
              createdAt: '2026-03-27T00:00:00.000Z',
              deadlineAt: null,
              unread: false,
              priority: 4,
            },
          ],
          summary: { unreadMessages: 0, actionableRequests: 1, total: 2 },
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<NotificationsPage />, { route: '/notifications', authUser: mockUser });

    await waitFor(() => {
      expect(screen.getByText('通知センター')).toBeInTheDocument();
    });

    expect(screen.getAllByRole('link', { name: '通知設定' }).some((link) => link.getAttribute('href') === '/account')).toBe(true);
    expect(screen.getByRole('link', { name: 'マッチング' })).toHaveAttribute('href', '/matching');
    expect(screen.getByText('提案の確認が必要です')).toBeInTheDocument();
    expect(screen.getByText('運営からのお知らせ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'メッセージ' })).toHaveAttribute('href', '/messages');
    expect(screen.getByRole('link', { name: '要望一覧' })).toHaveAttribute('href', '/requests');
    expect(screen.getAllByRole('link', { name: 'アラート一覧' }).every((link) => link.getAttribute('href') === '/alerts')).toBe(true);
    expect(screen.getByRole('link', { name: 'ブックマーク' })).toHaveAttribute('href', '/bookmarks');
    expect(screen.getAllByRole('link', { name: '通知設定' }).some((link) => link.getAttribute('href') === '/account')).toBe(true);

    screen.getByLabelText('未読のみ').click();

    await waitFor(() => {
      expect(screen.queryByText('運営からのお知らせ')).not.toBeInTheDocument();
    });
  });

  it('falls back to dashboard for unsafe notification links', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/notifications?')) {
        return jsonResponse({
          notices: [
            {
              id: 'notification-unsafe',
              type: 'status_update',
              title: '危険なリンク通知',
              body: 'actionPath が不正です',
              actionPath: '//evil.example/phish',
              actionLabel: '開く',
              createdAt: '2026-03-28T00:00:00.000Z',
              deadlineAt: null,
              unread: true,
              priority: 2,
            },
          ],
          summary: { unreadMessages: 0, actionableRequests: 1, total: 1 },
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<NotificationsPage />, { route: '/notifications', authUser: mockUser });

    await waitFor(() => {
      expect(screen.getByText('危険なリンク通知')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: '開く' })).toHaveAttribute('href', '/');
  });

  it('uses the notice action label on mobile cards as well as desktop rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/notifications?')) {
        return jsonResponse({
          notices: [
            {
              id: 'notification-mobile-1',
              type: 'status_update',
              title: '提案の確認が必要です',
              body: '提案 #55 を確認してください',
              actionPath: '/proposals/55',
              actionLabel: '詳細へ',
              createdAt: '2026-03-28T00:00:00.000Z',
              deadlineAt: null,
              unread: true,
              priority: 1,
            },
          ],
          summary: { unreadMessages: 0, actionableRequests: 1, total: 1 },
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    renderWithProviders(<NotificationsPage />, { route: '/notifications', authUser: mockUser });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: '詳細へ' })).toHaveAttribute('href', '/proposals/55');
    });
  });

  it('shows a retry button when the initial load fails and reloads successfully', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: '通知の取得に失敗しました' }, 500))
      .mockResolvedValueOnce(jsonResponse({
        notices: [
          {
            id: 'notification-9',
            type: 'status_update',
            title: '再試行後の通知',
            body: '再読み込みで取得できました',
            actionPath: '/proposals/9',
            actionLabel: '詳細へ',
            createdAt: '2026-03-28T00:00:00.000Z',
            deadlineAt: null,
            unread: true,
            priority: 2,
          },
        ],
        summary: { unreadMessages: 0, actionableRequests: 0, total: 1 },
        pagination: { limit: 20, hasMore: false, nextCursor: null },
      }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<NotificationsPage />, { route: '/notifications', authUser: mockUser });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    await waitFor(() => {
      expect(screen.getByText('再試行後の通知')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('renders alert notices in the filter and actionable summary', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/notifications?')) {
        return jsonResponse({
          notices: [
            {
              id: 'alert-1',
              type: 'alert',
              title: '期限切迫アラート',
              body: '30日以内の在庫があります',
              actionPath: '/alerts',
              actionLabel: 'アラートを見る',
              createdAt: '2026-03-28T00:00:00.000Z',
              deadlineAt: null,
              unread: true,
              priority: 2,
            },
          ],
          summary: { unreadMessages: 0, actionableRequests: 1, total: 1 },
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<NotificationsPage />, { route: '/notifications', authUser: mockUser });

    await waitFor(() => {
      expect(screen.getByText('期限切迫アラート')).toBeInTheDocument();
    });

    expect(screen.getByRole('option', { name: 'アラート' })).toBeInTheDocument();
    const actionableLabel = screen.getAllByText('対応待ち').find((node) => node.classList.contains('small'));
    const actionableCard = actionableLabel?.closest('.card') ?? null;
    expect(actionableCard).not.toBeNull();
    expect(within(actionableCard as HTMLElement).getByText('1')).toBeInTheDocument();
  });

  it('hydrates filters from URL query params', async () => {
    const deadlineAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/notifications?')) {
        return jsonResponse({
          notices: [
            {
              id: 'alert-2',
              type: 'alert',
              title: '期限切迫アラート',
              body: '30日以内の在庫があります',
              actionPath: '/alerts',
              actionLabel: 'アラートを見る',
              createdAt: '2026-03-28T00:00:00.000Z',
              deadlineAt,
              unread: true,
              priority: 2,
            },
          ],
          summary: { unreadMessages: 0, actionableRequests: 1, total: 1 },
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<NotificationsPage />, { route: '/notifications?type=alert&unread=1&deadline=1', authUser: mockUser });

    await waitFor(() => {
      expect(screen.getByText('期限切迫アラート')).toBeInTheDocument();
    });

    expect(screen.getByRole('combobox', { name: '通知タイプ' })).toHaveValue('alert');
    expect(screen.getByRole('checkbox', { name: '未読のみ' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '期限切迫のみ' })).toBeChecked();
  });

  it('uses a context-matched empty-state action for filtered notifications', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/notifications?')) {
        return jsonResponse({
          notices: [],
          summary: { unreadMessages: 0, actionableRequests: 0, total: 0 },
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    renderWithProviders(<NotificationsPage />, {
      route: '/notifications?type=status_update',
      authUser: mockUser,
    });

    await waitFor(() => {
      expect(screen.getByText('表示できる通知がありません')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: '要望一覧を見る' })).toHaveAttribute('href', '/requests');
  });
});
