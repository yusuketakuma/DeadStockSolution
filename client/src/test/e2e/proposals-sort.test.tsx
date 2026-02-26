import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProposalsPage from '../../pages/ProposalsPage';
import { mockUser, renderWithProviders } from '../helpers';

function createFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/auth/me')) {
      return new Response(JSON.stringify(mockUser), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/exchange/proposals')) {
      return new Response(JSON.stringify({
        data: [
          {
            id: 1,
            pharmacyAId: 1,
            pharmacyBId: 2,
            pharmacyAName: 'テスト薬局',
            pharmacyBName: '相手薬局',
            status: 'proposed',
            totalValueA: 1000,
            totalValueB: 900,
            valueDifference: 100,
            proposedAt: '2026-03-01T00:00:00.000Z',
            priorityScore: 80,
            priorityReasons: ['あなたの承認待ち'],
            deadlineAt: '2026-03-02T00:00:00.000Z',
          },
        ],
        pagination: { page: 1, totalPages: 1, total: 1 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: `Unexpected route: ${url}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ProposalsPage sort mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses recent sort by default and can switch to priority sort', async () => {
    const fetchMock = createFetchMock();
    renderWithProviders(<ProposalsPage />);

    await waitFor(() => {
      expect(screen.getByText('マッチング一覧')).toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('sort=recent'))).toBe(true);

    await userEvent.selectOptions(screen.getByLabelText('並び順'), 'priority');

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('sort=priority'))).toBe(true);
    });
  });
});
