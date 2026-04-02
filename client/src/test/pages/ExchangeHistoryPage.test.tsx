import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

  it('renders header shortcuts to proposals and messages', async () => {
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
          data: [],
          pagination: { page: 1, totalPages: 1, total: 0 },
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
      expect(screen.getByText('交換履歴')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'マッチング一覧' })).toHaveAttribute('href', '/proposals');
    expect(screen.getByRole('link', { name: 'メッセージ' })).toHaveAttribute('href', '/messages');
  });
});
