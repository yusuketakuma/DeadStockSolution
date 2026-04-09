import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import UploadQualityPage from '../../pages/UploadQualityPage';
import { renderWithProviders } from '../helpers';

describe('UploadQualityPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders upload quality summary and issue destinations', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/upload-quality/my-summary')) {
        return new Response(JSON.stringify({
          totalIssues: 3,
          issuesByCode: [
            { issueCode: 'MISSING_EXPIRY', count: 2 },
            { issueCode: 'INVALID_PRICE', count: 1 },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/upload-quality/my-issues?page=1&limit=20')) {
        return new Response(JSON.stringify({
          issues: [
            {
              id: 10,
              jobId: 22,
              uploadType: 'dead_stock',
              rowNumber: 7,
              issueCode: 'MISSING_EXPIRY',
              issueMessage: '使用期限がありません',
              createdAt: '2026-04-01T09:00:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(<UploadQualityPage />, { route: '/upload-quality' });

    await waitFor(() => {
      expect(screen.getByText('アップロード品質')).toBeInTheDocument();
    });

    expect(screen.getByText('MISSING_EXPIRY: 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'アップロード' })).toHaveAttribute('href', '/upload');
    expect(screen.getByRole('link', { name: '統計' })).toHaveAttribute('href', '/statistics');
    expect(screen.getByRole('link', { name: 'デッドストックへ' })).toHaveAttribute('href', '/inventory/dead-stock');
    expect(screen.getAllByRole('link', { name: '保存済み設定で再アップロード' })[0]).toHaveAttribute('href', expect.stringContaining('/upload?reuseSavedMapping=1'));
    expect(screen.getByRole('link', { name: '統計を見る' })).toHaveAttribute('href', '/statistics');
  });

  it('shows empty state when no issues exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/upload-quality/my-summary')) {
        return new Response(JSON.stringify({
          totalIssues: 0,
          issuesByCode: [],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/upload-quality/my-issues?page=1&limit=20')) {
        return new Response(JSON.stringify({
          issues: [],
          total: 0,
          page: 1,
          limit: 20,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(<UploadQualityPage />, { route: '/upload-quality' });

    await waitFor(() => {
      expect(screen.getByText('アップロード問題はありません')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'アップロードへ進む' })).toHaveAttribute('href', '/upload');
    expect(screen.getByRole('link', { name: 'アップロードへ戻る' })).toHaveAttribute('href', '/upload');
  });
});
