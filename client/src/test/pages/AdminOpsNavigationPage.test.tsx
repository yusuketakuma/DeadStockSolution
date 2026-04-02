import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, mockAdminUser } from '../helpers';
import AdminBusinessHoursPage from '../../pages/admin/AdminBusinessHoursPage';
import AdminRateLimitsPage from '../../pages/admin/AdminRateLimitsPage';
import AdminRelationshipsPage from '../../pages/admin/AdminRelationshipsPage';
import AdminBulkActionsPage from '../../pages/admin/AdminBulkActionsPage';
import AdminPharmacyHealthPage from '../../pages/admin/AdminPharmacyHealthPage';
import AdminDrugEquivalencesPage from '../../pages/admin/AdminDrugEquivalencesPage';
import AdminPharmaciesPage from '../../pages/admin/AdminPharmaciesPage';
import AdminGroupsPage from '../../pages/admin/AdminGroupsPage';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Admin operations navigation surfaces', () => {
  it('shows related admin destinations on the business-hours page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/business-hours/special')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes('/api/admin/business-hours')) {
        return jsonResponse({
          data: [
            {
              pharmacyId: 1,
              pharmacyName: '青空薬局',
              dayOfWeek: 1,
              openTime: '09:00',
              closeTime: '18:00',
              isClosed: false,
              is24Hours: false,
            },
          ],
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminBusinessHoursPage />, {
      route: '/admin/business-hours',
      authUser: mockAdminUser,
    });

    expect(await screen.findByText('営業時間カレンダー')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '関係性監査' }).every((link) => link.getAttribute('href') === '/admin/relationships')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'レート制限設定' }).every((link) => link.getAttribute('href') === '/admin/rate-limits')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'ログセンター' }).every((link) => link.getAttribute('href') === '/admin/log-center')).toBe(true);
    expect(screen.getAllByRole('link', { name: '薬局ヘルス' }).every((link) => link.getAttribute('href') === '/admin/pharmacy-health')).toBe(true);
    expect(screen.getByRole('link', { name: '編集' })).toHaveAttribute('href', '/admin/pharmacies/1/edit');
  });

  it('shows related admin destinations on the rate-limits page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/rate-limits/config')) {
        return jsonResponse({
          limiters: [
            {
              name: 'admin_notifications',
              windowMs: 60000,
              max: 60,
              appliedTo: ['/api/admin/notifications'],
            },
          ],
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminRateLimitsPage />, {
      route: '/admin/rate-limits',
      authUser: mockAdminUser,
    });

    expect(await screen.findByText('レート制限設定')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'ログセンター' }).every((link) => link.getAttribute('href') === '/admin/log-center')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'エラーコード' }).every((link) => link.getAttribute('href') === '/admin/error-codes')).toBe(true);
    expect(screen.getAllByRole('link', { name: '通知・配信状況' }).every((link) => link.getAttribute('href') === '/admin/notifications')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'OpenClaw連携' }).every((link) => link.getAttribute('href') === '/admin/openclaw')).toBe(true);
    expect(screen.getAllByRole('link', { name: '監査ログ' }).every((link) => link.getAttribute('href') === '/admin/audit')).toBe(true);
  });

  it('shows related admin destinations on the relationships page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/relationships?page=1')) {
        return jsonResponse({
          data: [
            {
              id: 10,
              pharmacyId: 1,
              pharmacyName: '青空薬局',
              targetPharmacyId: 2,
              targetPharmacyName: 'さくら薬局',
              relationshipType: 'favorite',
              createdAt: '2026-03-29T09:00:00.000Z',
            },
          ],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminRelationshipsPage />, {
      route: '/admin/relationships',
      authUser: mockAdminUser,
    });

    expect(await screen.findByText('関係性監査')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '薬局ヘルス' }).every((link) => link.getAttribute('href') === '/admin/pharmacy-health')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'グループ管理' }).some((link) => link.getAttribute('href') === '/admin/groups')).toBe(true);
    expect(screen.getAllByRole('link', { name: '営業時間' }).every((link) => link.getAttribute('href') === '/admin/business-hours')).toBe(true);
    expect(screen.getAllByRole('link', { name: '一括操作' }).every((link) => link.getAttribute('href') === '/admin/bulk-actions')).toBe(true);
    expect(screen.getByRole('link', { name: '元薬局を編集' })).toHaveAttribute('href', '/admin/pharmacies/1/edit');
    expect(screen.getByRole('link', { name: '対象薬局を編集' })).toHaveAttribute('href', '/admin/pharmacies/2/edit');
  });

  it('shows related admin destinations on the bulk-actions page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL) => jsonResponse({ error: 'Not found' }, 404)));

    renderWithProviders(<AdminBulkActionsPage />, {
      route: '/admin/bulk-actions',
      authUser: mockAdminUser,
    });

    expect(screen.getByText('一括操作')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '監査ログ' }).some((link) => link.getAttribute('href') === '/admin/audit')).toBe(true);
    expect(screen.getAllByRole('link', { name: '薬局管理' }).some((link) => link.getAttribute('href') === '/admin/pharmacies')).toBe(true);
    expect(screen.getAllByRole('link', { name: '取込ジョブ管理' }).every((link) => link.getAttribute('href') === '/admin/upload-jobs')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'ログセンター' }).every((link) => link.getAttribute('href') === '/admin/log-center')).toBe(true);
  });

  it('shows related admin destinations on the pharmacy-health page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/pharmacy-health')) {
        return jsonResponse({
          data: {
            activityByPharmacy: [
              {
                pharmacyId: 1,
                pharmacyName: '青空薬局',
                actionCount: 12,
                lastActivity: '2026-03-29T09:00:00.000Z',
              },
            ],
            trustScores: [],
          },
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminPharmacyHealthPage />, {
      route: '/admin/pharmacy-health',
      authUser: mockAdminUser,
    });

    expect(await screen.findByText('薬局ヘルス')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '関係性監査' }).some((link) => link.getAttribute('href') === '/admin/relationships')).toBe(true);
    expect(screen.getAllByRole('link', { name: '営業時間' }).every((link) => link.getAttribute('href') === '/admin/business-hours')).toBe(true);
    expect(screen.getAllByRole('link', { name: '一括操作' }).every((link) => link.getAttribute('href') === '/admin/bulk-actions')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'ログセンター' }).every((link) => link.getAttribute('href') === '/admin/log-center')).toBe(true);
    expect(screen.getAllByRole('link', { name: '編集' }).some((link) => link.getAttribute('href') === '/admin/pharmacies/1/edit')).toBe(true);
  });

  it('shows related admin destinations on the drug-equivalences page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/drug-equivalences')) {
        return jsonResponse({
          data: [
            {
              id: 1,
              drugNameA: 'バイアスピリン',
              drugNameB: 'アスピリン',
              equivalenceType: 'brand_generic',
              notes: null,
              createdAt: '2026-03-29T09:00:00.000Z',
              updatedAt: '2026-03-29T09:00:00.000Z',
            },
          ],
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminDrugEquivalencesPage />, {
      route: '/admin/drug-equivalences',
      authUser: mockAdminUser,
    });

    expect(await screen.findByText('薬品同等性マスター')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '医薬品マスター' }).some((link) => link.getAttribute('href') === '/admin/drug-master')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'マッチングルール' }).some((link) => link.getAttribute('href') === '/admin/matching-rules')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'マッチング実験' }).every((link) => link.getAttribute('href') === '/admin/matching-experiments')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'エラーコード' }).every((link) => link.getAttribute('href') === '/admin/error-codes')).toBe(true);
  });

  it('shows related admin destinations on the pharmacies page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/pharmacies/trust?page=1')) {
        return jsonResponse({
          data: [
            {
              id: 1,
              email: 'test@example.com',
              name: '青空薬局',
              prefecture: '東京都',
              phone: '03-0000-0000',
              fax: '03-0000-0001',
              isActive: true,
              isAdmin: false,
              isTestAccount: false,
              createdAt: '2026-03-29T09:00:00.000Z',
              trustScore: 70,
              ratingCount: 5,
              positiveRate: 80,
              verificationStatus: 'verified',
            },
          ],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminPharmaciesPage />, {
      route: '/admin/pharmacies',
      authUser: mockAdminUser,
    });

    expect(await screen.findByText('薬局管理')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '営業時間' }).every((link) => link.getAttribute('href') === '/admin/business-hours')).toBe(true);
    expect(screen.getAllByRole('link', { name: '一括操作' }).every((link) => link.getAttribute('href') === '/admin/bulk-actions')).toBe(true);
    expect(screen.getAllByRole('link', { name: '関係性監査' }).every((link) => link.getAttribute('href') === '/admin/relationships')).toBe(true);
  });

  it('shows related admin destinations on the groups page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/groups?page=1')) {
        return jsonResponse({
          data: [
            {
              id: 1,
              name: '関東グループ',
              description: null,
              visibility: 'public',
              ownerPharmacyId: 1,
              ownerName: '青空薬局',
              memberCount: 2,
              createdAt: '2026-03-29T09:00:00.000Z',
            },
          ],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminGroupsPage />, {
      route: '/admin/groups',
      authUser: mockAdminUser,
    });

    expect(await screen.findByText('グループ管理')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '関係性監査' }).some((link) => link.getAttribute('href') === '/admin/relationships')).toBe(true);
    expect(screen.getAllByRole('link', { name: '薬局ヘルス' }).every((link) => link.getAttribute('href') === '/admin/pharmacy-health')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'ログセンター' }).every((link) => link.getAttribute('href') === '/admin/log-center')).toBe(true);
    expect(screen.getAllByRole('link', { name: '営業時間' }).some((link) => link.getAttribute('href') === '/admin/business-hours')).toBe(true);
    expect(screen.getByRole('link', { name: 'オーナーを編集' })).toHaveAttribute('href', '/admin/pharmacies/1/edit');
  });
});
