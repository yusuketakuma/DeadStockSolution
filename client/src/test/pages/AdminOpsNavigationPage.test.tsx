import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

type User = ReturnType<typeof userEvent.setup>;

function hasLink(name: string, href: string) {
  return screen
    .queryAllByRole('link', { name })
    .some((link) => link.getAttribute('href') === href);
}

async function expectReachableLink(user: User, name: string, href: string) {
  if (hasLink(name, href)) {
    expect(hasLink(name, href)).toBe(true);
    return;
  }

  const menuButtons = screen.queryAllByRole('button', { name: /^(関連|関連画面|その他)$/ });
  for (const button of menuButtons) {
    await user.click(button);
    if (hasLink(name, href)) {
      expect(hasLink(name, href)).toBe(true);
      return;
    }
  }

  expect(hasLink(name, href)).toBe(true);
}

describe('Admin operations navigation surfaces', () => {
  it('shows related admin destinations on the business-hours page', async () => {
    const user = userEvent.setup();
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
    await expectReachableLink(user, '関係性監査', '/admin/relationships');
    await expectReachableLink(user, 'レート制限設定', '/admin/rate-limits');
    await expectReachableLink(user, 'ログセンター', '/admin/log-center');
    await expectReachableLink(user, '薬局ヘルス', '/admin/pharmacy-health');
    expect(screen.getByRole('link', { name: '編集' })).toHaveAttribute('href', '/admin/pharmacies/1/edit');
  });

  it('shows related admin destinations on the rate-limits page', async () => {
    const user = userEvent.setup();
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
    await expectReachableLink(user, 'ログセンター', '/admin/log-center');
    await expectReachableLink(user, 'エラーコード', '/admin/error-codes');
    await expectReachableLink(user, '通知・配信状況', '/admin/notifications');
    await expectReachableLink(user, 'OpenClaw連携', '/admin/openclaw');
    await expectReachableLink(user, '監査ログ', '/admin/audit');
  });

  it('shows related admin destinations on the relationships page', async () => {
    const user = userEvent.setup();
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
    await expectReachableLink(user, '薬局ヘルス', '/admin/pharmacy-health');
    await expectReachableLink(user, 'グループ管理', '/admin/groups');
    await expectReachableLink(user, '営業時間', '/admin/business-hours');
    await expectReachableLink(user, '一括操作', '/admin/bulk-actions');
    expect(screen.getByRole('link', { name: '元薬局を編集' })).toHaveAttribute('href', '/admin/pharmacies/1/edit');
  });

  it('shows related admin destinations on the bulk-actions page', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL) => jsonResponse({ error: 'Not found' }, 404)));

    renderWithProviders(<AdminBulkActionsPage />, {
      route: '/admin/bulk-actions',
      authUser: mockAdminUser,
    });

    expect(screen.getByText('一括操作')).toBeInTheDocument();
    await expectReachableLink(user, '監査ログ', '/admin/audit');
    await expectReachableLink(user, '薬局管理', '/admin/pharmacies');
    await expectReachableLink(user, '取込ジョブ管理', '/admin/upload-jobs');
    await expectReachableLink(user, 'ログセンター', '/admin/log-center');
  });

  it('shows related admin destinations on the pharmacy-health page', async () => {
    const user = userEvent.setup();
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
    await expectReachableLink(user, '関係性監査', '/admin/relationships');
    await expectReachableLink(user, '営業時間', '/admin/business-hours');
    await expectReachableLink(user, '一括操作', '/admin/bulk-actions');
    await expectReachableLink(user, 'ログセンター', '/admin/log-center');
    expect(screen.getAllByRole('link', { name: '編集' }).some((link) => link.getAttribute('href') === '/admin/pharmacies/1/edit')).toBe(true);
  });

  it('shows related admin destinations on the drug-equivalences page', async () => {
    const user = userEvent.setup();
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
    await expectReachableLink(user, '医薬品マスター', '/admin/drug-master');
    await expectReachableLink(user, 'マッチングルール', '/admin/matching-rules');
    await expectReachableLink(user, 'マッチング実験', '/admin/matching-experiments');
    await expectReachableLink(user, 'エラーコード', '/admin/error-codes');
  });

  it('shows related admin destinations on the pharmacies page', async () => {
    const user = userEvent.setup();
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
    await expectReachableLink(user, '営業時間', '/admin/business-hours');
    await expectReachableLink(user, '一括操作', '/admin/bulk-actions');
    await expectReachableLink(user, '関係性監査', '/admin/relationships');
  });

  it('shows related admin destinations on the groups page', async () => {
    const user = userEvent.setup();
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
    await expectReachableLink(user, '関係性監査', '/admin/relationships');
    await expectReachableLink(user, '薬局ヘルス', '/admin/pharmacy-health');
    await expectReachableLink(user, 'ログセンター', '/admin/log-center');
    await expectReachableLink(user, '営業時間', '/admin/business-hours');
  });
});
