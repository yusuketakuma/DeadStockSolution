import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GroupListPage from '../../pages/GroupListPage';
import { renderWithProviders, mockUser, setupFetchMock } from '../helpers';
import type { GroupListResponse, PharmacyGroup } from '../../../../server/src/types/group';

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

const sampleMyGroups: PharmacyGroup[] = [
  {
    id: 1,
    name: '東京薬局グループ',
    description: '東京都内の薬局ネットワーク',
    visibility: 'public',
    ownerPharmacyId: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 2,
    name: '大阪薬局連携',
    description: null,
    visibility: 'invite_only',
    ownerPharmacyId: 2,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
];

const samplePublicGroups: PharmacyGroup[] = [
  {
    id: 3,
    name: '全国薬局ネットワーク',
    description: '全国規模のグループ',
    visibility: 'public',
    ownerPharmacyId: 5,
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
  },
  {
    id: 4,
    name: '北海道薬局グループ',
    description: null,
    visibility: 'invite_only',
    ownerPharmacyId: 10,
    createdAt: '2026-01-04T00:00:00Z',
    updatedAt: '2026-01-04T00:00:00Z',
  },
];

function makeGroupListResponse(groups: PharmacyGroup[]): GroupListResponse {
  return { groups, total: groups.length, offset: 0, limit: 20 };
}

function mockGroupFetch(options: {
  myGroups?: PharmacyGroup[];
  publicGroups?: PharmacyGroup[];
  createSuccess?: boolean;
  joinSuccess?: boolean;
} = {}) {
  const {
    myGroups = sampleMyGroups,
    publicGroups = samplePublicGroups,
    createSuccess = true,
    joinSuccess = true,
  } = options;

  return setupFetchMock({
    '/api/auth/me': mockUser,
    '/api/groups?tab=mine': makeGroupListResponse(myGroups),
    '/api/groups?tab=public': makeGroupListResponse(publicGroups),
    '/api/timeline/bootstrap': { timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null }, digest: { events: [] }, unreadCount: 0 },
    '/api/timeline/unread-count': { unreadCount: 0 },
    ...(createSuccess ? { '/api/groups': { id: 99, name: 'New Group' } } : {}),
    ...(joinSuccess ? { '/api/groups/3/join': {} } : {}),
  });
}

describe('GroupListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false); // desktop by default
  });

  it('renders page title and tabs', async () => {
    mockGroupFetch();
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByText('グループ一覧')).toBeInTheDocument();
    });

    expect(screen.getByText('マイグループ')).toBeInTheDocument();
    expect(screen.getByText('公開グループ')).toBeInTheDocument();
  });

  it('shows "グループ作成" button for authenticated user', async () => {
    mockGroupFetch();
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'グループ作成' })).toBeInTheDocument();
    });
  });

  it('displays my groups on mine tab', async () => {
    mockGroupFetch();
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByText('東京薬局グループ')).toBeInTheDocument();
    });

    expect(screen.getByText('大阪薬局連携')).toBeInTheDocument();
  });

  it('shows visibility badges', async () => {
    mockGroupFetch();
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByText('公開')).toBeInTheDocument();
    });
    expect(screen.getByText('招待制')).toBeInTheDocument();
  });

  it('shows empty state when no groups', async () => {
    mockGroupFetch({ myGroups: [] });
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByText('まだグループに参加していません')).toBeInTheDocument();
    });
  });

  it('shows loading state', async () => {
    // Set up a fetch that never resolves to capture loading state
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderWithProviders(<GroupListPage />);

    expect(screen.getByText('グループ一覧を読み込み中...')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/groups')) {
        return new Response(JSON.stringify({ error: 'サーバーエラー' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByText('サーバーエラー')).toBeInTheDocument();
    });
  });

  it('switches to public tab and shows public groups', async () => {
    const user = userEvent.setup();
    mockGroupFetch();
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByText('東京薬局グループ')).toBeInTheDocument();
    });

    await user.click(screen.getByText('公開グループ'));

    await waitFor(() => {
      expect(screen.getByText('全国薬局ネットワーク')).toBeInTheDocument();
    });
  });

  it('shows "参加" button for public groups', async () => {
    const user = userEvent.setup();
    mockGroupFetch();
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByText('東京薬局グループ')).toBeInTheDocument();
    });

    await user.click(screen.getByText('公開グループ'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '参加' })).toBeInTheDocument();
    });
  });

  it('shows "招待待ち" badge for invite-only public groups', async () => {
    const user = userEvent.setup();
    mockGroupFetch();
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByText('東京薬局グループ')).toBeInTheDocument();
    });

    await user.click(screen.getByText('公開グループ'));

    await waitFor(() => {
      expect(screen.getByText('招待待ち')).toBeInTheDocument();
    });
  });

  it('opens and closes creation modal', async () => {
    const user = userEvent.setup();
    mockGroupFetch();
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'グループ作成' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'グループ作成' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Modal contains form fields and action buttons
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '作成' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('例: 東京都薬局グループ')).toBeInTheDocument();
  });

  it('creation modal has disabled submit when name is empty', async () => {
    const user = userEvent.setup();
    mockGroupFetch();
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'グループ作成' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'グループ作成' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '作成' })).toBeDisabled();
    });
  });

  it('renders mobile cards on mobile viewport', async () => {
    setMatchMedia(true); // mobile
    mockGroupFetch();
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByText('東京薬局グループ')).toBeInTheDocument();
    });

    // Mobile layout uses dl-mobile-only class
    const mobileContainer = document.querySelector('.dl-mobile-only');
    expect(mobileContainer).toBeInTheDocument();
  });

  it('shows search input on public tab', async () => {
    const user = userEvent.setup();
    mockGroupFetch();
    renderWithProviders(<GroupListPage />);

    await waitFor(() => {
      expect(screen.getByText('東京薬局グループ')).toBeInTheDocument();
    });

    await user.click(screen.getByText('公開グループ'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('グループ名で検索...')).toBeInTheDocument();
    });
  });
});
