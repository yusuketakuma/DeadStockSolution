import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminMatchingExperimentsPage from '../../pages/admin/AdminMatchingExperimentsPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminMatchingExperimentsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders experiments and their assignment summary', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/matching-experiments/1/results')) {
        return jsonResponse({
          results: {
            experimentId: 1,
            totalAssignments: 12,
            controlCount: 5,
            treatmentCount: 7,
          },
        });
      }

      if (url.includes('/api/admin/matching-experiments')) {
        return jsonResponse({
          experiments: [
            {
              id: 1,
              name: 'AB Test 2026-04',
              controlProfileId: 1,
              treatmentProfileId: 2,
              trafficPercentage: 50,
              status: 'running',
              startedAt: '2026-04-01T10:00:00.000Z',
              endedAt: null,
              createdAt: '2026-04-01T09:00:00.000Z',
            },
          ],
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    }));

    renderWithProviders(<AdminMatchingExperimentsPage />, {
      route: '/admin/matching-experiments',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('マッチング実験')).toBeInTheDocument();
    });

    expect(screen.getByText('AB Test 2026-04')).toBeInTheDocument();
    expect(screen.getByText('実行中')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
    });
    await user.click(screen.getAllByRole('button', { name: '関連' })[0]);
    expect(screen.getByRole('link', { name: '管理ダッシュボード' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: 'マッチングルール' })).toHaveAttribute('href', '/admin/matching-rules');
    expect(screen.getByRole('link', { name: '通知・配信状況' })).toHaveAttribute('href', '/admin/notifications');
    await user.click(screen.getAllByRole('button', { name: '関連' })[1]);
    expect(screen.getByRole('link', { name: 'エラーコード' })).toHaveAttribute('href', '/admin/error-codes');
    expect(screen.getByRole('link', { name: 'ログセンター' })).toHaveAttribute('href', '/admin/log-center');
  });
});
