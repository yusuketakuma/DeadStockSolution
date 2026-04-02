import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminPharmaciesPage from '../../pages/admin/AdminPharmaciesPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminPharmaciesPage', () => {
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

  it('keeps adjacent pharmacy operations reachable from the page header', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/pharmacies/trust?page=1')) {
        return jsonResponse({
          data: [],
          pagination: { page: 1, totalPages: 1, total: 0 },
        });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminPharmaciesPage />, {
      route: '/admin/pharmacies',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('薬局管理')).toBeInTheDocument();
    });

    expect(screen.getAllByRole('link', { name: '営業時間' }).some((link) => link.getAttribute('href') === '/admin/business-hours')).toBe(true);
    expect(screen.getAllByRole('link', { name: '一括操作' }).some((link) => link.getAttribute('href') === '/admin/bulk-actions')).toBe(true);
  });
});
