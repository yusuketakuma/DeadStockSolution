import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MatchingPage from '../../pages/MatchingPage';
import { mockUser, renderWithProviders } from '../helpers';

const membershipSummaryResponse = {
  groups: [],
  groupPharmacyIds: [],
};

const candidate = {
  pharmacyId: 5,
  pharmacyName: '候補薬局',
  pharmacyPhone: '03-1111-1111',
  pharmacyFax: '03-1111-2222',
  distance: 3,
  itemsFromA: [
    {
      deadStockItemId: 1,
      drugCode: 'YJ-0001',
      drugName: 'アスピリン 100mg',
      quantity: 10,
      unit: '錠',
      yakkaUnitPrice: 100,
      yakkaValue: 1000,
      expirationDate: '2027-01-01',
      matchScore: 0.9,
    },
  ],
  itemsFromB: [
    {
      deadStockItemId: 2,
      drugCode: 'YJ-0002',
      drugName: 'テスト薬B',
      quantity: 5,
      unit: '錠',
      yakkaUnitPrice: 200,
      yakkaValue: 1000,
      expirationDate: '2027-06-01',
      matchScore: 0.8,
    },
  ],
  totalValueA: 10000,
  totalValueB: 10000,
  valueDifference: 0,
  score: 85.5,
  matchRate: 0.9,
  isFavorite: false,
} as const;

describe('MatchingPage bookmarks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows quick links to bookmarks and proposals in the page header', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/upload/status')) {
        return new Response(JSON.stringify({ deadStockUploaded: true, usedMedicationUploaded: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/groups/membership-summary')) {
        return new Response(JSON.stringify(membershipSummaryResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/match-bookmarks?page=1&limit=100')) {
        return new Response(JSON.stringify({ items: [], page: 1, limit: 100 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return new Response(JSON.stringify({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return new Response(JSON.stringify({ unreadCount: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MatchingPage />);

    await waitFor(() => {
      expect(screen.getByText('マッチング')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    expect(screen.getByRole('link', { name: 'ブックマークを確認' })).toHaveAttribute('href', '/bookmarks');
    await user.click(screen.getByRole('button', { name: '関連画面' }));
    expect(screen.getByRole('link', { name: '提案一覧を確認' })).toHaveAttribute('href', '/proposals');
  });

  it('marks an item as bookmarked using the API drugCode contract', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/upload/status')) {
        return new Response(JSON.stringify({ deadStockUploaded: true, usedMedicationUploaded: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/groups/membership-summary')) {
        return new Response(JSON.stringify(membershipSummaryResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return new Response(JSON.stringify({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return new Response(JSON.stringify({ unreadCount: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/match-bookmarks?page=1&limit=100')) {
        return new Response(JSON.stringify({
          items: [
            {
              id: 77,
              pharmacyId: mockUser.id,
              candidatePharmacyId: candidate.pharmacyId,
              candidatePharmacyName: candidate.pharmacyName,
              drugCode: 'YJ-0001',
              memo: null,
              createdAt: '2026-03-29T00:00:00.000Z',
            },
          ],
          page: 1,
          limit: 100,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/exchange/find')) {
        return new Response(JSON.stringify({ candidates: [candidate] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/match-bookmarks') && method === 'POST') {
        return new Response(JSON.stringify({ id: 88 }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderWithProviders(<MatchingPage />);

    await user.click(await screen.findByRole('button', { name: /マッチングを実行/ }));
    await user.click(await screen.findByRole('button', { name: /候補薬局/ }));

    await user.click(screen.getAllByRole('button', { name: 'その他' })[0]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'アスピリン 100mg をブックマーク解除' })).toBeInTheDocument();
    });
  });

  it('creates a bookmark with drugCode instead of drugName', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/upload/status')) {
        return new Response(JSON.stringify({ deadStockUploaded: true, usedMedicationUploaded: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/groups/membership-summary')) {
        return new Response(JSON.stringify(membershipSummaryResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return new Response(JSON.stringify({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return new Response(JSON.stringify({ unreadCount: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/match-bookmarks?page=1&limit=100')) {
        return new Response(JSON.stringify({ items: [], page: 1, limit: 100 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/exchange/find')) {
        return new Response(JSON.stringify({ candidates: [candidate] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/match-bookmarks') && method === 'POST') {
        expect(init?.body).toBeDefined();
        expect(JSON.parse(String(init?.body))).toEqual({
          candidatePharmacyId: candidate.pharmacyId,
          drugCode: 'YJ-0001',
        });
        return new Response(JSON.stringify({ id: 88 }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderWithProviders(<MatchingPage />);

    await user.click(await screen.findByRole('button', { name: /マッチングを実行/ }));
    await user.click(await screen.findByRole('button', { name: /候補薬局/ }));
    await user.click(screen.getAllByRole('button', { name: 'その他' })[0]);
    await user.click(await screen.findByRole('button', { name: 'アスピリン 100mg をブックマーク' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/match-bookmarks'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
