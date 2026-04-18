import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminUserRequestsPage from '../../pages/admin/AdminUserRequestsPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminUserRequestsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps openclaw and log-center exits visible when no requests match', async () => {
    const requestUrls: string[] = [];

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/user-requests?page=1&limit=20')) {
        requestUrls.push(url);
        return jsonResponse({
          data: [],
          pagination: { page: 1, totalPages: 1, total: 0 },
        });
      }
      if (url.includes('/api/admin/user-requests/assignees')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({ error: 'not found' }, 404);
    }));

    renderWithProviders(<AdminUserRequestsPage />, {
      route: '/admin/user-requests',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('ユーザーリクエスト管理')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(requestUrls).toContain('/api/admin/user-requests?page=1&limit=20');
      expect(screen.getByText('対象の要望がありません')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('link', { name: 'OpenClaw連携' }).some((link) => link.getAttribute('href') === '/admin/openclaw')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'ログセンター' }).some((link) => link.getAttribute('href') === '/admin/log-center')).toBe(true);
  });

  it('filters the list by queue shortcut and preserves summary counts', async () => {
    const user = userEvent.setup();

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/user-requests?page=1&limit=20')) {
        return jsonResponse({
          data: [
            {
              id: 11,
              pharmacyId: 1,
              pharmacyName: '薬局A',
              requestText: '管理者対応が必要',
              category: 'improvement',
              priority: 'normal',
              closeReason: null,
              openclawStatus: 'pending_handoff',
              openclawThreadId: null,
              openclawSummary: null,
              workflowStatus: 'queued',
              latestSummary: null,
              branchName: null,
              prUrl: null,
              prNumber: null,
              assignedAdminId: null,
              assignedAdminName: null,
              requesterLastViewedAt: null,
              adminLastViewedAt: null,
              latestUserMessageAt: null,
              latestStaffMessageAt: null,
              createdAt: '2026-03-24T09:00:00.000Z',
              updatedAt: '2026-03-24T09:00:00.000Z',
              hasUnread: false,
              waitingOn: 'admin',
              isOverdue: false,
            },
            {
              id: 12,
              pharmacyId: 2,
              pharmacyName: '薬局B',
              requestText: '期限超過の要望',
              category: 'bug_report',
              priority: 'urgent',
              closeReason: null,
              openclawStatus: 'in_dialogue',
              openclawThreadId: 'thread-12',
              openclawSummary: null,
              workflowStatus: 'awaiting_user',
              latestSummary: null,
              branchName: null,
              prUrl: null,
              prNumber: null,
              assignedAdminId: null,
              assignedAdminName: null,
              requesterLastViewedAt: null,
              adminLastViewedAt: null,
              latestUserMessageAt: null,
              latestStaffMessageAt: null,
              createdAt: '2026-03-24T09:00:00.000Z',
              updatedAt: '2026-03-24T10:00:00.000Z',
              hasUnread: true,
              waitingOn: 'admin',
              isOverdue: true,
            },
            {
              id: 13,
              pharmacyId: 3,
              pharmacyName: '薬局C',
              requestText: 'OpenClaw 処理中の要望',
              category: 'question',
              priority: 'low',
              closeReason: null,
              openclawStatus: 'implementing',
              openclawThreadId: 'thread-13',
              openclawSummary: null,
              workflowStatus: 'implementing',
              latestSummary: null,
              branchName: null,
              prUrl: null,
              prNumber: null,
              assignedAdminId: null,
              assignedAdminName: null,
              requesterLastViewedAt: null,
              adminLastViewedAt: null,
              latestUserMessageAt: null,
              latestStaffMessageAt: null,
              createdAt: '2026-03-24T09:00:00.000Z',
              updatedAt: '2026-03-24T11:00:00.000Z',
              hasUnread: false,
              waitingOn: 'openclaw',
              isOverdue: false,
            },
          ],
          pagination: { page: 1, totalPages: 1, total: 3 },
        });
      }
      if (url.includes('/api/admin/user-requests/11')) {
        return jsonResponse({
          request: {
            id: 11,
            pharmacyId: 1,
            pharmacyName: '薬局A',
            requestText: '管理者対応が必要',
            category: 'improvement',
            priority: 'normal',
            closeReason: null,
            openclawStatus: 'pending_handoff',
            openclawThreadId: null,
            openclawSummary: null,
            workflowStatus: 'queued',
            latestSummary: null,
            branchName: null,
            prUrl: null,
            prNumber: null,
            assignedAdminId: null,
            assignedAdminName: null,
            requesterLastViewedAt: null,
            adminLastViewedAt: null,
            latestUserMessageAt: null,
            latestStaffMessageAt: null,
            createdAt: '2026-03-24T09:00:00.000Z',
            updatedAt: '2026-03-24T09:00:00.000Z',
            hasUnread: false,
            waitingOn: 'admin',
            isOverdue: false,
          },
          messages: [],
          notes: [],
          events: [],
        });
      }
      if (url.includes('/api/admin/user-requests/assignees')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminUserRequestsPage />, {
      route: '/admin/user-requests',
      authUser: mockAdminUser,
    });

    await screen.findByText('ユーザーリクエスト管理');
    await screen.findByText('#11 薬局A');
    expect(screen.getByRole('button', { name: /本日返答 2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /24時間超 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /OpenClaw 1/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /OpenClaw 1/ }));

    await waitFor(() => {
      expect(screen.queryByText('#11 薬局A')).not.toBeInTheDocument();
    });
    expect(screen.getByText('#13 薬局C')).toBeInTheDocument();
  });
});
