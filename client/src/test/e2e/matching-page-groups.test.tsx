import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MatchingPage from '../../pages/MatchingPage';
import { renderWithProviders, mockUser, setupFetchMock } from '../helpers';
import type { GroupMembershipSummaryResponse } from '../../../../server/src/types/group';

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const membershipSummaryResponse: GroupMembershipSummaryResponse = {
  groups: [
    { id: 10, name: '東京グループ', memberPharmacyIds: [1, 5] },
  ],
  groupPharmacyIds: [1, 5],
};

const matchCandidates = [
  {
    pharmacyId: 5,
    pharmacyName: 'グループ内薬局',
    pharmacyPhone: '03-1111-1111',
    pharmacyFax: '03-1111-2222',
    distance: 3,
    itemsFromA: [{ deadStockItemId: 1, drugCode: 'ASP-100', drugName: 'アスピリン 100mg', quantity: 10, unit: '錠', yakkaUnitPrice: 100, yakkaValue: 1000, expirationDate: '2027-01-01', matchScore: 0.9 }],
    itemsFromB: [{ deadStockItemId: 2, drugCode: 'TEST-B', drugName: 'テスト薬B', quantity: 5, unit: '錠', yakkaUnitPrice: 200, yakkaValue: 1000, expirationDate: '2027-06-01', matchScore: 0.8 }],
    totalValueA: 10000,
    totalValueB: 10000,
    valueDifference: 0,
    score: 85.5,
    matchRate: 0.9,
    isFavorite: false,
  },
  {
    pharmacyId: 99,
    pharmacyName: 'グループ外薬局',
    pharmacyPhone: '06-2222-2222',
    pharmacyFax: '06-2222-3333',
    distance: 10,
    itemsFromA: [{ deadStockItemId: 3, drugCode: 'TEST-C', drugName: 'テスト薬C', quantity: 20, unit: '錠', yakkaUnitPrice: 50, yakkaValue: 1000, expirationDate: '2027-03-01', matchScore: 0.7 }],
    itemsFromB: [{ deadStockItemId: 4, drugCode: 'TEST-D', drugName: 'テスト薬D', quantity: 15, unit: '錠', yakkaUnitPrice: 70, yakkaValue: 1050, expirationDate: '2027-09-01', matchScore: 0.6 }],
    totalValueA: 10000,
    totalValueB: 10005,
    valueDifference: 5,
    score: 70.0,
    matchRate: 0.7,
    isFavorite: false,
  },
];

function mockMatchingFetch(options: { includeGroups?: boolean } = {}) {
  const { includeGroups = true } = options;

  const routes: Record<string, unknown> = {
    '/api/auth/me': mockUser,
    '/api/upload/status': { deadStockUploaded: true, usedMedicationUploaded: true },
    '/api/exchange/find': { candidates: matchCandidates },
    '/api/timeline/bootstrap': { timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null }, digest: { events: [] }, unreadCount: 0 },
    '/api/timeline/unread-count': { unreadCount: 0 },
  };

  if (includeGroups) {
    routes['/api/groups/membership-summary'] = membershipSummaryResponse;
  } else {
    routes['/api/groups/membership-summary'] = { groups: [], groupPharmacyIds: [] };
  }

  return setupFetchMock(routes);
}

describe('MatchingPage — Group Badge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
  });

  it('shows "グループ" badge for matching candidates in same group', async () => {
    mockMatchingFetch();
    const user = userEvent.setup();
    renderWithProviders(<MatchingPage />);

    // Click match button
    const matchButton = await screen.findByRole('button', { name: /マッチングを実行/ });
    await user.click(matchButton);

    // Wait for candidates to appear
    await waitFor(() => {
      expect(screen.getByText('グループ内薬局')).toBeInTheDocument();
    });

    // Pharmacy 5 is in the group → should show "グループ" badge
    await waitFor(() => {
      const groupBadges = screen.getAllByText('グループ');
      expect(groupBadges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('does not show "グループ" badge for candidates not in group', async () => {
    mockMatchingFetch();
    const user = userEvent.setup();
    renderWithProviders(<MatchingPage />);

    const matchButton = await screen.findByRole('button', { name: /マッチングを実行/ });
    await user.click(matchButton);

    await waitFor(() => {
      expect(screen.getByText('グループ外薬局')).toBeInTheDocument();
    });

    // Get the candidate header for グループ外薬局
    // Pharmacy 99 is NOT in any group, so no group badge near that name
    const candidateButton = screen.getByText('グループ外薬局').closest('button');
    expect(candidateButton).toBeTruthy();

    // Check there's no "グループ" badge within this specific candidate's header
    const badgesInHeader = candidateButton!.querySelectorAll('.badge');
    const groupBadges = Array.from(badgesInHeader).filter((b) => b.textContent === 'グループ');
    expect(groupBadges).toHaveLength(0);
  });

  it('does not show group badges when user has no groups', async () => {
    mockMatchingFetch({ includeGroups: false });
    const user = userEvent.setup();
    renderWithProviders(<MatchingPage />);

    const matchButton = await screen.findByRole('button', { name: /マッチングを実行/ });
    await user.click(matchButton);

    await waitFor(() => {
      expect(screen.getByText('グループ内薬局')).toBeInTheDocument();
    });

    // Verify no "グループ" badge exists as .badge element
    const allBadges = document.querySelectorAll('.badge');
    const groupBadges = Array.from(allBadges).filter((b) => b.textContent === 'グループ');
    expect(groupBadges).toHaveLength(0);
  });

  it('auto-loads and narrows candidates by inventory search drugs', async () => {
    mockMatchingFetch();
    renderWithProviders(<MatchingPage />, {
      route: '/matching?inventorySearchDrugs=%E3%82%A2%E3%82%B9%E3%83%94%E3%83%AA%E3%83%B3%20100mg',
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /グループ内薬局/ })).toBeInTheDocument();
    });

    expect(screen.queryByText('グループ外薬局')).not.toBeInTheDocument();
    expect(screen.getByText(/医薬品在庫検索からマッチング候補を確認しています/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全候補を表示' })).toBeInTheDocument();
  });

  it('does not auto-retry forever when inventory-search auto-load fails', async () => {
    const exchangeFindCalls = { value: 0 };
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
      if (url.includes('/api/proposal-templates')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return new Response(JSON.stringify({ timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null }, digest: { events: [] }, unreadCount: 0 }), {
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
      if (url.includes('/api/exchange/find')) {
        exchangeFindCalls.value += 1;
        return new Response(JSON.stringify({ error: '検索失敗' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MatchingPage />, {
      route: '/matching?targetPharmacyId=5&inventorySearchDrugs=%E3%83%86%E3%82%B9%E3%83%88%E8%96%AC',
    });

    await screen.findByText('検索失敗');
    await waitFor(() => {
      expect(exchangeFindCalls.value).toBe(1);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(exchangeFindCalls.value).toBe(1);
  });

  it('sends groupOnly filter to the matching API', async () => {
    const exchangeFindBodies: Array<string | null> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
      if (url.includes('/api/proposal-templates')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return new Response(JSON.stringify({ timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null }, digest: { events: [] }, unreadCount: 0 }), {
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
      if (url.includes('/api/exchange/find')) {
        exchangeFindBodies.push(typeof init?.body === 'string' ? init.body : null);
        return new Response(JSON.stringify({ candidates: matchCandidates }), {
          status: 200,
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
    await screen.findByRole('button', { name: /グループ内薬局/ });
    await user.click(await screen.findByRole('button', { name: /絞り込みと並び替えを開く/ }));
    await user.click(await screen.findByLabelText('グループのみ'));
    await user.click(await screen.findByRole('button', { name: /マッチングを実行/ }));

    await waitFor(() => {
      expect(exchangeFindBodies[exchangeFindBodies.length - 1]).toBe(JSON.stringify({ groupOnly: true }));
    });
  });

  it('sorts by expiry using expirationDateIso when present', async () => {
    const expiryCandidates = [
      {
        pharmacyId: 40,
        pharmacyName: 'ISO優先候補',
        pharmacyPhone: '03-4000-0000',
        pharmacyFax: '03-4000-0001',
        distance: 4,
        itemsFromA: [{ deadStockItemId: 11, drugCode: 'DRUG-A', drugName: '薬A', quantity: 100, unit: '錠', yakkaUnitPrice: 100, yakkaValue: 10000, expirationDate: '2027-12-31', expirationDateIso: '2026-04-01', matchScore: 0.9 }],
        itemsFromB: [{ deadStockItemId: 12, drugCode: 'DRUG-B', drugName: '薬B', quantity: 100, unit: '錠', yakkaUnitPrice: 100, yakkaValue: 10000, expirationDate: '2027-12-31', expirationDateIso: '2026-04-10', matchScore: 0.8 }],
        totalValueA: 10000,
        totalValueB: 10000,
        valueDifference: 0,
        score: 88,
        matchRate: 0.9,
        isFavorite: false,
      },
      {
        pharmacyId: 41,
        pharmacyName: '通常候補',
        pharmacyPhone: '03-4100-0000',
        pharmacyFax: '03-4100-0001',
        distance: 5,
        itemsFromA: [{ deadStockItemId: 21, drugCode: 'DRUG-C', drugName: '薬C', quantity: 100, unit: '錠', yakkaUnitPrice: 100, yakkaValue: 10000, expirationDate: '2026-05-01', expirationDateIso: null, matchScore: 0.9 }],
        itemsFromB: [{ deadStockItemId: 22, drugCode: 'DRUG-D', drugName: '薬D', quantity: 100, unit: '錠', yakkaUnitPrice: 100, yakkaValue: 10000, expirationDate: '2026-05-05', expirationDateIso: null, matchScore: 0.8 }],
        totalValueA: 10000,
        totalValueB: 10000,
        valueDifference: 0,
        score: 87,
        matchRate: 0.88,
        isFavorite: false,
      },
    ];

    setupFetchMock({
      '/api/auth/me': mockUser,
      '/api/upload/status': { deadStockUploaded: true, usedMedicationUploaded: true },
      '/api/exchange/find': { candidates: expiryCandidates },
      '/api/groups/membership-summary': membershipSummaryResponse,
      '/api/timeline/bootstrap': { timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null }, digest: { events: [] }, unreadCount: 0 },
      '/api/timeline/unread-count': { unreadCount: 0 },
    });

    const user = userEvent.setup();
    renderWithProviders(<MatchingPage />, {
      route: '/matching?sortBy=expiry&sortOrder=asc',
    });

    const matchButton = await screen.findByRole('button', { name: /マッチングを実行/ });
    await user.click(matchButton);

    await waitFor(() => {
      expect(screen.getByText('ISO優先候補')).toBeInTheDocument();
      expect(screen.getByText('通常候補')).toBeInTheDocument();
    });

    const isoCandidate = screen.getByText('ISO優先候補');
    const standardCandidate = screen.getByText('通常候補');
    expect(isoCandidate.compareDocumentPosition(standardCandidate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders saved bookmarks from drugCode keys and deletes them with the same key', async () => {
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
        return new Response(JSON.stringify({ timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null }, digest: { events: [] }, unreadCount: 0 }), {
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
      if (url.includes('/api/exchange/find')) {
        return new Response(JSON.stringify({ candidates: matchCandidates }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/match-bookmarks?page=1&limit=100')) {
        return new Response(JSON.stringify({
          items: [{
            id: 77,
            pharmacyId: mockUser.id,
            candidatePharmacyId: 5,
            candidatePharmacyName: 'グループ内薬局',
            drugCode: 'ASP-100',
            memo: null,
            createdAt: '2026-03-01T00:00:00.000Z',
          }],
          page: 1,
          limit: 100,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/match-bookmarks/77') && method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
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

    const matchButton = await screen.findByRole('button', { name: /マッチングを実行/ });
    await user.click(matchButton);

    const candidateToggle = await screen.findByRole('button', { name: /グループ内薬局/ });
    await user.click(candidateToggle);

    await user.click(screen.getAllByRole('button', { name: 'その他' })[0]);
    await user.click(await screen.findByRole('button', { name: 'アスピリン 100mg をブックマーク解除' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/match-bookmarks/77'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});
