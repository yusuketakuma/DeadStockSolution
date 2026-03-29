import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

    expect(screen.getByText('提案の確認が必要です')).toBeInTheDocument();
    expect(screen.getByText('運営からのお知らせ')).toBeInTheDocument();

    screen.getByLabelText('未読のみ').click();

    await waitFor(() => {
      expect(screen.queryByText('運営からのお知らせ')).not.toBeInTheDocument();
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
});
