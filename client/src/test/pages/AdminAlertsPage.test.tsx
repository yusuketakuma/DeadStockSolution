import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminAlertsPage from '../../pages/admin/AdminAlertsPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminAlertsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: false,
      media: '(min-width: 992px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  it('keeps nearby notification and pharmacy links in the empty state', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/alerts?')) {
        return jsonResponse({
          data: [],
          pagination: { page: 1, totalPages: 1, total: 0 },
        });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminAlertsPage />, {
      route: '/admin/alerts',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('アラート管理')).toBeInTheDocument();
    });

    expect(screen.getByText('アラートがありません')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '通知・配信状況' }).some((link) => link.getAttribute('href') === '/admin/notifications')).toBe(true);
    expect(screen.getAllByRole('link', { name: '期限リスク分析' }).some((link) => link.getAttribute('href') === '/admin/risk')).toBe(true);
    expect(screen.getAllByRole('link', { name: '薬局管理' }).some((link) => link.getAttribute('href') === '/admin/pharmacies')).toBe(true);
  });
});
