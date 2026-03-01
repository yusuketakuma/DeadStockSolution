import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProposalsPage from '../../pages/ProposalsPage';
import PharmacyListPage from '../../pages/PharmacyListPage';
import ExchangeHistoryPage from '../../pages/ExchangeHistoryPage';
import { renderWithProviders, mockUser } from '../helpers';

function createMockFetch(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const requestUrl = new URL(url, 'http://localhost');
    const requestPath = requestUrl.pathname;
    const requestPathWithQuery = `${requestUrl.pathname}${requestUrl.search}`;

    for (const [path, data] of Object.entries(routes)) {
      const routeUrl = new URL(path, 'http://localhost');
      const routePath = routeUrl.pathname;
      const routePathWithQuery = `${routeUrl.pathname}${routeUrl.search}`;
      const matches = routeUrl.search
        ? requestPathWithQuery === routePathWithQuery
        : requestPath === routePath;

      if (matches) {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: `Mock route not found: ${requestPathWithQuery}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

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

describe('ProposalsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
  });

  it('renders the proposals page with title', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/exchange/proposals': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<ProposalsPage />);

    await waitFor(() => {
      expect(screen.getByText('マッチング一覧')).toBeInTheDocument();
    });
  });

  it('shows empty state when no proposals', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/exchange/proposals': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<ProposalsPage />);

    await waitFor(() => {
      expect(screen.getByText('マッチング履歴はまだありません')).toBeInTheDocument();
    });
  });

  it('renders proposals with correct data', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/exchange/proposals': {
        data: [
          {
            id: 1,
            pharmacyAId: 1,
            pharmacyBId: 2,
            pharmacyAName: 'テスト薬局',
            pharmacyBName: '大阪薬局',
            status: 'proposed',
            totalValueA: 5000,
            totalValueB: 4500,
            valueDifference: 500,
            proposedAt: '2026-01-20T10:00:00Z',
          },
          {
            id: 2,
            pharmacyAId: 3,
            pharmacyBId: 1,
            pharmacyAName: '名古屋薬局',
            pharmacyBName: 'テスト薬局',
            status: 'confirmed',
            totalValueA: 8000,
            totalValueB: 7500,
            valueDifference: 500,
            proposedAt: '2026-01-15T10:00:00Z',
          },
        ],
        pagination: { page: 1, totalPages: 1, total: 2 },
      },
    });

    renderWithProviders(<ProposalsPage />);

    await waitFor(() => {
      expect(screen.getByText('大阪薬局')).toBeInTheDocument();
    });
    expect(screen.getByText('名古屋薬局')).toBeInTheDocument();
  });

  it('shows correct status badges', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/exchange/proposals': {
        data: [
          {
            id: 1,
            pharmacyAId: 1, pharmacyBId: 2,
            pharmacyAName: 'テスト薬局', pharmacyBName: '大阪薬局',
            status: 'proposed',
            totalValueA: 5000, totalValueB: 4500, valueDifference: 500,
            proposedAt: '2026-01-20T10:00:00Z',
          },
        ],
        pagination: { page: 1, totalPages: 1, total: 1 },
      },
    });

    renderWithProviders(<ProposalsPage />);

    await waitFor(() => {
      expect(screen.getByText('仮マッチング中')).toBeInTheDocument();
    });
  });

  it('shows detail links for each proposal', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/exchange/proposals': {
        data: [
          {
            id: 1,
            pharmacyAId: 1, pharmacyBId: 2,
            pharmacyAName: 'テスト薬局', pharmacyBName: '大阪薬局',
            status: 'proposed',
            totalValueA: 5000, totalValueB: 4500, valueDifference: 500,
            proposedAt: '2026-01-20T10:00:00Z',
          },
        ],
        pagination: { page: 1, totalPages: 1, total: 1 },
      },
    });

    renderWithProviders(<ProposalsPage />);

    await waitFor(() => {
      const detailLink = screen.getByRole('link', { name: '詳細' });
      expect(detailLink).toBeInTheDocument();
      expect(detailLink).toHaveAttribute('href', '/proposals/1');
    });
  });

  it('shows table headers', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/exchange/proposals': {
        data: [{
          id: 1,
          pharmacyAId: 1, pharmacyBId: 2,
          pharmacyAName: 'テスト薬局', pharmacyBName: '大阪薬局',
          status: 'proposed',
          totalValueA: 5000, totalValueB: 4500, valueDifference: 500,
          proposedAt: '2026-01-20T10:00:00Z',
        }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      },
    });

    renderWithProviders(<ProposalsPage />);

    await waitFor(() => {
      expect(screen.getByText('ID')).toBeInTheDocument();
    });
    expect(screen.getByText('相手薬局')).toBeInTheDocument();
    expect(screen.getByText('ステータス')).toBeInTheDocument();
    expect(screen.getByText('開始日')).toBeInTheDocument();
  });

  it('renders mobile data cards on mobile viewport', async () => {
    setMatchMedia(true);
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/exchange/proposals': {
        data: [{
          id: 1,
          pharmacyAId: 1, pharmacyBId: 2,
          pharmacyAName: 'テスト薬局', pharmacyBName: '大阪薬局',
          status: 'proposed',
          totalValueA: 5000, totalValueB: 4500, valueDifference: 500,
          proposedAt: '2026-01-20T10:00:00Z',
        }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      },
    });

    renderWithProviders(<ProposalsPage />);

    await waitFor(() => {
      expect(screen.getByText('マッチング #1')).toBeInTheDocument();
    });
    expect(screen.queryByRole('columnheader', { name: '相手薬局' })).not.toBeInTheDocument();
  });
});

describe('PharmacyListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
  });

  it('renders the pharmacy list page with title', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/pharmacies': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<PharmacyListPage />);

    await waitFor(() => {
      expect(screen.getByText('登録薬局一覧')).toBeInTheDocument();
    });
  });

  it('shows empty state when no pharmacies', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/pharmacies': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<PharmacyListPage />);

    await waitFor(() => {
      expect(screen.getByText('薬局が見つかりません')).toBeInTheDocument();
    });
  });

  it('renders pharmacies with correct data', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/pharmacies': {
        data: [
          {
            id: 2,
            name: '大阪薬局',
            prefecture: '大阪府',
            address: '大阪市中央区1-1',
            phone: '06-1234-5678',
            fax: '06-1234-5679',
            distance: 450,
          },
          {
            id: 3,
            name: '名古屋薬局',
            prefecture: '愛知県',
            address: '名古屋市中区1-1',
            phone: '052-123-4567',
            fax: '052-123-4568',
            distance: 350,
          },
        ],
        pagination: { page: 1, totalPages: 1, total: 2 },
      },
    });

    renderWithProviders(<PharmacyListPage />);

    await waitFor(() => {
      expect(screen.getByText('大阪薬局')).toBeInTheDocument();
    });
    expect(screen.getByText('名古屋薬局')).toBeInTheDocument();
    // Prefecture appears both in dropdown and table; check table cells specifically
    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('大阪府');
    expect(rows[1]).toHaveTextContent('愛知県');
    expect(screen.getByText('450km')).toBeInTheDocument();
    expect(screen.getByText('350km')).toBeInTheDocument();
  });

  it('has a search input', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/pharmacies': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<PharmacyListPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('薬局名で検索（ひらがな・カタカナ対応）...')).toBeInTheDocument();
    });
  });

  it('has prefecture filter dropdown', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/pharmacies': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<PharmacyListPage />);

    await waitFor(() => {
      expect(screen.getByText('全都道府県')).toBeInTheDocument();
    });
  });

  it('has sort by dropdown', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/pharmacies': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<PharmacyListPage />);

    await waitFor(() => {
      expect(screen.getByText('登録順')).toBeInTheDocument();
      expect(screen.getByText('距離が近い順')).toBeInTheDocument();
    });
  });

  it('submits search query', async () => {
    const user = userEvent.setup();

    const fetchMock = createMockFetch({
      '/api/auth/me': mockUser,
      '/api/pharmacies': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<PharmacyListPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('薬局名で検索（ひらがな・カタカナ対応）...')).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('薬局名で検索（ひらがな・カタカナ対応）...'), '大阪');
    await user.click(screen.getByRole('button', { name: '検索' }));

    await waitFor(() => {
      const searchCall = fetchMock.mock.calls.find(
        (call) => {
          const url = typeof call[0] === 'string' ? call[0] : call[0].toString();
          return url.includes('/api/pharmacies') && url.includes('search=');
        }
      );
      expect(searchCall).toBeTruthy();
    });
  });

  it('shows table headers', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/pharmacies': {
        data: [{
          id: 1, name: 'テスト', prefecture: '東京都',
          address: '東京', phone: '03-1234', fax: '03-5678', distance: 10,
        }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      },
    });

    renderWithProviders(<PharmacyListPage />);

    await waitFor(() => {
      expect(screen.getByText('薬局名')).toBeInTheDocument();
    });
    expect(screen.getByText('都道府県')).toBeInTheDocument();
    expect(screen.getByText('住所')).toBeInTheDocument();
    expect(screen.getByText('電話')).toBeInTheDocument();
    expect(screen.getByText('FAX')).toBeInTheDocument();
    expect(screen.getByText('距離')).toBeInTheDocument();
  });

  it('renders mobile pharmacy cards on mobile viewport', async () => {
    setMatchMedia(true);
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/pharmacies/relationships': {
        favorites: [],
        blocked: [],
      },
      '/api/pharmacies': {
        data: [{
          id: 2,
          name: '大阪薬局',
          prefecture: '大阪府',
          address: '大阪市中央区1-1',
          phone: '06-1234-5678',
          fax: '06-1234-5679',
          distance: 450,
        }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      },
    });

    renderWithProviders(<PharmacyListPage />);

    await waitFor(() => {
      expect(screen.getByText('営業状況')).toBeInTheDocument();
    });
    expect(screen.queryByRole('columnheader', { name: '都道府県' })).not.toBeInTheDocument();
  });
});

describe('ExchangeHistoryPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
  });

  it('renders the exchange history page', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/exchange/history': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<ExchangeHistoryPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('交換履歴');
    });
    expect(screen.getByText('交換履歴はまだありません')).toBeInTheDocument();
  });

  it('shows timeline links for each history row', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/exchange/history': {
        data: [
          {
            id: 1,
            proposalId: 12,
            pharmacyAId: 1,
            pharmacyBId: 2,
            pharmacyAName: 'テスト薬局',
            pharmacyBName: '大阪薬局',
            totalValue: 12000,
            completedAt: '2026-02-10T10:00:00Z',
          },
          {
            id: 2,
            proposalId: 25,
            pharmacyAId: 3,
            pharmacyBId: 1,
            pharmacyAName: '名古屋薬局',
            pharmacyBName: 'テスト薬局',
            totalValue: 14000,
            completedAt: '2026-02-11T10:00:00Z',
          },
        ],
        pagination: { page: 1, totalPages: 1, total: 2 },
      },
    });

    renderWithProviders(<ExchangeHistoryPage />);

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'タイムライン' })).toHaveLength(2);
    });
    const timelineLinks = screen.getAllByRole('link', { name: 'タイムライン' });
    expect(timelineLinks[0]).toHaveAttribute('href', '/proposals/12#proposal-timeline');
    expect(timelineLinks[1]).toHaveAttribute('href', '/proposals/25#proposal-timeline');
  });

  it('renders mobile history cards on mobile viewport', async () => {
    setMatchMedia(true);
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/exchange/history': {
        data: [{
          id: 1,
          proposalId: 12,
          pharmacyAId: 1,
          pharmacyBId: 2,
          pharmacyAName: 'テスト薬局',
          pharmacyBName: '大阪薬局',
          totalValue: 12000,
          completedAt: '2026-02-10T10:00:00Z',
        }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      },
    });

    renderWithProviders(<ExchangeHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText('履歴 #1')).toBeInTheDocument();
    });
    const timelineLink = screen.getByRole('link', { name: 'タイムライン' });
    expect(timelineLink).toBeInTheDocument();
    expect(timelineLink).toHaveAttribute('href', '/proposals/12#proposal-timeline');
    expect(screen.queryByRole('columnheader', { name: '相手薬局' })).not.toBeInTheDocument();
  });
});
