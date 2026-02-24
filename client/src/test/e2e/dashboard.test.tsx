import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import DashboardPage from '../../pages/DashboardPage';
import Layout from '../../components/Layout';
import { renderWithProviders, mockUser } from '../helpers';

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
      expect(screen.getByText('不動在庫')).toBeInTheDocument();
    });
    expect(screen.getByText('使用薬剤')).toBeInTheDocument();
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
      expect(screen.getByText('不動在庫の交換先を検索できます')).toBeInTheDocument();
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
    expect(screen.getByText('アップロード')).toBeInTheDocument();
    expect(screen.getByText('不動在庫')).toBeInTheDocument();
    expect(screen.getByText('使用薬剤')).toBeInTheDocument();
    expect(screen.getByText('在庫参照')).toBeInTheDocument();
    expect(screen.getByText('マッチング')).toBeInTheDocument();
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
