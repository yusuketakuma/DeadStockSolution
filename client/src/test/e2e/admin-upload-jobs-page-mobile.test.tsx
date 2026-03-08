import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminUploadJobsPage from '../../pages/admin/AdminUploadJobsPage';
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

const baseJob = {
  id: 101,
  pharmacyId: 20,
  pharmacyName: '中央薬局',
  uploadType: 'dead_stock',
  applyMode: 'diff',
  deleteMissing: true,
  originalFilename: 'stock-2026-02.xlsx',
  status: 'completed',
  attempts: 1,
  lastError: null,
  lastErrorCode: null,
  rowCount: 12,
  createdAt: '2026-02-27T11:00:00.000Z',
  updatedAt: '2026-02-27T11:05:00.000Z',
  completedAt: '2026-02-27T11:05:00.000Z',
  partialSummary: null,
  deduplicated: false,
  cancelable: false,
  retryable: false,
} as const;

describe('AdminUploadJobsPage - Mobile Card View', () => {
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
      if (url.includes('/api/admin/upload-jobs?')) {
        return jsonResponse({
          data: [baseJob],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminUploadJobsPage />);

    await waitFor(() => {
      expect(screen.getByText(/アップロードジョブ管理/)).toBeInTheDocument();
    });

    const mobileContainer = document.querySelector('.dl-mobile-data-list');
    expect(mobileContainer).toBeInTheDocument();

    expect(screen.getByText('ジョブID: 101')).toBeInTheDocument();
    expect(screen.getByText('stock-2026-02.xlsx')).toBeInTheDocument();
  });

  it('displays job data in mobile card fields', async () => {
    setMatchMedia(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/admin/upload-jobs?')) {
        return jsonResponse({
          data: [baseJob],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminUploadJobsPage />);

    await waitFor(() => {
      expect(screen.getByText(/中央薬局/)).toBeInTheDocument();
    });

    expect(screen.getByText('デッドストックリスト')).toBeInTheDocument();
    expect(screen.getByText('差分')).toBeInTheDocument();
  });

  it('shows desktop table on desktop viewport', async () => {
    setMatchMedia(false);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/admin/upload-jobs?')) {
        return jsonResponse({
          data: [baseJob],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminUploadJobsPage />);

    await waitFor(() => {
      expect(screen.getByText(/アップロードジョブ管理/)).toBeInTheDocument();
    });

    const tableContainer = document.querySelector('.table-responsive');
    expect(tableContainer).toBeInTheDocument();

    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('薬局')).toBeInTheDocument();
  });
});
