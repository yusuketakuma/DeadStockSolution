import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminExchangesPage from '../../pages/admin/AdminExchangesPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseExchange = {
  id: 501,
  proposalId: 1001,
  pharmacyAId: 10,
  pharmacyBId: 20,
  pharmacyAName: '東京薬局',
  pharmacyBName: '中央薬局',
  totalValue: 50000,
  completedAt: '2026-02-27T11:00:00.000Z',
};

describe('AdminExchangesPage - Mobile Card View', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
  });

  it('renders mobile cards on mobile viewport', async () => {
    setMatchMedia(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/admin/history?')) {
        return jsonResponse({
          data: [baseExchange],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminExchangesPage />);

    await waitFor(() => {
      expect(screen.getByText(/交換履歴/)).toBeInTheDocument();
    });

    const mobileContainer = document.querySelector('.dl-mobile-data-list');
    expect(mobileContainer).toBeInTheDocument();

    expect(screen.getByText('履歴ID: 501')).toBeInTheDocument();
    expect(screen.getByText('提案ID: 1001')).toBeInTheDocument();
  });

  it('displays exchange data in mobile card fields', async () => {
    setMatchMedia(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/admin/history?')) {
        return jsonResponse({
          data: [baseExchange],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminExchangesPage />);

    await waitFor(() => {
      expect(screen.getByText(/東京薬局/)).toBeInTheDocument();
    });

    expect(screen.getByText(/中央薬局/)).toBeInTheDocument();
    expect(screen.getByText(/50,000/)).toBeInTheDocument();
  });

  it('shows desktop table on desktop viewport', async () => {
    setMatchMedia(false);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/admin/history?')) {
        return jsonResponse({
          data: [baseExchange],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminExchangesPage />);

    await waitFor(() => {
      expect(screen.getByText(/交換履歴/)).toBeInTheDocument();
    });

    const tableContainer = document.querySelector('.table-responsive');
    expect(tableContainer).toBeInTheDocument();

    expect(screen.getByText('履歴ID')).toBeInTheDocument();
    expect(screen.getByText('提案ID')).toBeInTheDocument();
  });
});
