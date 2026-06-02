import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    const user = userEvent.setup();
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
    const emptyState = screen.getByText('関係性データがありません').closest('.card');
    expect(emptyState).not.toBeNull();
    await user.click(within(emptyState as HTMLElement).getByRole('button', { name: '関連' }));
    await waitFor(() => {
      expect(within(emptyState as HTMLElement).getByRole('link', { name: '薬局ヘルス' })).toHaveAttribute('href', '/admin/pharmacy-health');
      expect(within(emptyState as HTMLElement).getByRole('link', { name: '営業時間' })).toHaveAttribute('href', '/admin/business-hours');
    });
  });

  it('offers edit shortcuts for both pharmacies in each relationship row', async () => {
    const user = userEvent.setup();
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
    const relationshipRow = screen.getByText('あおぞら薬局').closest('tr');
    expect(relationshipRow).not.toBeNull();
    await user.click(within(relationshipRow as HTMLElement).getByRole('button', { name: 'その他' }));
    await waitFor(() => {
      expect(within(relationshipRow as HTMLElement).getByRole('link', { name: '対象薬局を編集' })).toHaveAttribute('href', '/admin/pharmacies/22/edit');
    });
  });
});
