import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminBusinessHoursPage from '../../pages/admin/AdminBusinessHoursPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminBusinessHoursPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps pharmacy health reachable when business-hour datasets are empty', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/business-hours/special')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes('/api/admin/business-hours')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminBusinessHoursPage />, {
      route: '/admin/business-hours',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('営業時間カレンダー')).toBeInTheDocument();
    });

    expect(screen.getByText('営業時間データがありません')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '薬局管理' }).some((link) => link.getAttribute('href') === '/admin/pharmacies')).toBe(true);

    await user.click(screen.getByRole('tab', { name: '特別営業・休業日' }));
    await user.click(screen.getAllByRole('button', { name: '関連' }).at(-1)!);

    expect(screen.getAllByRole('link', { name: '薬局ヘルス' }).some((link) => link.getAttribute('href') === '/admin/pharmacy-health')).toBe(true);
  });

  it('links each business-hours record back to pharmacy editing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/business-hours/special')) {
        return jsonResponse({
          data: [
            {
              id: 4,
              pharmacyId: 11,
              pharmacyName: 'あおぞら薬局',
              specialType: 'temporary_closed',
              startDate: '2026-04-10',
              endDate: '2026-04-10',
              openTime: null,
              closeTime: null,
              isClosed: true,
              is24Hours: false,
              note: null,
            },
          ],
        });
      }
      if (url.includes('/api/admin/business-hours')) {
        return jsonResponse({
          data: [
            {
              pharmacyId: 11,
              pharmacyName: 'あおぞら薬局',
              dayOfWeek: 1,
              openTime: '09:00',
              closeTime: '18:00',
              isClosed: false,
              is24Hours: false,
            },
          ],
        });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminBusinessHoursPage />, {
      route: '/admin/business-hours',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: '編集' }).some((link) => link.getAttribute('href') === '/admin/pharmacies/11/edit')).toBe(true);
    });

    expect(screen.getAllByRole('link', { name: '編集' }).some((link) => link.getAttribute('href') === '/admin/pharmacies/11/edit')).toBe(true);
  });
});
