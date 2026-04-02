import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminUserRequestsPage from '../../pages/admin/AdminUserRequestsPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminUserRequestsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps openclaw and log-center exits visible when no requests match', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/requests?page=1&limit=20')) {
        return jsonResponse({
          data: [],
          pagination: { page: 1, totalPages: 1, total: 0 },
        });
      }
      if (url.includes('/api/admin/admin-users')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminUserRequestsPage />, {
      route: '/admin/user-requests',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('ユーザーリクエスト管理')).toBeInTheDocument();
    });

    expect(screen.getByText('対象の要望がありません')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'OpenClaw連携' }).some((link) => link.getAttribute('href') === '/admin/openclaw')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'ログセンター' }).some((link) => link.getAttribute('href') === '/admin/log-center')).toBe(true);
  });
});
