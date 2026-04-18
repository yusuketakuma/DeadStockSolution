import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminDrugMasterPage from '../../pages/admin/AdminDrugMasterPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createSyncLog(params: {
  id: number;
  syncType: string;
  status: string;
  sourceDescription: string;
  errorMessage?: string | null;
}) {
  return {
    id: params.id,
    syncType: params.syncType,
    sourceDescription: params.sourceDescription,
    status: params.status,
    itemsProcessed: 10,
    itemsAdded: 2,
    itemsUpdated: 3,
    itemsDeleted: 0,
    errorMessage: params.errorMessage ?? null,
    startedAt: '2026-03-24T10:00:00.000Z',
    completedAt: params.status === 'running' ? null : '2026-03-24T10:01:00.000Z',
  };
}

const sampleDrugMasterItem = {
  id: 1,
  yjCode: '1234567890123',
  drugName: 'ロキソニン錠60mg',
  genericName: 'ロキソプロフェンNa',
  specification: '60mg',
  unit: '錠',
  yakkaPrice: 12.5,
  manufacturer: '第一三共',
  category: '内用薬',
  isListed: true,
  transitionDeadline: null,
  updatedAt: '2026-03-24T09:00:00.000Z',
};

const sampleDrugMasterDetail = {
  ...sampleDrugMasterItem,
  therapeuticCategory: '114',
  listedDate: '2020-01-01',
  deletedDate: null,
  packages: [
    {
      id: 10,
      gs1Code: '14987123456789',
      janCode: '4987123456789',
      hotCode: '123456789',
      packageDescription: '100錠',
      packageQuantity: 100,
      packageUnit: '錠',
      normalizedPackageLabel: '100錠',
    },
  ],
  priceHistory: [
    {
      id: 20,
      yjCode: '1234567890123',
      previousPrice: 10,
      newPrice: 12.5,
      revisionDate: '2026-01-01',
      revisionType: 'price_revision',
    },
  ],
};

describe('AdminDrugMasterPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a single visible master refresh button and updates progress in real time', async () => {
    const user = userEvent.setup();
    const syncLogsResponses = [
      {
        data: [
          createSyncLog({
            id: 1,
            syncType: 'auto',
            status: 'failed',
            sourceDescription: '前回実行',
            errorMessage: '同期がタイムアウトしました',
          }),
        ],
      },
      {
        data: [
          createSyncLog({
            id: 2,
            syncType: 'auto',
            status: 'running',
            sourceDescription: '医薬品マスター自動取得',
          }),
          createSyncLog({
            id: 3,
            syncType: 'package_auto',
            status: 'running',
            sourceDescription: '包装単位自動取得',
          }),
        ],
      },
      {
        data: [
          createSyncLog({
            id: 4,
            syncType: 'auto',
            status: 'success',
            sourceDescription: '医薬品マスター自動取得',
          }),
          createSyncLog({
            id: 5,
            syncType: 'package_auto',
            status: 'success',
            sourceDescription: '包装単位自動取得',
          }),
        ],
      },
    ];
    let syncLogsCallCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return jsonResponse({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return jsonResponse({ unreadCount: 0 });
      }
      if (url.includes('/api/admin/drug-master/stats')) {
        return jsonResponse({
          totalItems: 100,
          listedItems: 80,
          transitionItems: 10,
          delistedItems: 10,
          lastSyncAt: '2026-03-24T09:00:00.000Z',
        });
      }
      if (url.includes('/api/admin/drug-master/sync-logs')) {
        const response = syncLogsResponses[Math.min(syncLogsCallCount, syncLogsResponses.length - 1)];
        syncLogsCallCount += 1;
        return jsonResponse(response);
      }
      if (url.includes('/api/admin/drug-master/auto-sync/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'mhlw.go.jp',
          hasSourceUrl: false,
          checkIntervalHours: 6,
          supportsManualUrlOverride: false,
          sourceMode: 'index',
        });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/packages/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'pmda.go.jp',
          hasSourceUrl: true,
          checkIntervalHours: 24,
          supportsManualUrlOverride: false,
        });
      }
      if (url.includes('/api/admin/drug-master/master-refresh')) {
        return jsonResponse({
          triggered: true,
          message: 'マスター更新を開始しました。進捗と更新ログを確認してください。',
          steps: [
            { key: 'drug-master', label: '医薬品マスター本体', triggered: true, message: '開始しました' },
            { key: 'package-master', label: '包装単位データ', triggered: true, message: '開始しました' },
          ],
        });
      }
      if (url.includes('/api/admin/drug-master?')) {
        return jsonResponse({
          data: [],
          pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminDrugMasterPage />, { authUser: mockAdminUser });

    await waitFor(() => {
      expect(screen.getByText('医薬品マスター管理')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'マスター更新' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '同期実行' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登録実行' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'マスター更新' }));

    await waitFor(() => {
      expect(screen.getByText('更新中は2秒ごとに進捗と更新ログを自動更新します。')).toBeInTheDocument();
    });
    expect(screen.getAllByText('更新中').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('医薬品マスター自動取得')).toBeInTheDocument();
    expect(screen.getByText('包装単位自動取得')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('完了').length).toBeGreaterThanOrEqual(2);
    }, { timeout: 4000 });
    expect(screen.getByText('マスター更新を開始しました。進捗と更新ログを確認してください。')).toBeInTheDocument();
    expect(syncLogsCallCount).toBeGreaterThanOrEqual(3);
  });

  it('keeps manual maintenance hidden until expanded', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return jsonResponse({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return jsonResponse({ unreadCount: 0 });
      }
      if (url.includes('/api/admin/drug-master/stats')) {
        return jsonResponse({
          totalItems: 100,
          listedItems: 80,
          transitionItems: 10,
          delistedItems: 10,
          lastSyncAt: '2026-03-24T09:00:00.000Z',
        });
      }
      if (url.includes('/api/admin/drug-master/sync-logs')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'mhlw.go.jp',
          hasSourceUrl: false,
          checkIntervalHours: 6,
          supportsManualUrlOverride: false,
          sourceMode: 'index',
        });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/packages/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'pmda.go.jp',
          hasSourceUrl: true,
          checkIntervalHours: 24,
          supportsManualUrlOverride: false,
        });
      }
      if (url.includes('/api/admin/drug-master?')) {
        return jsonResponse({
          data: [],
          pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderWithProviders(<AdminDrugMasterPage />, { authUser: mockAdminUser });

    await waitFor(() => {
      expect(screen.getByText('手動メンテナンス')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '同期実行' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登録実行' })).not.toBeInTheDocument();

    await user.click(screen.getByText('手動メンテナンス'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '同期実行' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '登録実行' })).toBeInTheDocument();
  });

  it('hydrates the URL search query and refetches when filters change', async () => {
    const user = userEvent.setup();
    const listRequestUrls: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return jsonResponse({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return jsonResponse({ unreadCount: 0 });
      }
      if (url.includes('/api/admin/drug-master/stats')) {
        return jsonResponse({
          totalItems: 100,
          listedItems: 80,
          transitionItems: 10,
          delistedItems: 10,
          lastSyncAt: '2026-03-24T09:00:00.000Z',
        });
      }
      if (url.includes('/api/admin/drug-master/sync-logs')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'mhlw.go.jp',
          hasSourceUrl: false,
          checkIntervalHours: 6,
          supportsManualUrlOverride: false,
          sourceMode: 'index',
        });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/packages/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'pmda.go.jp',
          hasSourceUrl: true,
          checkIntervalHours: 24,
          supportsManualUrlOverride: false,
        });
      }
      if (url.includes('/api/admin/drug-master?')) {
        listRequestUrls.push(url);
        return jsonResponse({
          data: [],
          pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminDrugMasterPage />, {
      authUser: mockAdminUser,
      route: '/admin/drug-master?search=ロキソ',
    });

    await waitFor(() => {
      const searchInputs = screen.getAllByPlaceholderText('品名・成分名・メーカー・YJコードで検索');
      expect(searchInputs[0]).toHaveValue('ロキソ');
    });
    await waitFor(() => {
      expect(listRequestUrls.some((url) => url.includes('search=%E3%83%AD%E3%82%AD%E3%82%BD'))).toBe(true);
    });

    await user.selectOptions(screen.getByLabelText('ステータスで絞り込み'), 'listed');

    await waitFor(() => {
      expect(listRequestUrls.some((url) =>
        url.includes('search=%E3%83%AD%E3%82%AD%E3%82%BD') && url.includes('status=listed'))).toBe(true);
    });

    await user.selectOptions(screen.getByLabelText('区分で絞り込み'), '内用薬');

    await waitFor(() => {
      expect(listRequestUrls.some((url) =>
        url.includes('status=listed') && url.includes('category=%E5%86%85%E7%94%A8%E8%96%AC'))).toBe(true);
    });
  });

  it('resets pagination to page 1 when a filter changes', async () => {
    const user = userEvent.setup();
    const listRequestUrls: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return jsonResponse({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return jsonResponse({ unreadCount: 0 });
      }
      if (url.includes('/api/admin/drug-master/stats')) {
        return jsonResponse({
          totalItems: 100,
          listedItems: 80,
          transitionItems: 10,
          delistedItems: 10,
          lastSyncAt: '2026-03-24T09:00:00.000Z',
        });
      }
      if (url.includes('/api/admin/drug-master/sync-logs')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'mhlw.go.jp',
          hasSourceUrl: false,
          checkIntervalHours: 6,
          supportsManualUrlOverride: false,
          sourceMode: 'index',
        });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/packages/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'pmda.go.jp',
          hasSourceUrl: true,
          checkIntervalHours: 24,
          supportsManualUrlOverride: false,
        });
      }
      if (url.includes('/api/admin/drug-master?')) {
        listRequestUrls.push(url);
        const page = Number(new URL(url, 'https://dead-stock-solution.test').searchParams.get('page') ?? '1');
        return jsonResponse({
          data: [sampleDrugMasterItem],
          pagination: { page, limit: 100, total: 3, totalPages: 3 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminDrugMasterPage />, {
      authUser: mockAdminUser,
      route: '/admin/drug-master?search=ロキソ',
    });

    await screen.findByRole('button', { name: 'ページ 2' });
    await user.click(screen.getByRole('button', { name: 'ページ 2' }));

    await waitFor(() => {
      expect(listRequestUrls.some((url) => url.includes('page=2'))).toBe(true);
    });

    await user.selectOptions(screen.getByLabelText('ステータスで絞り込み'), 'listed');

    await waitFor(() => {
      expect(listRequestUrls.some((url) =>
        url.includes('page=1') && url.includes('status=listed'))).toBe(true);
    });
  });

  it('runs manual sync and refreshes dependent data', async () => {
    const user = userEvent.setup();
    const syncUrls: string[] = [];
    let statsCalls = 0;
    let logsCalls = 0;
    let listCalls = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return jsonResponse({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return jsonResponse({ unreadCount: 0 });
      }
      if (url.includes('/api/admin/drug-master/stats')) {
        statsCalls += 1;
        return jsonResponse({
          totalItems: 100,
          listedItems: 80,
          transitionItems: 10,
          delistedItems: 10,
          lastSyncAt: '2026-03-24T09:00:00.000Z',
        });
      }
      if (url.includes('/api/admin/drug-master/sync-logs')) {
        logsCalls += 1;
        return jsonResponse({ data: [] });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'mhlw.go.jp',
          hasSourceUrl: false,
          checkIntervalHours: 6,
          supportsManualUrlOverride: false,
          sourceMode: 'index',
        });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/packages/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'pmda.go.jp',
          hasSourceUrl: true,
          checkIntervalHours: 24,
          supportsManualUrlOverride: false,
        });
      }
      if (url.includes('/api/admin/drug-master/sync')) {
        syncUrls.push(url);
        expect(init?.method).toBe('POST');
        return jsonResponse({
          message: 'ok',
          result: {
            itemsProcessed: 12,
            itemsAdded: 3,
            itemsUpdated: 4,
            itemsDeleted: 1,
          },
        });
      }
      if (url.includes('/api/admin/drug-master?')) {
        listCalls += 1;
        return jsonResponse({
          data: [],
          pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderWithProviders(<AdminDrugMasterPage />, { authUser: mockAdminUser });

    await user.click(await screen.findByText('手動メンテナンス'));

    const syncInput = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    await user.upload(syncInput, new File(['dummy'], 'drug-master.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: '同期実行' }));

    await waitFor(() => {
      expect(screen.getByText('同期完了: 処理 12件 / 追加 3件 / 更新 4件 / 削除 1件')).toBeInTheDocument();
    });
    expect(syncUrls).toHaveLength(1);
    expect(statsCalls).toBeGreaterThanOrEqual(2);
    expect(logsCalls).toBeGreaterThanOrEqual(2);
    expect(listCalls).toBeGreaterThanOrEqual(2);
  });

  it('runs package upload and refreshes sync logs', async () => {
    const user = userEvent.setup();
    const uploadUrls: string[] = [];
    let logsCalls = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return jsonResponse({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return jsonResponse({ unreadCount: 0 });
      }
      if (url.includes('/api/admin/drug-master/stats')) {
        return jsonResponse({
          totalItems: 100,
          listedItems: 80,
          transitionItems: 10,
          delistedItems: 10,
          lastSyncAt: '2026-03-24T09:00:00.000Z',
        });
      }
      if (url.includes('/api/admin/drug-master/sync-logs')) {
        logsCalls += 1;
        return jsonResponse({ data: [] });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'mhlw.go.jp',
          hasSourceUrl: false,
          checkIntervalHours: 6,
          supportsManualUrlOverride: false,
          sourceMode: 'index',
        });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/packages/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'pmda.go.jp',
          hasSourceUrl: true,
          checkIntervalHours: 24,
          supportsManualUrlOverride: false,
        });
      }
      if (url.includes('/api/admin/drug-master/upload-packages')) {
        uploadUrls.push(url);
        expect(init?.method).toBe('POST');
        return jsonResponse({
          message: 'ok',
          result: {
            added: 5,
            updated: 7,
          },
        });
      }
      if (url.includes('/api/admin/drug-master?')) {
        return jsonResponse({
          data: [],
          pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderWithProviders(<AdminDrugMasterPage />, { authUser: mockAdminUser });

    await user.click(await screen.findByText('手動メンテナンス'));

    const packageInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    await user.upload(packageInput, new File(['zip'], 'packages.zip', { type: 'application/zip' }));
    await user.click(screen.getByRole('button', { name: '登録実行' }));

    await waitFor(() => {
      expect(screen.getByText('包装単位登録完了: 追加 5件 / 更新 7件')).toBeInTheDocument();
    });
    expect(uploadUrls).toHaveLength(1);
    expect(logsCalls).toBeGreaterThanOrEqual(2);
  });

  it('opens the detail modal with fetched detail data', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return jsonResponse({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return jsonResponse({ unreadCount: 0 });
      }
      if (url.includes('/api/admin/drug-master/stats')) {
        return jsonResponse({
          totalItems: 100,
          listedItems: 80,
          transitionItems: 10,
          delistedItems: 10,
          lastSyncAt: '2026-03-24T09:00:00.000Z',
        });
      }
      if (url.includes('/api/admin/drug-master/sync-logs')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'mhlw.go.jp',
          hasSourceUrl: false,
          checkIntervalHours: 6,
          supportsManualUrlOverride: false,
          sourceMode: 'index',
        });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/packages/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'pmda.go.jp',
          hasSourceUrl: true,
          checkIntervalHours: 24,
          supportsManualUrlOverride: false,
        });
      }
      if (url.includes('/api/admin/drug-master/detail/1234567890123')) {
        return jsonResponse(sampleDrugMasterDetail);
      }
      if (url.includes('/api/admin/drug-master?')) {
        return jsonResponse({
          data: [sampleDrugMasterItem],
          pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminDrugMasterPage />, { authUser: mockAdminUser });

    await user.click(await screen.findByRole('button', { name: 'ロキソニン錠60mg' }));

    await waitFor(() => {
      expect(screen.getByText('医薬品詳細')).toBeInTheDocument();
    });
    expect(screen.getByText('14987123456789')).toBeInTheDocument();
    expect(screen.getByText('薬価改定')).toBeInTheDocument();
  });

  it('opens the edit modal and saves edited values', async () => {
    const user = userEvent.setup();
    const putBodies: Array<Record<string, unknown>> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return jsonResponse({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return jsonResponse({ unreadCount: 0 });
      }
      if (url.includes('/api/admin/drug-master/stats')) {
        return jsonResponse({
          totalItems: 100,
          listedItems: 80,
          transitionItems: 10,
          delistedItems: 10,
          lastSyncAt: '2026-03-24T09:00:00.000Z',
        });
      }
      if (url.includes('/api/admin/drug-master/sync-logs')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'mhlw.go.jp',
          hasSourceUrl: false,
          checkIntervalHours: 6,
          supportsManualUrlOverride: false,
          sourceMode: 'index',
        });
      }
      if (url.includes('/api/admin/drug-master/auto-sync/packages/status')) {
        return jsonResponse({
          enabled: true,
          sourceHost: 'pmda.go.jp',
          hasSourceUrl: true,
          checkIntervalHours: 24,
          supportsManualUrlOverride: false,
        });
      }
      if (url.includes('/api/admin/drug-master/detail/1234567890123') && (!init?.method || init.method === 'GET')) {
        return jsonResponse(sampleDrugMasterDetail);
      }
      if (url.includes('/api/admin/drug-master/detail/1234567890123') && init?.method === 'PUT') {
        putBodies.push(JSON.parse(String(init.body)));
        return jsonResponse({ message: 'ok' });
      }
      if (url.includes('/api/admin/drug-master?')) {
        return jsonResponse({
          data: [sampleDrugMasterItem],
          pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminDrugMasterPage />, { authUser: mockAdminUser });

    await user.click(await screen.findByRole('button', { name: '編集' }));

    await waitFor(() => {
      expect(screen.getByText('医薬品情報の編集')).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText('品名');
    await user.clear(nameInput);
    await user.type(nameInput, 'ロキソニン錠60mg 改');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('医薬品情報を更新しました')).toBeInTheDocument();
    });
    expect(putBodies).toEqual([
      expect.objectContaining({
        drugName: 'ロキソニン錠60mg 改',
        genericName: 'ロキソプロフェンNa',
      }),
    ]);
  });
});
