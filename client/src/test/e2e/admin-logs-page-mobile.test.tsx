import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminLogsPage from '../../pages/admin/AdminLogsPage';
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

const baseLog = {
  id: 1001,
  pharmacyId: 20,
  pharmacyName: '中央薬局',
  action: 'login',
  detail: null,
  ipAddress: '192.168.1.1',
  createdAt: '2026-02-27T11:00:00.000Z',
};

describe('AdminLogsPage - Mobile Card View', () => {
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
      if (url.includes('/api/admin/logs?')) {
        return jsonResponse({
          data: [baseLog],
          pagination: { page: 1, totalPages: 1, total: 1 },
          summary: {
            failureTotal: 0,
            failureByAction: {},
            failureByReason: [],
          },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminLogsPage />);

    await waitFor(() => {
      expect(screen.getByText(/操作ログ/)).toBeInTheDocument();
    });

    const mobileContainer = document.querySelector('.dl-mobile-data-list');
    expect(mobileContainer).toBeInTheDocument();

    expect(screen.getByText('ログ #1001')).toBeInTheDocument();
  });

  it('displays log data in mobile card fields', async () => {
    setMatchMedia(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/admin/logs?')) {
        return jsonResponse({
          data: [baseLog],
          pagination: { page: 1, totalPages: 1, total: 1 },
          summary: {
            failureTotal: 0,
            failureByAction: {},
            failureByReason: [],
          },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminLogsPage />);

    await waitFor(() => {
      expect(screen.getByText(/中央薬局/)).toBeInTheDocument();
    });

    const badge = screen.getByText('ログイン', { selector: '.badge' });
    expect(badge).toBeInTheDocument();
    expect(screen.getByText(/192.168.1.1/)).toBeInTheDocument();
  });

  it('shows desktop table on desktop viewport', async () => {
    setMatchMedia(false);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/admin/logs?')) {
        return jsonResponse({
          data: [baseLog],
          pagination: { page: 1, totalPages: 1, total: 1 },
          summary: {
            failureTotal: 0,
            failureByAction: {},
            failureByReason: [],
          },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminLogsPage />);

    await waitFor(() => {
      expect(screen.getByText(/操作ログ/)).toBeInTheDocument();
    });

    const tableContainer = document.querySelector('.table-responsive');
    expect(tableContainer).toBeInTheDocument();

    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('アクション')).toBeInTheDocument();
  });
});
