import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import GroupDetailPage from '../../pages/GroupDetailPage';
import { renderWithProviders, mockUser, setupFetchMock } from '../helpers';
import type { GroupDetailResponse } from '../../../../server/src/types/group';

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

const sampleGroupAsOwner: GroupDetailResponse = {
  id: 1,
  name: '東京薬局グループ',
  description: '東京都内の薬局ネットワーク',
  visibility: 'public',
  ownerPharmacyId: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  memberCount: 3,
  members: [
    { id: 1, groupId: 1, pharmacyId: 1, role: 'owner', joinedAt: '2026-01-01T00:00:00Z' },
    { id: 2, groupId: 1, pharmacyId: 2, role: 'admin', joinedAt: '2026-01-02T00:00:00Z' },
    { id: 3, groupId: 1, pharmacyId: 3, role: 'member', joinedAt: '2026-01-03T00:00:00Z' },
  ],
};

const sampleGroupAsMember: GroupDetailResponse = {
  ...sampleGroupAsOwner,
  ownerPharmacyId: 99,
  members: [
    { id: 1, groupId: 1, pharmacyId: 99, role: 'owner', joinedAt: '2026-01-01T00:00:00Z' },
    { id: 2, groupId: 1, pharmacyId: 1, role: 'member', joinedAt: '2026-01-02T00:00:00Z' },
  ],
  memberCount: 2,
};

const sampleGroupAsAdmin: GroupDetailResponse = {
  ...sampleGroupAsOwner,
  ownerPharmacyId: 99,
  members: [
    { id: 1, groupId: 1, pharmacyId: 99, role: 'owner', joinedAt: '2026-01-01T00:00:00Z' },
    { id: 2, groupId: 1, pharmacyId: 1, role: 'admin', joinedAt: '2026-01-02T00:00:00Z' },
    { id: 3, groupId: 1, pharmacyId: 3, role: 'member', joinedAt: '2026-01-03T00:00:00Z' },
  ],
  memberCount: 3,
};

function renderGroupDetail(groupData: GroupDetailResponse = sampleGroupAsOwner) {
  setupFetchMock({
    '/api/auth/me': mockUser,
    '/api/groups/1': groupData,
    '/api/timeline/bootstrap': { timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null }, digest: { events: [] }, unreadCount: 0 },
    '/api/timeline/unread-count': { unreadCount: 0 },
  });

  return renderWithProviders(
    <Routes>
      <Route path="/groups/:id" element={<GroupDetailPage />} />
    </Routes>,
    { route: '/groups/1' },
  );
}

describe('GroupDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false); // desktop
  });

  it('renders group name and info', async () => {
    renderGroupDetail();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 4, name: '東京薬局グループ' })).toBeInTheDocument();
    });

    expect(screen.getByText('グループ情報')).toBeInTheDocument();
    expect(screen.getByText('東京都内の薬局ネットワーク')).toBeInTheDocument();
  });

  it('shows visibility badge', async () => {
    renderGroupDetail();

    await waitFor(() => {
      expect(screen.getByText('公開')).toBeInTheDocument();
    });
  });

  it('shows owner pharmacy id', async () => {
    renderGroupDetail();

    await waitFor(() => {
      expect(screen.getByText('オーナー薬局ID')).toBeInTheDocument();
    });
  });

  it('shows member count', async () => {
    renderGroupDetail();

    await waitFor(() => {
      expect(screen.getByText('3名')).toBeInTheDocument();
    });
  });

  it('shows role badges for members', async () => {
    renderGroupDetail();

    await waitFor(() => {
      expect(screen.getByText('オーナー')).toBeInTheDocument();
    });
    expect(screen.getByText('管理者')).toBeInTheDocument();
    expect(screen.getByText('メンバー')).toBeInTheDocument();
  });

  it('shows member list panel', async () => {
    renderGroupDetail();

    await waitFor(() => {
      expect(screen.getByText('メンバー一覧（3名）')).toBeInTheDocument();
    });
  });

  // Owner controls
  it('shows "設定編集" and "グループ削除" buttons for owner', async () => {
    renderGroupDetail(sampleGroupAsOwner);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '設定編集' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'グループ削除' })).toBeInTheDocument();
  });

  it('shows "除外" buttons for non-owner members when owner', async () => {
    renderGroupDetail(sampleGroupAsOwner);

    await waitFor(() => {
      const removeButtons = screen.getAllByRole('button', { name: '除外' });
      // Should have remove buttons for non-owner members (2 of 3)
      expect(removeButtons).toHaveLength(2);
    });
  });

  it('shows invite member form for owner', async () => {
    renderGroupDetail(sampleGroupAsOwner);

    await waitFor(() => {
      expect(screen.getByText('メンバー招待')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('招待する薬局のIDを入力')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '招待' })).toBeInTheDocument();
  });

  // Admin controls
  it('shows "設定編集" but not "グループ削除" for admin', async () => {
    renderGroupDetail(sampleGroupAsAdmin);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '設定編集' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'グループ削除' })).not.toBeInTheDocument();
  });

  it('shows invite member form for admin', async () => {
    renderGroupDetail(sampleGroupAsAdmin);

    await waitFor(() => {
      expect(screen.getByText('メンバー招待')).toBeInTheDocument();
    });
  });

  // Member controls
  it('shows "脱退" button for regular member', async () => {
    renderGroupDetail(sampleGroupAsMember);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '脱退' })).toBeInTheDocument();
    });
  });

  it('does not show management controls for regular member', async () => {
    renderGroupDetail(sampleGroupAsMember);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 4, name: '東京薬局グループ' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: '設定編集' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'グループ削除' })).not.toBeInTheDocument();
    expect(screen.queryByText('メンバー招待')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '除外' })).not.toBeInTheDocument();
  });

  // Confirm modals
  it('opens delete confirmation modal', async () => {
    const user = userEvent.setup();
    renderGroupDetail(sampleGroupAsOwner);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'グループ削除' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'グループ削除' }));

    await waitFor(() => {
      expect(screen.getByText('グループの削除')).toBeInTheDocument();
    });
    expect(screen.getByText(/この操作は取り消せません/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '削除する' })).toBeInTheDocument();
  });

  it('opens leave confirmation modal', async () => {
    const user = userEvent.setup();
    renderGroupDetail(sampleGroupAsMember);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '脱退' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '脱退' }));

    await waitFor(() => {
      expect(screen.getByText('グループの脱退')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '脱退する' })).toBeInTheDocument();
  });

  it('opens remove member confirmation modal', async () => {
    const user = userEvent.setup();
    renderGroupDetail(sampleGroupAsOwner);

    await waitFor(() => {
      const removeButtons = screen.getAllByRole('button', { name: '除外' });
      expect(removeButtons.length).toBeGreaterThan(0);
    });

    const removeButtons = screen.getAllByRole('button', { name: '除外' });
    await user.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('メンバーの除外')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '除外する' })).toBeInTheDocument();
  });

  // Edit modal
  it('opens edit settings modal with current values', async () => {
    const user = userEvent.setup();
    renderGroupDetail(sampleGroupAsOwner);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '設定編集' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '設定編集' }));

    await waitFor(() => {
      expect(screen.getByText('グループ設定')).toBeInTheDocument();
    });

    // Modal should have the current group name prefilled
    const nameInput = screen.getByDisplayValue('東京薬局グループ');
    expect(nameInput).toBeInTheDocument();

    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
  });

  // Loading / error states
  it('shows loading state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderWithProviders(
      <Routes>
        <Route path="/groups/:id" element={<GroupDetailPage />} />
      </Routes>,
      { route: '/groups/1' },
    );

    expect(screen.getByText('グループ情報を読み込み中...')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    setupFetchMock({
      '/api/auth/me': mockUser,
      '/api/timeline/bootstrap': { timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null }, digest: { events: [] }, unreadCount: 0 },
      '/api/timeline/unread-count': { unreadCount: 0 },
    });

    // Override to make groups/1 return 404
    const originalFetch = global.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/groups/1')) {
        return new Response(JSON.stringify({ error: 'グループが見つかりません' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    }));

    renderWithProviders(
      <Routes>
        <Route path="/groups/:id" element={<GroupDetailPage />} />
      </Routes>,
      { route: '/groups/1' },
    );

    await waitFor(() => {
      expect(screen.getByText('グループが見つかりません')).toBeInTheDocument();
    });
  });

  it('renders mobile layout on mobile viewport', async () => {
    setMatchMedia(true); // mobile
    renderGroupDetail();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 4, name: '東京薬局グループ' })).toBeInTheDocument();
    });

    const mobileContainer = document.querySelector('.dl-mobile-only');
    expect(mobileContainer).toBeInTheDocument();
  });
});
