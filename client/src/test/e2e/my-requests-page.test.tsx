import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyRequestsPage from '../../pages/MyRequestsPage';
import { mockUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MyRequestsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows past requests with workflow status badges', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        return jsonResponse({
          data: [
            {
              id: 31,
              requestText: '在庫一覧の検索を改善してほしい',
              openclawStatus: 'in_dialogue',
              openclawThreadId: 'thread-31',
              openclawSummary: '再現条件を確認中です',
              workflowStatus: 'awaiting_user',
              latestSummary: '追加情報待ち',
              branchName: null,
              prUrl: null,
              prNumber: null,
              updatedAt: '2026-03-23T10:00:00.000Z',
              createdAt: '2026-03-23T09:00:00.000Z',
            },
            {
              id: 32,
              requestText: '帳票出力の不具合を直してほしい',
              openclawStatus: 'completed',
              openclawThreadId: 'thread-32',
              openclawSummary: '修正済みです',
              workflowStatus: 'completed',
              latestSummary: 'PRを反映済み',
              branchName: 'dss/request-20260323-report-fix',
              prUrl: 'https://github.com/example/repo/pull/32',
              prNumber: 32,
              updatedAt: '2026-03-23T11:00:00.000Z',
              createdAt: '2026-03-23T08:30:00.000Z',
            },
          ],
        });
      }
      if (url.includes('/api/requests/31/messages')) {
        return jsonResponse({
          request: {
            id: 31,
            requestText: '在庫一覧の検索を改善してほしい',
            openclawStatus: 'in_dialogue',
            openclawThreadId: 'thread-31',
            openclawSummary: '再現条件を確認中です',
            workflowStatus: 'awaiting_user',
            latestSummary: '追加情報待ち',
            branchName: null,
            prUrl: null,
            prNumber: null,
            updatedAt: '2026-03-23T10:00:00.000Z',
            createdAt: '2026-03-23T09:00:00.000Z',
          },
          messages: [
            { id: 1, authorType: 'user', messageType: 'message', body: '在庫一覧の検索を改善してほしい', createdAt: '2026-03-23T09:00:00.000Z', metadata: null },
            { id: 2, authorType: 'openclaw_agent', messageType: 'question', body: 'どの検索語で期待通りに動きませんか？', createdAt: '2026-03-23T10:00:00.000Z', metadata: null },
          ],
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />);

    await waitFor(() => {
      expect(screen.getByText('ユーザーリクエストとバグ報告')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('要望 #31')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'メッセージを確認' })).toHaveAttribute('href', '/messages');
    expect(screen.getAllByText('回答待ち').length).toBeGreaterThan(0);
    expect(screen.getByText('完了')).toBeInTheDocument();
    expect(screen.getAllByText('在庫一覧の検索を改善してほしい').length).toBeGreaterThan(0);
  });

  it('preselects the request thread from the requestId query parameter', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        return jsonResponse({
          data: [
            {
              id: 61,
              requestText: '旧要望',
              openclawStatus: 'queued',
              openclawThreadId: 'thread-61',
              openclawSummary: '受付済みです',
              workflowStatus: 'queued',
              latestSummary: '受付済みです',
              branchName: null,
              prUrl: null,
              prNumber: null,
              updatedAt: '2026-03-23T10:00:00.000Z',
              createdAt: '2026-03-23T09:00:00.000Z',
            },
            {
              id: 62,
              requestText: '通知から開きたい要望',
              openclawStatus: 'in_dialogue',
              openclawThreadId: 'thread-62',
              openclawSummary: '追加情報を確認中です',
              workflowStatus: 'awaiting_user',
              latestSummary: 'スクリーンショット待ち',
              branchName: null,
              prUrl: null,
              prNumber: null,
              updatedAt: '2026-03-23T11:00:00.000Z',
              createdAt: '2026-03-23T09:30:00.000Z',
            },
          ],
        });
      }
      if (url.includes('/api/requests/62/messages')) {
        return jsonResponse({
          request: {
            id: 62,
            requestText: '通知から開きたい要望',
            openclawStatus: 'in_dialogue',
            openclawThreadId: 'thread-62',
            openclawSummary: '追加情報を確認中です',
            workflowStatus: 'awaiting_user',
            latestSummary: 'スクリーンショット待ち',
            branchName: null,
            prUrl: null,
            prNumber: null,
            updatedAt: '2026-03-23T11:00:00.000Z',
            createdAt: '2026-03-23T09:30:00.000Z',
          },
          messages: [
            { id: 10, authorType: 'user', messageType: 'message', body: '通知から開きたい要望', createdAt: '2026-03-23T09:30:00.000Z', metadata: null },
            { id: 11, authorType: 'openclaw_agent', messageType: 'question', body: '追加情報を送ってください', createdAt: '2026-03-23T11:00:00.000Z', metadata: null },
          ],
        });
      }
      if (url.includes('/api/requests/61/messages')) {
        return jsonResponse({
          request: {
            id: 61,
            requestText: '旧要望',
            openclawStatus: 'queued',
            openclawThreadId: 'thread-61',
            openclawSummary: '受付済みです',
            workflowStatus: 'queued',
            latestSummary: '受付済みです',
            branchName: null,
            prUrl: null,
            prNumber: null,
            updatedAt: '2026-03-23T10:00:00.000Z',
            createdAt: '2026-03-23T09:00:00.000Z',
          },
          messages: [],
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />, { route: '/requests?requestId=62' });

    await waitFor(() => {
      expect(screen.getByText('通知から開きたい要望')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('追加情報を送ってください')).toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.some(([request]) => String(request).includes('/api/requests/62/messages'))).toBe(true);
    expect(fetchMock.mock.calls.some(([request]) => String(request).includes('/api/requests/61/messages'))).toBe(false);
  });

  it('shows a filter-specific empty state when no requests match the selected queue view', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        return jsonResponse({
          data: [
            {
              id: 35,
              requestText: '通知設定の初期値を見直してほしい',
              category: 'improvement',
              priority: 'normal',
              closeReason: null,
              assignedAdminId: null,
              assignedAdminName: null,
              requesterLastViewedAt: null,
              adminLastViewedAt: null,
              latestUserMessageAt: '2026-03-23T09:00:00.000Z',
              latestStaffMessageAt: null,
              openclawStatus: 'queued',
              openclawThreadId: 'thread-35',
              openclawSummary: '受付済みです',
              workflowStatus: 'queued',
              latestSummary: '受付済みです',
              branchName: null,
              prUrl: null,
              prNumber: null,
              updatedAt: '2026-03-23T09:30:00.000Z',
              createdAt: '2026-03-23T09:00:00.000Z',
              hasUnread: false,
              waitingOn: 'openclaw',
              isOverdue: false,
            },
          ],
        });
      }
      if (url.includes('/api/requests/35/messages')) {
        return jsonResponse({
          request: {
            id: 35,
            requestText: '通知設定の初期値を見直してほしい',
            category: 'improvement',
            priority: 'normal',
            closeReason: null,
            assignedAdminId: null,
            assignedAdminName: null,
            requesterLastViewedAt: null,
            adminLastViewedAt: null,
            latestUserMessageAt: '2026-03-23T09:00:00.000Z',
            latestStaffMessageAt: null,
            openclawStatus: 'queued',
            openclawThreadId: 'thread-35',
            openclawSummary: '受付済みです',
            workflowStatus: 'queued',
            latestSummary: '受付済みです',
            branchName: null,
            prUrl: null,
            prNumber: null,
            updatedAt: '2026-03-23T09:30:00.000Z',
            createdAt: '2026-03-23T09:00:00.000Z',
            hasUnread: false,
            waitingOn: 'openclaw',
            isOverdue: false,
          },
          messages: [],
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />);

    await waitFor(() => {
      expect(screen.getByText('要望 #35')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('元の要望: 通知設定の初期値を見直してほしい')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '定型文を挿入' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再催促する' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '操作中にエラーが発生しました。再現手順は次のとおりです。' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '定型文を挿入' }));
    expect(screen.getByRole('button', { name: '操作中にエラーが発生しました。再現手順は次のとおりです。' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'その他' }));
    expect(screen.getByRole('button', { name: '再催促する' })).toBeInTheDocument();

    const queueFilter = screen.getByRole('combobox', { name: '表示する要望' });
    expect(screen.queryByRole('button', { name: /未読あり 0/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(queueFilter, 'unread');

    await waitFor(() => {
      expect(screen.getByText('現在の絞り込み条件に一致する要望はありません。')).toBeInTheDocument();
    });

    expect(screen.queryByText('送信済みの要望はまだありません。')).not.toBeInTheDocument();
  });

  it('sends additional information for an existing request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        return jsonResponse({
          data: [
            {
              id: 41,
              requestText: '検索条件の保持を改善してほしい',
              openclawStatus: 'in_dialogue',
              openclawThreadId: 'thread-41',
              openclawSummary: '追加情報待ち',
              workflowStatus: 'awaiting_user',
              latestSummary: '追加情報待ち',
              branchName: null,
              prUrl: null,
              prNumber: null,
              updatedAt: '2026-03-23T10:30:00.000Z',
              createdAt: '2026-03-23T10:00:00.000Z',
            },
          ],
        });
      }
      if (url.includes('/api/requests/41/messages') && (!init?.method || init.method === 'GET')) {
        return jsonResponse({
          request: {
            id: 41,
            requestText: '検索条件の保持を改善してほしい',
            openclawStatus: 'in_dialogue',
            openclawThreadId: 'thread-41',
            openclawSummary: '追加情報待ち',
            workflowStatus: 'awaiting_user',
            latestSummary: '追加情報待ち',
            branchName: null,
            prUrl: null,
            prNumber: null,
            updatedAt: '2026-03-23T10:30:00.000Z',
            createdAt: '2026-03-23T10:00:00.000Z',
          },
          messages: [
            { id: 1, authorType: 'openclaw_agent', messageType: 'question', body: 'どの画面で条件が消えますか？', createdAt: '2026-03-23T10:30:00.000Z', metadata: null },
          ],
        });
      }
      if (url.includes('/api/requests/41/messages') && init?.method === 'POST') {
        return jsonResponse({ message: '返信を送信しました', nextStep: 'DSS Manager が内容を確認します。' });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />);

    await waitFor(() => {
      expect(screen.getByText('どの画面で条件が消えますか？')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByPlaceholderText('必要な追加情報や回答を入力'), '検索画面から一覧に戻ると消えます');
    await userEvent.click(screen.getByRole('button', { name: '追加情報を送信' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('追加情報を送信しました');
    });

    expect(fetchMock.mock.calls.some(([request, init]) => (
      String(request).includes('/api/requests/41/messages')
      && init?.method === 'POST'
      && String(init.body).includes('検索画面から一覧に戻ると消えます')
    ))).toBe(true);
  });

  it('refreshes request status automatically while the page stays open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let requestList = [
      {
        id: 51,
        requestText: '一覧の初期表示が遅い',
        openclawStatus: 'in_dialogue',
        openclawThreadId: 'thread-51',
        openclawSummary: '追加情報を確認中です',
        workflowStatus: 'awaiting_user',
        latestSummary: '追加情報待ち',
        branchName: null,
        prUrl: null,
        prNumber: null,
        updatedAt: '2026-03-23T12:00:00.000Z',
        createdAt: '2026-03-23T11:30:00.000Z',
      },
    ];
    let threadResponse = {
      request: {
        ...requestList[0],
      },
      messages: [
        { id: 1, authorType: 'openclaw_agent', messageType: 'question', body: 'どの時間帯に遅くなりますか？', createdAt: '2026-03-23T12:00:00.000Z', metadata: null },
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        return jsonResponse({ data: requestList });
      }
      if (url.includes('/api/requests/51/messages')) {
        return jsonResponse(threadResponse);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />);

    await waitFor(() => {
      expect(screen.getAllByText('回答待ち').length).toBeGreaterThan(0);
    });

    requestList = [
      {
        ...requestList[0],
        openclawStatus: 'implementing',
        openclawSummary: '修正実装を開始しました',
        workflowStatus: 'implementing',
        latestSummary: '修正実装を開始しました',
        updatedAt: '2026-03-23T12:01:00.000Z',
      },
    ];
    threadResponse = {
      request: {
        ...requestList[0],
      },
      messages: [
        ...threadResponse.messages,
        { id: 2, authorType: 'openclaw_agent', messageType: 'status_update', body: '追加情報を受領し、解析を再開しました', createdAt: '2026-03-23T12:00:30.000Z', metadata: null },
      ],
    };

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getAllByText('実装中').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('追加情報を受領し、解析を再開しました')).toBeInTheDocument();
  });

  it('keeps the list view collapsed after returning from the thread on mobile refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let requestListFetchCount = 0;
    const requestList = [
      {
        id: 52,
        requestText: '一覧に戻っても自動で詳細を開かないでほしい',
        openclawStatus: 'in_dialogue',
        openclawThreadId: 'thread-52',
        openclawSummary: '確認中',
        workflowStatus: 'awaiting_user',
        latestSummary: '回答待ち',
        branchName: null,
        prUrl: null,
        prNumber: null,
        updatedAt: '2026-03-23T12:05:00.000Z',
        createdAt: '2026-03-23T11:50:00.000Z',
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        requestListFetchCount += 1;
        return jsonResponse({ data: requestList });
      }
      if (url.includes('/api/requests/52/messages')) {
        return jsonResponse({
          request: {
            ...requestList[0],
          },
          messages: [
            { id: 1, authorType: 'user', messageType: 'message', body: '一覧に戻っても自動で詳細を開かないでほしい', createdAt: '2026-03-23T11:50:00.000Z', metadata: null },
          ],
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />);

    await waitFor(() => {
      expect(screen.getByText('元の要望: 一覧に戻っても自動で詳細を開かないでほしい')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '← 一覧に戻る' }));

    expect(screen.getByText('表示する要望を選択してください。')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(requestListFetchCount).toBeGreaterThan(1);
    });
    expect(screen.getByText('表示する要望を選択してください。')).toBeInTheDocument();
  });

  it('keeps the selected thread visible when background request refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let requestListFetchCount = 0;
    const requestList = [
      {
        id: 53,
        requestText: 'バックグラウンド更新で詳細を閉じないでほしい',
        openclawStatus: 'in_dialogue',
        openclawThreadId: 'thread-53',
        openclawSummary: '確認中',
        workflowStatus: 'awaiting_user',
        latestSummary: '回答待ち',
        branchName: null,
        prUrl: null,
        prNumber: null,
        updatedAt: '2026-03-23T12:06:00.000Z',
        createdAt: '2026-03-23T11:55:00.000Z',
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        requestListFetchCount += 1;
        if (requestListFetchCount > 1) {
          throw new Error('temporary network failure');
        }
        return jsonResponse({ data: requestList });
      }
      if (url.includes('/api/requests/53/messages')) {
        return jsonResponse({
          request: {
            ...requestList[0],
          },
          messages: [
            { id: 1, authorType: 'openclaw_agent', messageType: 'question', body: '現象が出る画面を教えてください', createdAt: '2026-03-23T12:06:00.000Z', metadata: null },
          ],
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />);

    await waitFor(() => {
      expect(screen.getByText('現象が出る画面を教えてください')).toBeInTheDocument();
    });

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(requestListFetchCount).toBeGreaterThan(1);
    });
    expect(screen.getByText('現象が出る画面を教えてください')).toBeInTheDocument();
    expect(screen.queryByText('表示する要望を選択してください。')).not.toBeInTheDocument();
  });

  it('refreshes the replacement thread instead of refetching a removed selected request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let requestList = [
      {
        id: 61,
        requestText: '古い要望',
        openclawStatus: 'in_dialogue',
        openclawThreadId: 'thread-61',
        openclawSummary: '確認中',
        workflowStatus: 'awaiting_user',
        latestSummary: '追加情報待ち',
        updatedAt: '2026-03-23T12:10:00.000Z',
        createdAt: '2026-03-23T12:00:00.000Z',
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        return jsonResponse({ data: requestList });
      }
      if (url.includes('/api/requests/61/messages')) {
        return jsonResponse({
          request: {
            ...requestList[0],
          },
          messages: [
            { id: 1, authorType: 'openclaw_agent', messageType: 'question', body: '古い要望の確認です', createdAt: '2026-03-23T12:10:00.000Z', metadata: null },
          ],
        });
      }
      if (url.includes('/api/requests/62/messages')) {
        return jsonResponse({
          request: {
            id: 62,
            requestText: '置き換わった新しい要望',
            openclawStatus: 'queued',
            openclawThreadId: 'thread-62',
            openclawSummary: '受付済み',
            workflowStatus: 'queued',
            latestSummary: '新しい要望です',
            updatedAt: '2026-03-23T12:11:00.000Z',
            createdAt: '2026-03-23T12:11:00.000Z',
          },
          messages: [
            { id: 2, authorType: 'user', messageType: 'message', body: '置き換わった新しい要望', createdAt: '2026-03-23T12:11:00.000Z', metadata: null },
          ],
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />);

    await waitFor(() => {
      expect(screen.getByText('元の要望: 古い要望')).toBeInTheDocument();
    });

    requestList = [
      {
        id: 62,
        requestText: '置き換わった新しい要望',
        openclawStatus: 'queued',
        openclawThreadId: 'thread-62',
        openclawSummary: '受付済み',
        workflowStatus: 'queued',
        latestSummary: '新しい要望です',
        updatedAt: '2026-03-23T12:11:00.000Z',
        createdAt: '2026-03-23T12:11:00.000Z',
      },
    ];

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('元の要望: 置き換わった新しい要望')).toBeInTheDocument();
    });

    const oldThreadCalls = fetchMock.mock.calls.filter(([request]) => String(request).includes('/api/requests/61/messages'));
    const newThreadCalls = fetchMock.mock.calls.filter(([request]) => String(request).includes('/api/requests/62/messages'));
    expect(oldThreadCalls).toHaveLength(1);
    expect(newThreadCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('creates a new request from the page-level request form', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        return jsonResponse({
          data: [
            {
              id: 77,
              requestText: '新しい帳票を追加したい',
              openclawStatus: 'pending_handoff',
              openclawThreadId: 'thread-77',
              openclawSummary: '受付済み',
              workflowStatus: 'queued',
              latestSummary: '要望を受け付けました',
              branchName: null,
              prUrl: null,
              prNumber: null,
              updatedAt: '2026-03-24T10:10:00.000Z',
              createdAt: '2026-03-24T10:10:00.000Z',
            },
          ],
        });
      }
      if (url.includes('/api/requests/77/messages')) {
        return jsonResponse({
          request: {
            id: 77,
            requestText: '新しい帳票を追加したい',
            openclawStatus: 'pending_handoff',
            openclawThreadId: 'thread-77',
            openclawSummary: '受付済み',
            workflowStatus: 'queued',
            latestSummary: '要望を受け付けました',
            branchName: null,
            prUrl: null,
            prNumber: null,
            updatedAt: '2026-03-24T10:10:00.000Z',
            createdAt: '2026-03-24T10:10:00.000Z',
          },
          messages: [
            { id: 1, authorType: 'user', messageType: 'message', body: '新しい帳票を追加したい', createdAt: '2026-03-24T10:10:00.000Z', metadata: null },
          ],
        });
      }
      if (url.endsWith('/api/requests') && init?.method === 'POST') {
        return jsonResponse({
          message: '要望を受け付けました',
          nextStep: 'DSS Manager が内容を確認します。',
          request: {
            id: 77,
          },
        }, 201);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '新しい要望を入力' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '新しい要望を入力' }));
    expect(screen.getByRole('button', { name: '定型文を挿入' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '医薬品マスターの更新状況を確認したいです。' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '定型文を挿入' }));
    expect(screen.getByRole('button', { name: '医薬品マスターの更新状況を確認したいです。' })).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('依頼したい内容や困っていることを入力してください'), '新しい帳票を追加したい');
    await userEvent.click(screen.getByRole('button', { name: '要望を送信' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('要望を受け付けました');
    });
    expect(fetchMock.mock.calls.some(([request, init]) => (
      String(request).endsWith('/api/requests')
      && init?.method === 'POST'
      && String(init.body).includes('新しい帳票を追加したい')
    ))).toBe(true);
  });

  it('resets category and priority when canceling the new request form', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '新しい要望を入力' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '新しい要望を入力' }));

    const categorySelect = screen.getByLabelText('要望カテゴリ') as HTMLSelectElement;
    const prioritySelect = screen.getByLabelText('優先度') as HTMLSelectElement;

    await userEvent.selectOptions(categorySelect, 'bug_report');
    await userEvent.selectOptions(prioritySelect, 'urgent');
    await userEvent.type(
      screen.getByPlaceholderText('依頼したい内容や困っていることを入力してください'),
      '途中まで入力した要望',
    );

    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    await userEvent.click(screen.getByRole('button', { name: '新しい要望を入力' }));

    expect((screen.getByLabelText('要望カテゴリ') as HTMLSelectElement).value).toBe('improvement');
    expect((screen.getByLabelText('優先度') as HTMLSelectElement).value).toBe('normal');
    expect(screen.getByPlaceholderText('依頼したい内容や困っていることを入力してください')).toHaveValue('');
  });

  it('closes and resets the new request form when selecting a duplicate suggestion', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        return jsonResponse({
          data: [
            {
              id: 88,
              requestText: '既存の要望',
              workflowStatus: 'queued',
              latestSummary: '受付済み',
              updatedAt: '2026-03-24T10:10:00.000Z',
              createdAt: '2026-03-24T10:10:00.000Z',
            },
          ],
        });
      }
      if (url.includes('/api/requests/88/messages')) {
        return jsonResponse({
          request: {
            id: 88,
            requestText: '既存の要望',
            workflowStatus: 'queued',
            latestSummary: '受付済み',
            updatedAt: '2026-03-24T10:10:00.000Z',
            createdAt: '2026-03-24T10:10:00.000Z',
          },
          messages: [
            { id: 1, authorType: 'user', messageType: 'message', body: '既存の要望', createdAt: '2026-03-24T10:10:00.000Z', metadata: null },
          ],
        });
      }
      if (url.includes('/api/requests/suggestions')) {
        return jsonResponse({
          data: [
            {
              id: 88,
              requestText: '既存の要望',
              category: 'improvement',
              priority: 'normal',
            },
          ],
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '新しい要望を入力' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '新しい要望を入力' }));
    await userEvent.selectOptions(screen.getByLabelText('要望カテゴリ'), 'bug_report');
    await userEvent.selectOptions(screen.getByLabelText('優先度'), 'urgent');
    await userEvent.type(
      screen.getByPlaceholderText('依頼したい内容や困っていることを入力してください'),
      '既存の要望と似ている内容',
    );

    await waitFor(() => {
      expect(screen.getByText('似た要望が見つかりました')).toBeInTheDocument();
    });

    await userEvent.click(screen.getAllByRole('button', { name: /#88/ })[0]);

    await waitFor(() => {
      expect(screen.queryByText('似た要望が見つかりました')).not.toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText('依頼したい内容や困っていることを入力してください')).not.toBeInTheDocument();
    expect(screen.getByText('元の要望: 既存の要望')).toBeInTheDocument();
  });

  it('keeps the latest duplicate suggestions when an older request resolves later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const firstQuery = '既存の要望に似た最初の入力';
    const secondQuery = '既存の要望に似た最新の入力';
    let resolveFirstSuggestions: ((value: Response) => void) | null = null;
    let resolveSecondSuggestions: ((value: Response) => void) | null = null;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
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
      if (url.includes('/api/requests/me')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes(`/api/requests/suggestions?query=${encodeURIComponent(firstQuery)}`)) {
        return await new Promise<Response>((resolve) => {
          resolveFirstSuggestions = resolve;
        });
      }
      if (url.includes(`/api/requests/suggestions?query=${encodeURIComponent(secondQuery)}`)) {
        return await new Promise<Response>((resolve) => {
          resolveSecondSuggestions = resolve;
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MyRequestsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '新しい要望を入力' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '新しい要望を入力' }));
    const textarea = screen.getByPlaceholderText('依頼したい内容や困っていることを入力してください');

    fireEvent.change(textarea, { target: { value: firstQuery } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    fireEvent.change(textarea, { target: { value: secondQuery } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    if (!resolveFirstSuggestions || !resolveSecondSuggestions) {
      throw new Error('suggestion requests were not started');
    }
    const firstSuggestions: (value: Response) => void = resolveFirstSuggestions;
    const secondSuggestions: (value: Response) => void = resolveSecondSuggestions;

    await act(async () => {
      secondSuggestions(jsonResponse({
        data: [
          {
            id: 91,
            requestText: '最新候補',
            category: 'improvement',
            priority: 'normal',
          },
        ],
      }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('最新候補')).toBeInTheDocument();
    });

    await act(async () => {
      firstSuggestions(jsonResponse({
        data: [
          {
            id: 90,
            requestText: '古い候補',
            category: 'bug_report',
            priority: 'urgent',
          },
        ],
      }));
      await Promise.resolve();
    });

    expect(screen.getByText('最新候補')).toBeInTheDocument();
    expect(screen.queryByText('古い候補')).not.toBeInTheDocument();
  });
});
