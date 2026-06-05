import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    const user = userEvent.setup();
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

    const relatedMenus = screen.getAllByRole('button', { name: '関連画面' });
    await user.click(relatedMenus[0]);
    expect(screen.getAllByRole('link', { name: '交換履歴を確認' }).some((link) => link.getAttribute('href') === '/exchange-history')).toBe(true);
    await user.click(relatedMenus[1]);
    expect(screen.getAllByRole('link', { name: 'メッセージを確認' }).some((link) => link.getAttribute('href') === '/messages')).toBe(true);
    await user.click(screen.getAllByRole('button', { name: '関連画面' })[2]);
    expect(screen.getAllByRole('link', { name: '通知を確認' }).some((link) => link.getAttribute('href') === '/notifications')).toBe(true);
  });

  it('requires an explicit modal confirmation before bulk accepting selected proposals', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/exchange/proposals/bulk-action')) {
        return jsonResponse({
          summary: { total: 1, success: 1, failed: 0 },
        });
      }
      if (url.includes('/api/exchange/proposals?page=1&sort=recent')) {
        return jsonResponse({
          data: [
            {
              id: 101,
              pharmacyAId: mockUser.id,
              pharmacyBId: 22,
              pharmacyAName: 'テスト薬局',
              pharmacyBName: '相手薬局A',
              status: 'proposed',
              totalValueA: 1200,
              totalValueB: 1100,
              valueDifference: 100,
              proposedAt: '2026-01-20T10:00:00Z',
              deadlineAt: '2026-01-25T10:00:00Z',
              priorityScore: 8,
              priorityReasons: ['期限切迫'],
            },
          ],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient();
    renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <ProposalsPage />
      </QueryClientProvider>,
      { route: '/proposals', authUser: mockUser },
    );

    await waitFor(() => {
      expect(screen.getByText('相手薬局A')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('相手薬局Aとの提案 #101 を一括対象に追加'));
    await user.click(screen.getByRole('button', { name: '一括承認' }));

    expect(screen.getByRole('dialog', { name: '提案の一括承認' })).toBeInTheDocument();
    expect(screen.getByText(/提案 #101: 相手薬局A/)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some((call) => typeof call[0] === 'string' && call[0].includes('/api/exchange/proposals/bulk-action')),
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: '一括承認する' }));

    await waitFor(() => {
      const bulkCall = fetchMock.mock.calls.find((call) => typeof call[0] === 'string' && call[0].includes('/api/exchange/proposals/bulk-action'));
      expect(bulkCall).toBeTruthy();
      expect(JSON.parse(String((bulkCall?.[1] as RequestInit | undefined)?.body))).toEqual({
        action: 'accept',
        ids: [101],
      });
    });
  });

  it('removes hidden proposals from bulk confirmation after filtering', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/exchange/proposals/bulk-action')) {
        return jsonResponse({
          summary: { total: 1, success: 1, failed: 0 },
        });
      }
      if (url.includes('/api/exchange/proposals?page=1&sort=recent')) {
        return jsonResponse({
          data: [
            {
              id: 101,
              pharmacyAId: mockUser.id,
              pharmacyBId: 22,
              pharmacyAName: 'テスト薬局',
              pharmacyBName: '相手薬局A',
              status: 'proposed',
              totalValueA: 1200,
              totalValueB: 1100,
              valueDifference: 100,
              proposedAt: '2026-01-20T10:00:00Z',
              deadlineAt: '2026-01-25T10:00:00Z',
            },
            {
              id: 202,
              pharmacyAId: mockUser.id,
              pharmacyBId: 33,
              pharmacyAName: 'テスト薬局',
              pharmacyBName: '相手薬局B',
              status: 'proposed',
              totalValueA: 2200,
              totalValueB: 2100,
              valueDifference: 100,
              proposedAt: '2026-01-21T10:00:00Z',
              deadlineAt: '2026-01-26T10:00:00Z',
            },
          ],
          pagination: { page: 1, totalPages: 1, total: 2 },
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient();
    renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <ProposalsPage />
      </QueryClientProvider>,
      { route: '/proposals', authUser: mockUser },
    );

    await waitFor(() => {
      expect(screen.getByText('相手薬局A')).toBeInTheDocument();
      expect(screen.getByText('相手薬局B')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('相手薬局Aとの提案 #101 を一括対象に追加'));
    await user.click(screen.getByLabelText('相手薬局Bとの提案 #202 を一括対象に追加'));
    await user.type(screen.getByPlaceholderText('薬局名・提案IDで検索'), '相手薬局A');

    await waitFor(() => {
      expect(screen.queryByText('相手薬局B')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '一括承認' }));

    expect(screen.getByRole('dialog', { name: '提案の一括承認' })).toBeInTheDocument();
    expect(screen.getByText(/提案 #101: 相手薬局A/)).toBeInTheDocument();
    expect(screen.queryByText(/提案 #202: 相手薬局B/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '一括承認する' }));

    await waitFor(() => {
      const bulkCall = fetchMock.mock.calls.find((call) => typeof call[0] === 'string' && call[0].includes('/api/exchange/proposals/bulk-action'));
      expect(bulkCall).toBeTruthy();
      expect(JSON.parse(String((bulkCall?.[1] as RequestInit | undefined)?.body))).toEqual({
        action: 'accept',
        ids: [101],
      });
    });
  });
});
