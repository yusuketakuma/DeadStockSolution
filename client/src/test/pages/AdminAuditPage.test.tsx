import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminAuditPage from '../../pages/admin/AdminAuditPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminAuditPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows nearby navigation and CSV export for audit logs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/audit?')) {
        return jsonResponse({
          data: [
            {
              id: 1,
              adminId: 99,
              adminName: '管理者',
              targetPharmacyId: 10,
              targetPharmacyName: 'テスト薬局',
              action: 'verify',
              previousStatus: 'pending',
              newStatus: 'approved',
              reason: '確認済み',
              createdAt: '2026-04-02T00:00:00.000Z',
            },
          ],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    renderWithProviders(<AdminAuditPage />, {
      route: '/admin/audit',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('監査ログ')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: '操作ログ' })).toHaveAttribute('href', '/admin/logs');
    expect(screen.getByRole('link', { name: 'ログセンター' })).toHaveAttribute('href', '/admin/log-center');
    expect(screen.getByRole('link', { name: 'CSVエクスポート' })).toHaveAttribute('href', '/api/admin/csv/audit-logs');
  });
});
