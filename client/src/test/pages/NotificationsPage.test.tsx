import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
});
