import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminUploadJobsPage from '../../pages/admin/AdminUploadJobsPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

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
  status: 'failed',
  attempts: 2,
  lastError: '一部行の取込に失敗しました',
  lastErrorCode: 'UPLOAD_CONFIRM_FAILED',
  rowCount: 12,
  createdAt: '2026-02-27T11:00:00.000Z',
  updatedAt: '2026-02-27T11:05:00.000Z',
  completedAt: '2026-02-27T11:05:00.000Z',
  partialSummary: {
    processed: 15,
    failed: 1,
    inserted: 10,
    updated: 2,
  },
  errorReportAvailable: true,
  deduplicated: true,
  cancelable: false,
  retryable: true,
} as const;

describe('AdminUploadJobsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads jobs, opens detail panel, and triggers retry action', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
      if (url.includes('/api/admin/upload-jobs/101/retry') && init?.method === 'POST') {
        return jsonResponse({ message: '再実行を受け付けました' });
      }
      if (url.includes('/api/admin/upload-jobs/101')) {
        return jsonResponse({ data: baseJob });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminUploadJobsPage />);

    await waitFor(() => {
      expect(screen.getByText(/アップロードジョブ管理/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('中央薬局 (ID:20)')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '詳細' }));

    await waitFor(() => {
      expect(screen.getByText('ジョブ詳細 #101')).toBeInTheDocument();
    });
    expect(screen.getByText('部分サマリー')).toBeInTheDocument();
    expect(screen.getByText(/失敗: 1件/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '再実行' }));

    await waitFor(() => {
      expect(screen.getByText('再実行を受け付けました')).toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.some(([request, init]) => (
      String(request).includes('/api/admin/upload-jobs/101/retry')
      && init?.method === 'POST'
    ))).toBe(true);
  });

  it('triggers cancel action with PATCH method', async () => {
    const cancelableJob = {
      ...baseJob,
      status: 'processing',
      cancelable: true,
      deduplicated: false,
      errorReportAvailable: false,
      partialSummary: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/admin/upload-jobs?')) {
        return jsonResponse({
          data: [cancelableJob],
          pagination: { page: 1, totalPages: 1, total: 1 },
        });
      }
      if (url.includes('/api/admin/upload-jobs/101/cancel') && init?.method === 'PATCH') {
        return jsonResponse({ message: 'ジョブのキャンセルを受け付けました' });
      }
      if (url.includes('/api/admin/upload-jobs/101')) {
        return jsonResponse({ data: cancelableJob });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminUploadJobsPage />);

    await waitFor(() => {
      expect(screen.getByText(/アップロードジョブ管理/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '詳細' }));

    await waitFor(() => {
      expect(screen.getByText('ジョブ詳細 #101')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    await waitFor(() => {
      expect(screen.getByText('ジョブのキャンセルを受け付けました')).toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.some(([request, init]) => (
      String(request).includes('/api/admin/upload-jobs/101/cancel')
      && init?.method === 'PATCH'
    ))).toBe(true);
  });
});
