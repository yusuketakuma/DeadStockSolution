import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from '../../pages/DashboardPage';
import Layout from '../../components/Layout';
import { renderWithProviders, mockAdminUser, mockUser } from '../helpers';

function mockAuthenticatedFetchWithDashboardData(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    '/api/auth/me': mockUser,
    '/api/upload/status': {
      deadStockUploaded: true,
      usedMedicationUploaded: false,
      lastDeadStockUpload: '2026-01-15T10:00:00Z',
      lastUsedMedicationUpload: null,
    },
    '/api/notifications': {
      notices: [],
      summary: { unreadMessages: 0, actionableRequests: 0, total: 0 },
    },
    ...overrides,
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [path, data] of Object.entries(defaults)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('renders dashboard with user greeting', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('ダッシュボード')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/テスト薬局/)).toBeInTheDocument();
    });
  });

  it('shows upload status cards', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('デッドストックリスト')).toBeInTheDocument();
    });
    expect(screen.getByText('医薬品使用量リスト')).toBeInTheDocument();
    expect(screen.getByText('マッチング')).toBeInTheDocument();
  });

  it('shows uploaded badge when dead stock is uploaded', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('アップロード済み')).toBeInTheDocument();
    });
  });

  it('shows not-uploaded badge when used medication is not uploaded', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('当月未アップロード')).toBeInTheDocument();
    });
  });

  it('shows upload hint when used medication is not uploaded', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/マッチング機能を利用するには/)).toBeInTheDocument();
    });
  });

  it('shows navigation cards for all features', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('在庫参照')).toBeInTheDocument();
    });
    expect(screen.getByText('マッチング状況')).toBeInTheDocument();
    expect(screen.getByText('交換履歴')).toBeInTheDocument();
  });

  it('shows notification section', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('お知らせ')).toBeInTheDocument();
    });
  });

  it('shows next action card for upload when used medication is missing', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('次にやること')).toBeInTheDocument();
    });
    expect(screen.getByText(/(医薬品使用量|デッドストック)リストをアップロード/)).toBeInTheDocument();
    expect(screen.getByText('アップロードへ進む')).toBeInTheDocument();
  });

  it('switches next action to proposal handling when actionable requests exist', async () => {
    const createdAt = new Date().toISOString();
    const deadlineAt = new Date(Date.now() + (48 * 60 * 60 * 1000)).toISOString();
    mockAuthenticatedFetchWithDashboardData({
      '/api/upload/status': {
        deadStockUploaded: true,
        usedMedicationUploaded: true,
        lastDeadStockUpload: '2026-01-15T10:00:00Z',
        lastUsedMedicationUpload: '2026-01-16T10:00:00Z',
      },
      '/api/notifications': {
        notices: [
          {
            id: 'proposal-1',
            type: 'inbound_request',
            title: '交換提案が届いています',
            body: 'テスト薬局2号店から交換提案',
            actionPath: '/proposals/1',
            actionLabel: '確認',
            createdAt,
            deadlineAt,
            unread: true,
            priority: 1,
          },
        ],
        summary: { unreadMessages: 0, actionableRequests: 1, total: 1 },
      },
    });
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('届いている提案に対応')).toBeInTheDocument();
    });
    expect(screen.getAllByText('確認').length).toBeGreaterThan(0);
  });

  it('prioritizes nearing proposal deadline in next action', async () => {
    const now = Date.now();
    const nearDeadlineCreatedAt = new Date(now - (70 * 60 * 60 * 1000)).toISOString();
    mockAuthenticatedFetchWithDashboardData({
      '/api/upload/status': {
        deadStockUploaded: true,
        usedMedicationUploaded: true,
        lastDeadStockUpload: '2026-01-15T10:00:00Z',
        lastUsedMedicationUpload: '2026-01-16T10:00:00Z',
      },
      '/api/notifications': {
        notices: [
          {
            id: 'proposal-urgent-1',
            type: 'inbound_request',
            title: '交換提案が届いています',
            body: '承認期限が近い提案です',
            actionPath: '/proposals/1',
            actionLabel: '承認/拒否を行う',
            createdAt: nearDeadlineCreatedAt,
            unread: true,
            priority: 1,
          },
        ],
        summary: { unreadMessages: 0, actionableRequests: 1, total: 1 },
      },
    });
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('承認期限が近い提案に対応')).toBeInTheDocument();
    });
    expect(screen.getAllByText('承認/拒否を行う').length).toBeGreaterThan(0);
  });

  it('prioritizes unread admin message when it has higher priority', async () => {
    const createdAt = new Date().toISOString();
    const deadlineAt = new Date(Date.now() + (48 * 60 * 60 * 1000)).toISOString();
    mockAuthenticatedFetchWithDashboardData({
      '/api/upload/status': {
        deadStockUploaded: true,
        usedMedicationUploaded: true,
        lastDeadStockUpload: '2026-01-15T10:00:00Z',
        lastUsedMedicationUpload: '2026-01-16T10:00:00Z',
      },
      '/api/notifications': {
        notices: [
          {
            id: 'proposal-low-1',
            type: 'inbound_request',
            title: '交換提案が届いています',
            body: '通常優先度の提案',
            actionPath: '/proposals/2',
            actionLabel: '確認',
            createdAt,
            deadlineAt,
            unread: true,
            priority: 3,
          },
          {
            id: 'message-5',
            type: 'admin_message',
            title: '管理者: 重要連絡',
            body: 'システム更新のお知らせ',
            actionPath: '/account',
            actionLabel: '内容を確認',
            createdAt: '2026-01-19T10:00:00Z',
            unread: true,
            priority: 1,
          },
        ],
        summary: { unreadMessages: 1, actionableRequests: 1, total: 2 },
      },
    });
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('優先度の高い未読メッセージを確認')).toBeInTheDocument();
    });
    expect(screen.getAllByText('内容を確認').length).toBeGreaterThan(0);
  });

  it('shows notification badges with counts', async () => {
    mockAuthenticatedFetchWithDashboardData({
      '/api/notifications': {
        notices: [
          {
            id: 'proposal-1',
            type: 'inbound_request',
            title: '交換提案が届いています',
            body: 'テスト薬局2号店から交換提案',
            actionPath: '/proposals/1',
            actionLabel: '確認',
            createdAt: '2026-01-20T10:00:00Z',
            unread: true,
            priority: 1,
          },
        ],
        summary: { unreadMessages: 0, actionableRequests: 1, total: 1 },
      },
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('対応要: 1')).toBeInTheDocument();
    });
    expect(screen.getByText('交換提案が届いています')).toBeInTheDocument();
  });

  it('shows empty notifications message when no notifications', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('現在のお知らせはありません。')).toBeInTheDocument();
    });
  });

  it('keeps showing notifications when upload status request fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/upload/status')) {
        return new Response(JSON.stringify({ error: 'failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/notifications')) {
        return new Response(JSON.stringify({
          notices: [
            {
              id: 'match-10',
              type: 'match_update',
              title: '候補が更新されました',
              body: '追加 1 / 除外 0',
              actionPath: '/matching',
              actionLabel: '候補を確認',
              createdAt: '2026-02-25T12:00:00.000Z',
              unread: true,
              priority: 2,
            },
          ],
          summary: { unreadMessages: 0, actionableRequests: 1, total: 1 },
        }), {
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

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('候補が更新されました')).toBeInTheDocument();
    });
    expect(screen.getByText('アップロード状況の取得に失敗しました。')).toBeInTheDocument();
  });

  it('does not show empty notification state when notification fetch fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/upload/status')) {
        return new Response(JSON.stringify({
          deadStockUploaded: true,
          usedMedicationUploaded: true,
          lastDeadStockUpload: '2026-01-15T10:00:00Z',
          lastUsedMedicationUpload: '2026-01-16T10:00:00Z',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/notifications')) {
        return new Response(JSON.stringify({ error: 'failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('通知の取得に失敗しました。')).toBeInTheDocument();
    });
    expect(screen.queryByText('現在のお知らせはありません。')).not.toBeInTheDocument();
  });

  it('uses proposals as secondary action for match update next action', async () => {
    mockAuthenticatedFetchWithDashboardData({
      '/api/upload/status': {
        deadStockUploaded: true,
        usedMedicationUploaded: true,
        lastDeadStockUpload: '2026-01-15T10:00:00Z',
        lastUsedMedicationUpload: '2026-01-16T10:00:00Z',
      },
      '/api/notifications': {
        notices: [
          {
            id: 'match-11',
            type: 'match_update',
            title: '候補更新',
            body: '候補数 2件 → 3件',
            actionPath: '/matching',
            actionLabel: '候補を確認',
            createdAt: '2026-02-25T12:00:00.000Z',
            unread: true,
            priority: 2,
          },
        ],
        summary: { unreadMessages: 0, actionableRequests: 1, total: 1 },
      },
    });

    renderWithProviders(<DashboardPage />);

    const secondaryLink = await screen.findByRole('link', { name: 'マッチング一覧を確認' });
    expect(secondaryLink).toHaveAttribute('href', '/proposals');
  });

  it('falls back to safe internal path when next action contains unsafe notice path', async () => {
    mockAuthenticatedFetchWithDashboardData({
      '/api/upload/status': {
        deadStockUploaded: true,
        usedMedicationUploaded: true,
        lastDeadStockUpload: '2026-01-15T10:00:00Z',
        lastUsedMedicationUpload: '2026-01-16T10:00:00Z',
      },
      '/api/notifications': {
        notices: [
          {
            id: 'proposal-unsafe-1',
            type: 'inbound_request',
            title: '不正な導線テスト',
            body: '外部URLに誘導しようとする通知',
            actionPath: '//evil.example/phish',
            actionLabel: '確認',
            createdAt: '2026-02-20T12:00:00.000Z',
            unread: true,
            priority: 1,
          },
        ],
        summary: { unreadMessages: 0, actionableRequests: 1, total: 1 },
      },
    });

    renderWithProviders(<DashboardPage />);

    const safeActionLink = await screen.findByRole('link', { name: '確認' });
    expect(safeActionLink).toHaveAttribute('href', '/proposals');
  });

  it('shows matching as enabled when used medication is uploaded', async () => {
    mockAuthenticatedFetchWithDashboardData({
      '/api/upload/status': {
        deadStockUploaded: true,
        usedMedicationUploaded: true,
        lastDeadStockUpload: '2026-01-15T10:00:00Z',
        lastUsedMedicationUpload: '2026-01-16T10:00:00Z',
      },
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('デッドストックリストの交換先を検索できます')).toBeInTheDocument();
    });
  });
});

describe('Layout with Sidebar navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('renders the header with app name', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Layout><div>Test Content</div></Layout>
    );

    await waitFor(() => {
      expect(screen.getByText('DeadStockSolution')).toBeInTheDocument();
    });
    const versionLabel = document.querySelector('.app-header-version');
    expect(versionLabel).toBeTruthy();
    expect(versionLabel?.textContent ?? '').toMatch(/^v.+/);
    expect(screen.getByRole('button', { name: '要望をあげる' })).toBeInTheDocument();
  });

  it('does not render previous-path link when stored path is unsafe', async () => {
    window.localStorage.setItem('dss.previousPath', '//evil.example/phish');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Layout><div>Test Content</div></Layout>,
      { route: '/matching' },
    );

    await waitFor(() => {
      expect(screen.getByText('DeadStockSolution')).toBeInTheDocument();
    });

    expect(screen.queryByText('前回の画面へ戻る')).not.toBeInTheDocument();
  });

  it('shows github updates popover and expandable history', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/updates/github')) {
        return new Response(JSON.stringify({
          repository: 'yusuketakuma/DeadStockSolution',
          source: 'github_releases',
          stale: false,
          fetchedAt: '2026-02-25T00:00:00.000Z',
          items: [
            {
              id: '2',
              tag: 'v1.1.0',
              title: 'Header update popup',
              body: 'Added GitHub updates popover in header.',
              url: 'https://github.com/yusuketakuma/DeadStockSolution/releases/tag/v1.1.0',
              publishedAt: '2026-02-25T00:00:00.000Z',
              prerelease: false,
            },
            {
              id: '1',
              tag: 'v1.0.0',
              title: 'Initial release',
              body: 'First public release.',
              url: 'https://github.com/yusuketakuma/DeadStockSolution/releases/tag/v1.0.0',
              publishedAt: '2026-02-20T00:00:00.000Z',
              prerelease: false,
            },
          ],
        }), {
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

    renderWithProviders(
      <Layout><div>Test Content</div></Layout>
    );

    await waitFor(() => {
      expect(screen.getByText('DeadStockSolution')).toBeInTheDocument();
    });

    const updatesButton = screen.getByRole('button', { name: 'GitHub更新内容を表示' });
    expect(within(updatesButton).getByTestId('updates-trigger-icon')).toBeInTheDocument();

    await user.click(updatesButton);

    await waitFor(() => {
      expect(screen.getByText('アップデート内容')).toBeInTheDocument();
    });
    expect(screen.getByText('v1.1.0')).toBeInTheDocument();
    expect(screen.getByText('Header update popup')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '過去のアップデート履歴' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '過去のアップデート履歴を表示' }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: '過去のアップデート履歴' })).toBeInTheDocument();
    });
    const historyRegion = screen.getByRole('region', { name: '過去のアップデート履歴' });
    expect(within(historyRegion).getByText('v1.0.0')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('/api/updates/github')
      )
    ).toBe(true);

    await user.click(screen.getByRole('button', { name: 'GitHub更新内容を表示' }));
    await user.click(screen.getByRole('button', { name: 'GitHub更新内容を表示' }));

    await waitFor(() => {
      const updatesCalls = fetchMock.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('/api/updates/github')
      ).length;
      expect(updatesCalls).toBeGreaterThanOrEqual(2);
    });
  });

  it('blocks unsafe update links outside github release pages', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/updates/github')) {
        return new Response(JSON.stringify({
          repository: 'yusuketakuma/DeadStockSolution',
          source: 'github_releases',
          stale: false,
          fetchedAt: '2026-02-25T00:00:00.000Z',
          items: [
            {
              id: 'safe-1',
              tag: 'v1.1.0',
              title: 'Safe release',
              body: 'safe body',
              url: 'https://github.com/yusuketakuma/DeadStockSolution/releases/tag/v1.1.0',
              publishedAt: '2026-02-25T00:00:00.000Z',
              prerelease: false,
            },
            {
              id: 'bad-1',
              tag: 'v1.0.9',
              title: 'Suspicious release',
              body: 'bad body',
              url: 'https://evil.example/phish',
              publishedAt: '2026-02-24T00:00:00.000Z',
              prerelease: false,
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Layout><div>Test Content</div></Layout>
    );

    await waitFor(() => {
      expect(screen.getByText('DeadStockSolution')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'GitHub更新内容を表示' }));

    await waitFor(() => {
      expect(screen.getByText(/一部のリンク表示を無効化しました/)).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: /Safe release/ })).toHaveAttribute(
      'href',
      'https://github.com/yusuketakuma/DeadStockSolution/releases/tag/v1.1.0',
    );
    expect(screen.queryByRole('link', { name: /Suspicious release/ })).not.toBeInTheDocument();
  });

  it('shows stale note when updates response is served from cache', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/updates/github')) {
        return new Response(JSON.stringify({
          repository: 'yusuketakuma/DeadStockSolution',
          source: 'github_releases',
          stale: true,
          fetchedAt: '2026-02-25T00:00:00.000Z',
          items: [
            {
              id: '1',
              tag: 'v1.0.0',
              title: 'Initial release',
              body: 'First public release.',
              url: 'https://github.com/yusuketakuma/DeadStockSolution/releases/tag/v1.0.0',
              publishedAt: '2026-02-20T00:00:00.000Z',
              prerelease: false,
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Layout><div>Test Content</div></Layout>
    );

    await waitFor(() => {
      expect(screen.getByText('DeadStockSolution')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'GitHub更新内容を表示' }));

    await waitFor(() => {
      expect(screen.getByText(/キャッシュを表示しています/)).toBeInTheDocument();
    });
  });

  it('renders mobile quick navigation rail in header', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Layout><div>Test Content</div></Layout>
    );

    await waitFor(() => {
      expect(screen.getByText('DeadStockSolution')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('ヘッダークイック導線')).toBeInTheDocument();
  });

  it('shows OpenClaw integration link in admin menu', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockAdminUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Layout><div>Test Content</div></Layout>
    );

    await waitFor(() => {
      expect(screen.getByText('DeadStockSolution')).toBeInTheDocument();
    });
    expect(screen.getByText('OpenClaw連携')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '要望をあげる' })).not.toBeInTheDocument();
  });

  it('renders the sidebar navigation links', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Layout><div>Test Content</div></Layout>
    );

    await waitFor(() => {
      expect(screen.getByText('ダッシュボード')).toBeInTheDocument();
    });
    expect(screen.getAllByText('アップロード').length).toBeGreaterThan(0);
    expect(screen.getByText('デッドストックリスト')).toBeInTheDocument();
    expect(screen.getByText('医薬品使用量リスト')).toBeInTheDocument();
    expect(screen.getByText('在庫参照')).toBeInTheDocument();
    expect(screen.getAllByText('マッチング').length).toBeGreaterThan(0);
    expect(screen.getByText('マッチング一覧')).toBeInTheDocument();
    expect(screen.getByText('交換履歴')).toBeInTheDocument();
    expect(screen.getByText('薬局一覧')).toBeInTheDocument();
  });

  it('shows logout button', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Layout><div>Test Content</div></Layout>
    );

    await waitFor(() => {
      expect(screen.getByText('ログアウト')).toBeInTheDocument();
    });
  });

  it('shows footer disclaimer', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(
      <Layout><div>Test Content</div></Layout>
    );

    await waitFor(() => {
      expect(screen.getByText(/本システムはあくまで業務補助ツール/)).toBeInTheDocument();
    });
  });
});
