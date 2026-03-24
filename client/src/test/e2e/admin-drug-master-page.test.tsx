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
});
