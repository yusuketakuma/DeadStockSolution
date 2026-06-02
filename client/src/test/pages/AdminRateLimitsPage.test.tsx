import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminRateLimitsPage from '../../pages/admin/AdminRateLimitsPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminRateLimitsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes empty-state follow-up to platform operations', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/rate-limits/config')) {
        return jsonResponse({ limiters: [] });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminRateLimitsPage />, {
      route: '/admin/rate-limits',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('レート制限設定')).toBeInTheDocument();
    });

    expect(screen.getByText('レート制限設定はまだ表示できる項目がありません')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'ログセンター' }).some((link) => link.getAttribute('href') === '/admin/log-center')).toBe(true);
    await user.click(screen.getAllByRole('button', { name: '関連' }).at(-1)!);
    expect(screen.getAllByRole('link', { name: 'OpenClaw連携' }).some((link) => link.getAttribute('href') === '/admin/openclaw')).toBe(true);
  });
});
