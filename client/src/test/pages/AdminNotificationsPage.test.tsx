import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import AdminNotificationsPage from '../../pages/admin/AdminNotificationsPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminNotificationsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows backend notification types in filters and human labels', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/notifications/stats')) {
        return jsonResponse({
          data: {
            totalNotifications: 12,
            unreadNotifications: 5,
            totalSubscriptions: 2,
            typeBreakdown: [
              { type: 'alert_resolved', count: 3 },
              { type: 'matching_refresh_complete', count: 2 },
            ],
          },
        });
      }
      if (url.includes('/api/admin/notifications?')) {
        return jsonResponse({
          data: [
            {
              id: 10,
              pharmacyId: 1,
              pharmacyName: 'テスト薬局',
              type: 'alert_resolved',
              title: '在庫アラートが解消しました',
              message: '対象在庫が整理されました',
              isRead: false,
              createdAt: '2026-04-01T00:00:00.000Z',
            },
          ],
          pagination: { page: 1, totalPages: 1, total: 1, limit: 20 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminNotificationsPage />, {
      route: '/admin/notifications',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('通知・配信状況')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'マッチング実験' })).toHaveAttribute('href', '/admin/matching-experiments');
    expect(screen.getByRole('link', { name: 'アップロード品質' })).toHaveAttribute('href', '/admin/upload-quality');
    expect(screen.getAllByRole('link', { name: 'ユーザー間メッセージ' }).some((link) => link.getAttribute('href') === '/admin/direct-messages')).toBe(true);
    expect(screen.getByRole('link', { name: 'ログセンター' })).toHaveAttribute('href', '/admin/log-center');
    expect(screen.getByRole('link', { name: '監査ログ' })).toHaveAttribute('href', '/admin/audit');
    expect(screen.getByRole('link', { name: 'エラーコード' })).toHaveAttribute('href', '/admin/error-codes');
    expect(screen.getByText('アラート解消: 3')).toBeInTheDocument();
    expect(screen.getByText('在庫アラートが解消しました')).toBeInTheDocument();
    expect(screen.getAllByText('アラート解消').length).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: '候補再計算完了' })).toBeInTheDocument();
  });

  it('requests newly exposed backend notification types from the admin filter', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/notifications/stats')) {
        return jsonResponse({
          data: {
            totalNotifications: 1,
            unreadNotifications: 1,
            totalSubscriptions: 0,
            typeBreakdown: [],
          },
        });
      }
      if (url.includes('/api/admin/notifications?')) {
        return jsonResponse({
          data: [],
          pagination: { page: 1, totalPages: 1, total: 0, limit: 20 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminNotificationsPage />, {
      route: '/admin/notifications',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'matching_refresh_complete' } });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([request]) => String(request).includes('/api/admin/notifications?page=1&type=matching_refresh_complete'))).toBe(true);
    });
  });
});
