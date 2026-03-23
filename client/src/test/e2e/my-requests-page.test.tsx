import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
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

    expect(screen.getAllByText('回答待ち').length).toBeGreaterThan(0);
    expect(screen.getByText('完了')).toBeInTheDocument();
    expect(screen.getByText('在庫一覧の検索を改善してほしい')).toBeInTheDocument();
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
      expect(screen.getByText(/返信を送信しました/)).toBeInTheDocument();
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
});
