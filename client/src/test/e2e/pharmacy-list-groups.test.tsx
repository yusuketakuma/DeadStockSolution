import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PharmacyListPage from '../../pages/PharmacyListPage';
import { renderWithProviders, mockUser, setupFetchMock } from '../helpers';
import type { GroupListResponse, GroupDetailResponse } from '../../../../server/src/types/group';

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

const myGroupsResponse: GroupListResponse = {
  groups: [
    { id: 10, name: '東京グループ', description: null, visibility: 'public', ownerPharmacyId: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 20, name: '全国ネットワーク', description: null, visibility: 'invite_only', ownerPharmacyId: 5, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
  ],
  total: 2,
  offset: 0,
  limit: 20,
};

const groupDetail10: GroupDetailResponse = {
  id: 10,
  name: '東京グループ',
  description: null,
  visibility: 'public',
  ownerPharmacyId: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  members: [
    { id: 100, groupId: 10, pharmacyId: 1, role: 'owner', joinedAt: '2026-01-01T00:00:00Z' },
    { id: 101, groupId: 10, pharmacyId: 2, role: 'member', joinedAt: '2026-01-01T00:00:00Z' },
  ],
  memberCount: 2,
};

const groupDetail20: GroupDetailResponse = {
  id: 20,
  name: '全国ネットワーク',
  description: null,
  visibility: 'invite_only',
  ownerPharmacyId: 5,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  members: [
    { id: 200, groupId: 20, pharmacyId: 1, role: 'member', joinedAt: '2026-01-02T00:00:00Z' },
    { id: 201, groupId: 20, pharmacyId: 3, role: 'member', joinedAt: '2026-01-02T00:00:00Z' },
  ],
  memberCount: 2,
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
    routes['/api/groups?tab=mine'] = myGroupsResponse;
    routes['/api/groups/10'] = groupDetail10;
    routes['/api/groups/20'] = groupDetail20;
  } else {
    routes['/api/groups?tab=mine'] = { groups: [], total: 0, offset: 0, limit: 20 };
  }

  return setupFetchMock(routes);
}

describe('PharmacyListPage — Group Features', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false); // desktop
  });

  describe('Group Badges', () => {
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
        '/api/groups?tab=mine': myGroupsResponse,
        '/api/groups/10': groupDetail10,
        '/api/groups/20': groupDetail20,
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
    });

    it('shows all pharmacies again when group filter is cleared', async () => {
      mockPharmacyListFetch();
      const user = userEvent.setup();
      renderWithProviders(<PharmacyListPage />);

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
