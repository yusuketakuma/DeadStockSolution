import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByText('医薬品使用量リストをアップロード')).toBeInTheDocument();
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
    expect(screen.getByText('v2026.2.25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '要望をあげる' })).toBeInTheDocument();
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
