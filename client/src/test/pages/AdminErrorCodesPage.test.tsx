import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminErrorCodesPage from '../../pages/admin/AdminErrorCodesPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminErrorCodesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the standalone error-code management surface and nearby links', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/error-codes')) {
        return jsonResponse({
          items: [
            {
              id: 1,
              code: 'ERR_UPLOAD_001',
              category: 'upload',
              severity: 'error',
              titleJa: '取込失敗',
              descriptionJa: 'フォーマット不正',
              resolutionJa: 'CSV を再確認してください',
              isActive: true,
            },
          ],
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    }));

    renderWithProviders(<AdminErrorCodesPage />, {
      route: '/admin/error-codes',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /エラーコード/ })).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'ログセンター' })).toHaveAttribute('href', '/admin/log-center');
    await user.click(screen.getAllByRole('button', { name: '関連' })[1]);
    expect(screen.getByRole('link', { name: '通知・配信' })).toHaveAttribute('href', '/admin/notifications');
    expect(screen.getByText('ERR_UPLOAD_001')).toBeInTheDocument();
  });
});
