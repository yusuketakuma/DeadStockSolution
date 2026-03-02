import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from '../../pages/DashboardPage';
import Layout from '../../components/Layout';
import { renderWithProviders, mockAdminUser, mockUser } from '../helpers';

const emptyTimeline = {
  events: [],
  total: 0,
  limit: 20,
  hasMore: false,
  nextCursor: null,
};

const emptyDigest = { events: [] };
const emptyBootstrap = {
  timeline: emptyTimeline,
  digest: emptyDigest,
  unreadCount: 0,
};

function mockAuthenticatedFetchWithDashboardData(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    '/api/auth/me': mockUser,
    '/api/upload/status': {
      deadStockUploaded: true,
      usedMedicationUploaded: false,
      lastDeadStockUpload: '2026-01-15T10:00:00Z',
      lastUsedMedicationUpload: null,
    },
    '/api/timeline/bootstrap': emptyBootstrap,
    '/api/timeline/unread-count': { unreadCount: 0 },
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

  it('shows SmartDigest section', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('今日のアクション')).toBeInTheDocument();
    });
  });

  it('shows DashboardTimeline section', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('タイムライン')).toBeInTheDocument();
    });
  });

  it('shows upload guidance when digest events are empty and monthly upload is missing', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('医薬品使用量リストをアップロード')).toBeInTheDocument();
    });
  });

  it('shows empty timeline message when no timeline events', async () => {
    mockAuthenticatedFetchWithDashboardData();
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('タイムラインにイベントはありません')).toBeInTheDocument();
    });
  });

  it('shows digest events from timeline API', async () => {
    mockAuthenticatedFetchWithDashboardData({
      '/api/timeline/bootstrap': {
        timeline: emptyTimeline,
        digest: {
          events: [
            {
              id: 'evt-1',
              source: 'notification',
              type: 'inbound_request',
              title: '交換提案が届いています',
              body: 'テスト薬局2号店から交換提案',
              timestamp: '2026-01-20T10:00:00Z',
              priority: 'critical',
              isRead: false,
              actionPath: '/proposals/1',
            },
          ],
        },
        unreadCount: 0,
      },
    });
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('交換提案が届いています')).toBeInTheDocument();
    });
    expect(screen.getAllByText('緊急').length).toBeGreaterThan(0);
  });

  it('shows timeline events from timeline API', async () => {
    mockAuthenticatedFetchWithDashboardData({
      '/api/timeline/bootstrap': {
        timeline: {
          events: [
            {
              id: 'evt-2',
              source: 'match',
              type: 'match_update',
              title: '候補が更新されました',
              body: '追加 1 / 除外 0',
              timestamp: '2026-02-25T12:00:00.000Z',
              priority: 'medium',
              isRead: false,
              actionPath: '/matching',
            },
          ],
          total: 1,
          limit: 20,
          hasMore: false,
          nextCursor: null,
        },
        digest: emptyDigest,
        unreadCount: 0,
      },
    });
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('候補が更新されました')).toBeInTheDocument();
    });
  });

  it('keeps showing risk panel when upload status fails', async () => {
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
      if (url.includes('/api/timeline/bootstrap')) {
        return new Response(JSON.stringify(emptyBootstrap), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/timeline')) {
        return new Response(JSON.stringify(emptyTimeline), {
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
      expect(screen.getByText('期限切れリスク（自薬局）')).toBeInTheDocument();
    });
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
      expect(screen.getByText('交換先を検索できます')).toBeInTheDocument();
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
    expect(document.querySelector('.app-header-version')).not.toBeNull();
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
    expect(updatesButton).toBeInTheDocument();

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
    expect(historyRegion).toBeInTheDocument();
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
