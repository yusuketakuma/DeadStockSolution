import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AlertListPage from '../pages/AlertListPage';
import { renderWithProviders, setupFetchMock } from './helpers';

// ── テスト用データ ──────────────────────────────────────
function makeAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    pharmacyId: 10,
    alertType: 'near_expiry',
    title: '期限切迫在庫の予兆があります',
    message: '5件の在庫が45日以内に期限到来予定です。',
    detailJson: {
      affectedItems: [
        { drugName: 'ロキソプロフェン', quantity: 100, expiryDate: '2026-04-01', estimatedLoss: 5000 },
      ],
      totalEstimatedLoss: 5000,
      earliestExpiry: '2026-04-01',
    },
    detectedAt: '2026-03-01T00:00:00Z',
    resolvedAt: null,
    notificationId: null,
    ...overrides,
  };
}

const mockAlertList = {
  alerts: [
    makeAlert({ id: 1, alertType: 'near_expiry', title: '期限切迫在庫の予兆があります' }),
    makeAlert({ id: 2, alertType: 'excess_stock', title: '過剰在庫の予兆があります' }),
  ],
  total: 2,
  offset: 0,
  limit: 20,
  unresolvedCount: 2,
};

const mockAlertStats = {
  unresolvedCount: 2,
  byType: { near_expiry: 1, excess_stock: 1 },
};

const mockResolvedList = {
  alerts: [
    makeAlert({ id: 10, resolvedAt: '2026-03-05T00:00:00Z', title: '解決済みアラート' }),
  ],
  total: 1,
  offset: 0,
  limit: 20,
  unresolvedCount: 0,
};

// ── ヘルパー ──────────────────────────────────────
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/alerts']}>
      <AlertListPage />
    </MemoryRouter>,
  );
}

// ── テスト ──────────────────────────────────────
describe('AlertListPage', () => {
  let mockFetch: ReturnType<typeof setupFetchMock>;

  beforeEach(() => {
    mockFetch = setupFetchMock({
      '/api/alerts/stats': mockAlertStats,
      '/api/alerts?': mockAlertList,
      '/api/auth/me': { id: 1, email: 'test@example.com', name: 'テスト薬局' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('アラート一覧のタイトルが表示される', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('アラート一覧')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'アップロード品質' })).toHaveAttribute('href', '/upload-quality');
  });

  it('アラートカードが表示される', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('期限切迫在庫の予兆があります')).toBeInTheDocument();
      expect(screen.getByText('過剰在庫の予兆があります')).toBeInTheDocument();
    });
  });

  it('アラートタイプのバッジが表示される', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('期限切迫')).toBeInTheDocument();
      expect(screen.getByText('過剰在庫')).toBeInTheDocument();
    });
  });

  it('未解決/解決済みのフィルタータブがある', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /未解決/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /解決済み/ })).toBeInTheDocument();
    });
  });

  it('解決済みタブ切替でAPIが再取得される', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /解決済み/ })).toBeInTheDocument();
    });

    // 解決済みタブをクリック
    const resolvedTab = screen.getByRole('tab', { name: /解決済み/ });

    // Intercept to return resolved list
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/alerts') && url.includes('resolved=true')) {
        return new Response(JSON.stringify(mockResolvedList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/alerts/stats')) {
        return new Response(JSON.stringify(mockAlertStats), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/alerts')) {
        return new Response(JSON.stringify(mockAlertList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    await user.click(resolvedTab);

    await waitFor(() => {
      const calls = mockFetch.mock.calls.map(([url]) =>
        typeof url === 'string' ? url : url.toString()
      );
      expect(calls.some((u: string) => u.includes('resolved=true'))).toBe(true);
    });
  });

  it('解決ボタンクリックでPATCHリクエストが送信される', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '解決' }).length).toBeGreaterThan(0);
    });

    // Mock the resolve endpoint
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/alerts/') && url.includes('/resolve') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ ...makeAlert({ id: 1, resolvedAt: new Date().toISOString() }) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/alerts/stats')) {
        return new Response(JSON.stringify(mockAlertStats), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/alerts')) {
        return new Response(JSON.stringify(mockAlertList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const resolveButtons = screen.getAllByRole('button', { name: '解決' });
    await user.click(resolveButtons[0]);

    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const patchCall = calls.find(
        (call: [input: URL | RequestInfo, _init?: RequestInit | undefined]) => {
          const u = typeof call[0] === 'string' ? call[0] : call[0].toString();
          return u.includes('/resolve') && call[1]?.method === 'PATCH';
        }
      );
      expect(patchCall).toBeDefined();
    });
  });

  it('詳細ボタンクリックでモーダルが開く', async () => {
    const user = userEvent.setup();

    // Override mock for detail endpoint
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/alerts/stats')) {
        return new Response(JSON.stringify(mockAlertStats), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.match(/\/api\/alerts\/\d+$/)) {
        return new Response(JSON.stringify(makeAlert({ id: 1 })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/alerts')) {
        return new Response(JSON.stringify(mockAlertList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '詳細' }).length).toBeGreaterThan(0);
    });

    const detailButtons = screen.getAllByRole('button', { name: '詳細' });
    await user.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('アラート詳細')).toBeInTheDocument();
    });
  });

  it('details modal links matching from the alert detail footer', async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/alerts/stats')) {
        return new Response(JSON.stringify(mockAlertStats), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.match(/\/api\/alerts\/\d+$/)) {
        return new Response(JSON.stringify(makeAlert({ id: 1 })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/alerts')) {
        return new Response(JSON.stringify(mockAlertList), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '詳細' }).length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole('button', { name: '詳細' })[0]);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'マッチングを見る' })).toHaveAttribute('href', '/matching');
    });
  });

  it('ローディング中はスピナーが表示される', () => {
    // fetch never resolves
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('エラー時にエラーメッセージが表示される', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ネットワークエラーが発生しました');
    }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/エラー|失敗/)).toBeInTheDocument();
    });
  });

  it('アラートタイプフィルター選択でAPIパラメータが変わる', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('期限切迫在庫の予兆があります')).toBeInTheDocument();
    });

    // Find type filter dropdown/button
    const typeFilterButton = screen.getByRole('combobox', { name: /タイプ/ });
    await user.selectOptions(typeFilterButton, 'near_expiry');

    await waitFor(() => {
      const calls = mockFetch.mock.calls.map(([url]) =>
        typeof url === 'string' ? url : url.toString()
      );
      expect(calls.some((u: string) => u.includes('type=near_expiry'))).toBe(true);
    });
  });
});

// ── DashboardPage アラートウィジェットテスト ──────────────────
describe('DashboardPage alert widget', () => {

  beforeEach(() => {
    setupFetchMock({
      '/api/alerts/stats': mockAlertStats,
      '/api/auth/me': { id: 1, email: 'test@example.com', name: 'テスト薬局', prefecture: '東京都', isAdmin: false },
      '/api/upload/status': { deadStockUploaded: true, usedMedicationUploaded: true },
      '/api/inventory/dead-stock/risk': {
        totalItems: 10,
        riskScore: 5.0,
        bucketCounts: { expired: 2, within30: 3, within60: 1, within90: 1, within120: 1, over120: 2, unknown: 0 },
        computedAt: '2026-03-01T00:00:00Z',
      },
      '/api/timeline': { events: [], total: 0 },
      '/api/timeline/bootstrap': { events: [], total: 0, unreadCount: 0 },
      '/api/timeline/unread-count': { count: 0 },
      '/api/alerts?': { alerts: [makeAlert()], total: 1, offset: 0, limit: 1, unresolvedCount: 3 },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('アラートウィジェットが表示される', async () => {
    const { default: DashboardPage } = await import('../pages/DashboardPage');
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('予兆アラート')).toBeInTheDocument();
    });
  });

  it('未解決アラート数が表示される', async () => {
    const { default: DashboardPage } = await import('../pages/DashboardPage');
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('未解決アラート')).toBeInTheDocument();
    });
  });

  it('全て見るリンクが /alerts を指す', async () => {
    const { default: DashboardPage } = await import('../pages/DashboardPage');
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      const link = screen.getByRole('link', { name: /全て見る/ });
      expect(link).toHaveAttribute('href', '/alerts');
    });
  });

  it('does not render stale no_movement chips in the dashboard alert widget', async () => {
    setupFetchMock({
      '/api/alerts/stats': { unresolvedCount: 3, byType: { near_expiry: 1, excess_stock: 1, no_movement: 1 } },
      '/api/auth/me': { id: 1, email: 'test@example.com', name: 'テスト薬局', prefecture: '東京都', isAdmin: false },
      '/api/upload/status': { deadStockUploaded: true, usedMedicationUploaded: true },
      '/api/inventory/dead-stock/risk': {
        totalItems: 10,
        riskScore: 5.0,
        bucketCounts: { expired: 2, within30: 3, within60: 1, within90: 1, within120: 1, over120: 2, unknown: 0 },
        computedAt: '2026-03-01T00:00:00Z',
      },
      '/api/timeline': { events: [], total: 0 },
      '/api/timeline/bootstrap': { events: [], total: 0, unreadCount: 0 },
      '/api/timeline/unread-count': { count: 0 },
      '/api/alerts?': { alerts: [makeAlert()], total: 1, offset: 0, limit: 1, unresolvedCount: 3 },
    });

    const { default: DashboardPage } = await import('../pages/DashboardPage');
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('期限切迫 1')).toBeInTheDocument();
    });

    expect(screen.getByText('過剰在庫 1')).toBeInTheDocument();
    expect(screen.queryByText('不動在庫 1')).not.toBeInTheDocument();
  });
});
