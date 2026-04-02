import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminRelationshipsPage from '../../pages/admin/AdminRelationshipsPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminRelationshipsPage', () => {
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

  it('keeps pharmacy health and business-hours recovery links in the empty state', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/relationships?')) {
        return jsonResponse({
          data: [],
          pagination: { page: 1, totalPages: 1, total: 0 },
        });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminRelationshipsPage />, {
      route: '/admin/relationships',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('関係性監査')).toBeInTheDocument();
    });

    expect(screen.getByText('関係性データがありません')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '薬局ヘルス' }).some((link) => link.getAttribute('href') === '/admin/pharmacy-health')).toBe(true);
    expect(screen.getAllByRole('link', { name: '営業時間' }).some((link) => link.getAttribute('href') === '/admin/business-hours')).toBe(true);
  });

  it('offers edit shortcuts for both pharmacies in each relationship row', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/relationships?')) {
        return jsonResponse({
          data: [
            {
              id: 30,
              pharmacyId: 11,
              pharmacyName: 'あおぞら薬局',
              targetPharmacyId: 22,
              targetPharmacyName: 'みどり薬局',
              relationshipType: 'favorite',
              createdAt: '2026-04-01T00:00:00.000Z',
            },
          ],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminRelationshipsPage />, {
      route: '/admin/relationships',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('あおぞら薬局')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: '元薬局を編集' })).toHaveAttribute('href', '/admin/pharmacies/11/edit');
    expect(screen.getByRole('link', { name: '対象薬局を編集' })).toHaveAttribute('href', '/admin/pharmacies/22/edit');
  });
});
