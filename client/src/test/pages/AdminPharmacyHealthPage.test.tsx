import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminPharmacyHealthPage from '../../pages/admin/AdminPharmacyHealthPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminPharmacyHealthPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes nearby pharmacy-operation links when health data is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/pharmacy-health')) {
        return jsonResponse({
          data: {
            activityByPharmacy: [],
            trustScores: [],
          },
        });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminPharmacyHealthPage />, {
      route: '/admin/pharmacy-health',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('薬局ヘルス')).toBeInTheDocument();
    });

    expect(screen.getByText('薬局ヘルス情報がありません')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '営業時間' }).some((link) => link.getAttribute('href') === '/admin/business-hours')).toBe(true);
    expect(screen.getAllByRole('link', { name: '一括操作' }).some((link) => link.getAttribute('href') === '/admin/bulk-actions')).toBe(true);
  });

  it('provides edit links from health tables back to the pharmacy edit page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/pharmacy-health')) {
        return jsonResponse({
          data: {
            activityByPharmacy: [
              { pharmacyId: 11, pharmacyName: 'あおぞら薬局', actionCount: 8, lastActivity: '2026-04-01T00:00:00.000Z' },
            ],
            trustScores: [
              { pharmacyId: 11, pharmacyName: 'あおぞら薬局', trustScore: '71.2', ratingCount: 5, positiveRate: '92.0', updatedAt: '2026-04-01T00:00:00.000Z' },
            ],
          },
        });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminPharmacyHealthPage />, {
      route: '/admin/pharmacy-health',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('アクティビティランキング（上位50）')).toBeInTheDocument();
    });

    expect(screen.getAllByRole('link', { name: '編集' }).some((link) => link.getAttribute('href') === '/admin/pharmacies/11/edit')).toBe(true);
  });
});
