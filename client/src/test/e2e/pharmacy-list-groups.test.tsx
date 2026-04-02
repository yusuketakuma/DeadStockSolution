import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PharmacyListPage from '../../pages/PharmacyListPage';
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

const samplePharmacies = [
  { id: 1, name: 'テスト薬局', prefecture: '東京都', address: '東京都渋谷区1-1', phone: '03-1111-1111', fax: '03-1111-2222', distance: null },
  { id: 2, name: 'サンプル薬局', prefecture: '大阪府', address: '大阪府大阪市1-1', phone: '06-2222-2222', fax: '06-2222-3333', distance: 5 },
  { id: 3, name: 'ヘルス薬局', prefecture: '北海道', address: '北海道札幌市1-1', phone: '011-3333-3333', fax: '011-3333-4444', distance: 100 },
];

const samplePharmaciesResponse = {
  data: samplePharmacies,
  pagination: { page: 1, totalPages: 1, total: 3 },
};

const membershipSummaryResponse: GroupMembershipSummaryResponse = {
  groups: [
    { id: 10, name: '東京グループ', memberPharmacyIds: [1, 2] },
    { id: 20, name: '全国ネットワーク', memberPharmacyIds: [1, 3] },
  ],
  groupPharmacyIds: [1, 2, 3],
};

function mockPharmacyListFetch(options: {
  includeGroups?: boolean;
  emptyGroups?: boolean;
} = {}) {
  const { includeGroups = true, emptyGroups = false } = options;

  const routes: Record<string, unknown> = {
    '/api/auth/me': mockUser,
    '/api/pharmacies/relationships': { favorites: [], blocked: [] },
    '/api/pharmacies': samplePharmaciesResponse,
    '/api/timeline/bootstrap': { timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null }, digest: { events: [] }, unreadCount: 0 },
    '/api/timeline/unread-count': { unreadCount: 0 },
  };

  if (includeGroups && !emptyGroups) {
    routes['/api/groups/membership-summary'] = membershipSummaryResponse;
  } else {
    routes['/api/groups/membership-summary'] = { groups: [], groupPharmacyIds: [] };
  }

  return setupFetchMock(routes);
}

describe('PharmacyListPage — Group Features', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false); // desktop
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Group Badges', () => {
    it('renders cross-links to my groups, public groups, and messages in the page header', async () => {
      mockPharmacyListFetch();
      renderWithProviders(<PharmacyListPage />);

      await waitFor(() => {
        expect(screen.getByText('登録薬局一覧')).toBeInTheDocument();
      });

      const matchingLinks = screen.getAllByRole('link', { name: 'マッチング' });
      expect(matchingLinks.some((link) => link.getAttribute('href') === '/matching')).toBe(true);
      expect(screen.getByRole('link', { name: 'マイグループ' })).toHaveAttribute('href', '/groups');
      expect(screen.getByRole('link', { name: '公開グループを探す' })).toHaveAttribute('href', '/groups?tab=public');
      const messageLinks = screen.getAllByRole('link', { name: 'メッセージ' });
      expect(messageLinks.some((link) => link.getAttribute('href') === '/messages')).toBe(true);
    });

    it('shows group name badge for pharmacy in a single group', async () => {
      mockPharmacyListFetch();
      renderWithProviders(<PharmacyListPage />);

      // Pharmacy ID 2 is only in group 10 (東京グループ)
      await waitFor(() => {
        expect(screen.getByText('サンプル薬局')).toBeInTheDocument();
      });

      await waitFor(() => {
        const matches = screen.getAllByText('東京グループ');
        // One in dropdown option + one as badge
        const badgeMatch = matches.find((el) => el.classList.contains('badge'));
        expect(badgeMatch).toBeTruthy();
      });
      expect(screen.getByRole('link', { name: '東京グループ' })).toHaveAttribute('href', '/groups/10');
    });
    it('shows "グループ" badge for pharmacy in multiple groups', async () => {
      mockPharmacyListFetch();
      renderWithProviders(<PharmacyListPage />);

      // Pharmacy ID 1 (テスト薬局) is in both groups → shows "グループ"
      await waitFor(() => {
        expect(screen.getByText('テスト薬局')).toBeInTheDocument();
      });

      // テスト薬局 is in groups 10 and 20, so badge text = "グループ"
      await waitFor(() => {
        const badges = screen.getAllByText('グループ');
        expect(badges.length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.getByRole('link', { name: 'グループ' })).toHaveAttribute('href', '/groups?tab=mine');
    });

    it('shows group badge for pharmacy in one group with specific name', async () => {
      mockPharmacyListFetch();
      renderWithProviders(<PharmacyListPage />);

      // Pharmacy ID 3 is only in group 20 (全国ネットワーク)
      await waitFor(() => {
        expect(screen.getByText('ヘルス薬局')).toBeInTheDocument();
      });

      await waitFor(() => {
        const matches = screen.getAllByText('全国ネットワーク');
        const badgeMatch = matches.find((el) => el.classList.contains('badge'));
        expect(badgeMatch).toBeTruthy();
      });
      expect(screen.getByRole('link', { name: '全国ネットワーク' })).toHaveAttribute('href', '/groups/20');
    });
    it('does not show group badges when user has no groups', async () => {
      mockPharmacyListFetch({ emptyGroups: true });
      renderWithProviders(<PharmacyListPage />);

      await waitFor(() => {
        expect(screen.getByText('テスト薬局')).toBeInTheDocument();
      });

      // No group badges should appear
      expect(screen.queryByText('東京グループ')).not.toBeInTheDocument();
      expect(screen.queryByText('全国ネットワーク')).not.toBeInTheDocument();
    });
  });

  describe('Group Filter', () => {
    it('applies the group filter from the URL query', async () => {
      mockPharmacyListFetch();
      renderWithProviders(<PharmacyListPage />, { route: '/pharmacies?group=10' });

      await waitFor(() => {
        expect(screen.getByText('テスト薬局')).toBeInTheDocument();
        expect(screen.getByText('サンプル薬局')).toBeInTheDocument();
      });

      expect(screen.queryByText('ヘルス薬局')).not.toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'グループで絞り込み' })).toHaveValue('10');
      expect(screen.getByRole('link', { name: '選択中グループを開く' })).toHaveAttribute('href', '/groups/10');
    });

    it('fetches incrementally while typing without clicking search', async () => {
      const mockFetch = mockPharmacyListFetch();
      const user = userEvent.setup();
      renderWithProviders(<PharmacyListPage />);

      await waitFor(() => {
        expect(screen.getByText('テスト薬局')).toBeInTheDocument();
      });

      mockFetch.mockClear();

      const searchInput = screen.getByPlaceholderText('薬局名で検索（ひらがな・カタカナ対応）...');
      await user.type(searchInput, 'テスト');

      await waitFor(() => {
        const pharmacySearchCalls = mockFetch.mock.calls.filter(([input]) => {
          const url = typeof input === 'string' ? input : input.toString();
          return url.includes('/api/pharmacies?') && url.includes('search=%E3%83%86%E3%82%B9%E3%83%88');
        });
        expect(pharmacySearchCalls.length).toBeGreaterThan(0);
      }, { timeout: 2000 });
    });

    it('keeps pagination working after filters are initialized', async () => {
      const pageOneResponse = {
        data: [
          { id: 1, name: 'テスト薬局', prefecture: '東京都', address: '東京都渋谷区1-1', phone: '03-1111-1111', fax: '03-1111-2222', distance: null },
        ],
        pagination: { page: 1, totalPages: 2, total: 2 },
      };
      const pageTwoResponse = {
        data: [
          { id: 2, name: '2ページ目薬局', prefecture: '大阪府', address: '大阪府大阪市1-1', phone: '06-2222-2222', fax: '06-2222-3333', distance: 5 },
        ],
        pagination: { page: 2, totalPages: 2, total: 2 },
      };
      const fetchMock = setupFetchMock({
        '/api/auth/me': mockUser,
        '/api/pharmacies/relationships': { favorites: [], blocked: [] },
        '/api/pharmacies?page=2': pageTwoResponse,
        '/api/pharmacies': pageOneResponse,
        '/api/groups/membership-summary': membershipSummaryResponse,
        '/api/timeline/bootstrap': { timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null }, digest: { events: [] }, unreadCount: 0 },
        '/api/timeline/unread-count': { unreadCount: 0 },
      });
      const user = userEvent.setup();

      renderWithProviders(<PharmacyListPage />);

      await waitFor(() => {
        expect(screen.getByText('テスト薬局')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'ページ 2' }));

      await waitFor(() => {
        expect(screen.getByText('2ページ目薬局')).toBeInTheDocument();
      });

      expect(screen.queryByText('テスト薬局')).not.toBeInTheDocument();
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = typeof input === 'string' ? input : input.toString();
          return url.includes('/api/pharmacies?page=2');
        }),
      ).toBe(true);
    });

    it('renders group filter dropdown with group names', async () => {
      mockPharmacyListFetch();
      renderWithProviders(<PharmacyListPage />);

      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: 'グループで絞り込み' })).toBeInTheDocument();
      });
    });

    it('filters pharmacies to selected group members', async () => {
      mockPharmacyListFetch();
      const user = userEvent.setup();
      renderWithProviders(<PharmacyListPage />);

      // Wait for pharmacies to load
      await waitFor(() => {
        expect(screen.getByText('テスト薬局')).toBeInTheDocument();
        expect(screen.getByText('サンプル薬局')).toBeInTheDocument();
        expect(screen.getByText('ヘルス薬局')).toBeInTheDocument();
      });

      // Select group 10 (東京グループ: members 1, 2)
      const groupSelect = screen.getByRole('combobox', { name: 'グループで絞り込み' });
      await user.selectOptions(groupSelect, '10');

      // Only pharmacies 1 and 2 should be visible
      await waitFor(() => {
        expect(screen.getByText('テスト薬局')).toBeInTheDocument();
        expect(screen.getByText('サンプル薬局')).toBeInTheDocument();
      });
      expect(screen.queryByText('ヘルス薬局')).not.toBeInTheDocument();
    });

    it('shows empty state when group filter matches no pharmacies on current page', async () => {
      // Override: pharmacy list only has ID 99, not in any group
      const customResponse = {
        data: [{ id: 99, name: '他の薬局', prefecture: '福岡県', address: '福岡県福岡市1-1', phone: '092-5555-5555', fax: '092-5555-6666', distance: null }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      };
      setupFetchMock({
        '/api/auth/me': mockUser,
        '/api/pharmacies/relationships': { favorites: [], blocked: [] },
        '/api/pharmacies': customResponse,
        '/api/groups/membership-summary': membershipSummaryResponse,
        '/api/timeline/bootstrap': { timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null }, digest: { events: [] }, unreadCount: 0 },
        '/api/timeline/unread-count': { unreadCount: 0 },
      });

      const user = userEvent.setup();
      renderWithProviders(<PharmacyListPage />);

      await waitFor(() => {
        expect(screen.getByText('他の薬局')).toBeInTheDocument();
      });

      // Select group 10
      const groupSelect = screen.getByRole('combobox', { name: 'グループで絞り込み' });
      await user.selectOptions(groupSelect, '10');

      await waitFor(() => {
        expect(screen.getByText('このグループに属する薬局が見つかりません')).toBeInTheDocument();
      });
      expect(screen.getByRole('link', { name: '東京グループを見る' })).toHaveAttribute('href', '/groups/10');
    });

    it('shows all pharmacies again when group filter is cleared', async () => {
      mockPharmacyListFetch();
      const user = userEvent.setup();
      renderWithProviders(<PharmacyListPage />, { route: '/pharmacies?group=10' });

      await waitFor(() => {
        expect(screen.getByText('テスト薬局')).toBeInTheDocument();
      });

      const groupSelect = screen.getByRole('combobox', { name: 'グループで絞り込み' });

      // Select group 10
      await user.selectOptions(groupSelect, '10');
      await waitFor(() => {
        expect(screen.queryByText('ヘルス薬局')).not.toBeInTheDocument();
      });

      // Clear filter (select empty value)
      await user.selectOptions(groupSelect, '');
      await waitFor(() => {
        expect(screen.getByText('ヘルス薬局')).toBeInTheDocument();
      });
      expect(window.location.search).not.toContain('group=');
    });

    it('does not show group filter options when user has no groups', async () => {
      mockPharmacyListFetch({ emptyGroups: true });
      renderWithProviders(<PharmacyListPage />);

      await waitFor(() => {
        expect(screen.getByText('テスト薬局')).toBeInTheDocument();
      });

      const groupSelect = screen.getByRole('combobox', { name: 'グループで絞り込み' });
      // Only the placeholder option should exist
      const options = within(groupSelect).getAllByRole('option');
      expect(options).toHaveLength(1); // only placeholder "全グループ"
    });
  });

  describe('Mobile View', () => {
    it('shows group badge in mobile data cards', async () => {
      setMatchMedia(true); // mobile
      mockPharmacyListFetch();
      renderWithProviders(<PharmacyListPage />);

      // Pharmacy ID 2 is in group 10 (東京グループ)
      await waitFor(() => {
        expect(screen.getByText('サンプル薬局')).toBeInTheDocument();
      });

      await waitFor(() => {
        const matches = screen.getAllByText('東京グループ');
        const badgeMatch = matches.find((el) => el.classList.contains('badge'));
        expect(badgeMatch).toBeTruthy();
      });
    });
  });
});
