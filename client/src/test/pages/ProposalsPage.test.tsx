import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProposalsPage from '../../pages/ProposalsPage';
import { mockUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ProposalsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps nearby navigation visible when the list is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/exchange/proposals?page=1&sort=recent')) {
        return jsonResponse({
          data: [],
          pagination: { page: 1, totalPages: 1, total: 0 },
        });
      }
      return jsonResponse({});
    }));

    const queryClient = new QueryClient();
    renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <ProposalsPage />
      </QueryClientProvider>,
      { route: '/proposals', authUser: mockUser },
    );

    await waitFor(() => {
      expect(screen.getByText('マッチング一覧')).toBeInTheDocument();
    });

    expect(screen.getAllByRole('link', { name: '交換履歴' }).some((link) => link.getAttribute('href') === '/exchange-history')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'メッセージ' }).some((link) => link.getAttribute('href') === '/messages')).toBe(true);
    expect(screen.getAllByRole('link', { name: '通知センター' }).some((link) => link.getAttribute('href') === '/notifications')).toBe(true);
  });
});
