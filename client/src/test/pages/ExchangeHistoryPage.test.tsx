import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExchangeHistoryPage from '../../pages/ExchangeHistoryPage';
import { mockUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ExchangeHistoryPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders header shortcuts and print links for completed exchanges', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return jsonResponse({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return jsonResponse({ unreadCount: 0 });
      }
      if (url.includes('/api/exchange/history?page=1')) {
        return jsonResponse({
          data: [
            {
              id: 9,
              proposalId: 31,
              pharmacyAId: 1,
              pharmacyBId: 2,
              pharmacyAName: 'テスト薬局',
              pharmacyBName: '相手薬局',
              totalValue: 15000,
              completedAt: '2026-04-01T00:00:00.000Z',
            },
          ],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient();
    renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <ExchangeHistoryPage />
      </QueryClientProvider>,
      { route: '/exchange-history', authUser: mockUser },
    );

    await waitFor(() => {
      expect(screen.getAllByText('相手薬局').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByRole('link', { name: '提案一覧を確認' }).some((link) => link.getAttribute('href') === '/proposals')).toBe(true);
    await user.click(screen.getAllByRole('button', { name: '関連画面' })[0]);
    expect(screen.getAllByRole('link', { name: 'メッセージを確認' }).some((link) => link.getAttribute('href') === '/messages')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'その他' }));
    expect(screen.getByRole('link', { name: '印刷' })).toHaveAttribute('href', '/proposals/31/print');
    expect(screen.getAllByRole('link', { name: '通知を確認' }).some((link) => link.getAttribute('href') === '/notifications')).toBe(true);
    await user.click(screen.getAllByRole('button', { name: '関連画面' })[2]);
    expect(screen.getAllByRole('link', { name: 'ブックマークを確認' }).some((link) => link.getAttribute('href') === '/bookmarks')).toBe(true);
  });
});
