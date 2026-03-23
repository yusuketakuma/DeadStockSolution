import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminOpenClawPage from '../../pages/admin/AdminOpenClawPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminOpenClawPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces failed workflow items and allows retry from the list', async () => {
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
      if (url.includes('/api/admin/requests?page=1&limit=50')) {
        return jsonResponse({
          data: [
            {
              id: 88,
              pharmacyId: 5,
              pharmacyName: '薬局A',
              requestText: 'CSV出力を直してほしい',
              openclawStatus: 'in_dialogue',
              openclawThreadId: 'thread-88',
              openclawSummary: '解析中',
              workflowStatus: 'failed',
              latestSummary: 'テストが失敗しました',
              branchName: null,
              prUrl: null,
              prNumber: null,
              createdAt: '2026-03-23T10:00:00.000Z',
              updatedAt: '2026-03-23T10:30:00.000Z',
            },
          ],
          connector: {
            configured: true,
            webhookConfigured: true,
            implementationBranch: 'review',
          },
        });
      }
      if (url.includes('/api/admin/requests/88/messages')) {
        return jsonResponse({
          request: {
            id: 88,
            pharmacyId: 5,
            pharmacyName: '薬局A',
            requestText: 'CSV出力を直してほしい',
            openclawStatus: 'in_dialogue',
            openclawThreadId: 'thread-88',
            openclawSummary: '解析中',
            workflowStatus: 'failed',
            latestSummary: 'テストが失敗しました',
            branchName: null,
            prUrl: null,
            prNumber: null,
            createdAt: '2026-03-23T10:00:00.000Z',
            updatedAt: '2026-03-23T10:30:00.000Z',
          },
          messages: [
            { id: 1, authorType: 'system', messageType: 'status_update', body: 'テストが失敗しました', createdAt: '2026-03-23T10:30:00.000Z' },
          ],
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminOpenClawPage />);

    await waitFor(() => {
      expect(screen.getByText('OpenClaw連携')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('失敗: 1')).toBeInTheDocument();
    });

    expect(screen.getAllByText('失敗').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '再連携' })).toBeInTheDocument();
  });
});
