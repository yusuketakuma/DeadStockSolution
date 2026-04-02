import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StatisticsPage from '../../pages/StatisticsPage';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

import { useApiQuery } from '../../hooks/useApiQuery';

describe('StatisticsPage', () => {
  beforeEach(() => {
    vi.mocked(useApiQuery).mockReset();
  });

  it('shows loading indicator and renders empty-state panels before the first summary payload arrives', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
    } as ReturnType<typeof useApiQuery>);

    render(
      <MemoryRouter>
        <StatisticsPage />
      </MemoryRouter>,
    );

    // The page shows the loading indicator while fetching
    expect(screen.getByText('統計データを読み込み中...')).toBeInTheDocument();
    // The page always renders data panels using EMPTY_STATS as fallback,
    // so section headers and labels are present even during loading.
    expect(screen.getAllByText('デッドストック').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('取引ネットワーク')).toBeInTheDocument();
  });

  it('renders attention shortcuts when proposals or alerts require action', () => {
    vi.mocked(useApiQuery)
      .mockReturnValueOnce({
        data: {
          uploads: {
            deadStockCount: 1,
            usedMedicationCount: 1,
            lastDeadStockUpload: null,
            lastUsedMedicationUpload: null,
          },
          inventory: {
            deadStockItems: 1,
            deadStockTotalValue: 100,
            riskScore: 10,
            bucketCounts: null,
          },
          proposals: {
            sent: 0,
            received: 1,
            completed: 0,
            pendingAction: 2,
          },
          exchanges: { totalCount: 0, totalValue: 0 },
          matching: { candidateCount: 0 },
          trust: { score: 0, ratingCount: 0, positiveRate: 0, avgRatingReceived: 0, feedbackCount: 0 },
          network: { favoriteCount: 0, tradingPartnerCount: 0 },
          alerts: { activeCount: 3 },
        },
        error: null,
        isLoading: false,
      } as ReturnType<typeof useApiQuery>)
      .mockReturnValueOnce({
        data: { trends: [], days: 30, startDate: '2026-01-01' },
        error: null,
        isLoading: false,
      } as ReturnType<typeof useApiQuery>);

    render(
      <MemoryRouter>
        <StatisticsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: '提案を確認' })).toHaveAttribute('href', '/proposals');
    expect(screen.getByRole('link', { name: 'アラートを見る' })).toHaveAttribute('href', '/alerts');
  });

  it('renders section shortcuts back to upload, inventory, matching, and network pages', () => {
    vi.mocked(useApiQuery)
      .mockReturnValueOnce({
        data: {
          uploads: {
            deadStockCount: 2,
            usedMedicationCount: 3,
            lastDeadStockUpload: '2026-03-20T00:00:00.000Z',
            lastUsedMedicationUpload: '2026-03-21T00:00:00.000Z',
          },
          inventory: {
            deadStockItems: 4,
            deadStockTotalValue: 500,
            riskScore: 12,
            bucketCounts: null,
          },
          proposals: {
            sent: 1,
            received: 2,
            completed: 3,
            pendingAction: 0,
          },
          exchanges: { totalCount: 1, totalValue: 1000 },
          matching: { candidateCount: 5 },
          trust: { score: 10, ratingCount: 1, positiveRate: 100, avgRatingReceived: 5, feedbackCount: 1 },
          network: { favoriteCount: 2, tradingPartnerCount: 1 },
          alerts: { activeCount: 0 },
        },
        error: null,
        isLoading: false,
      } as ReturnType<typeof useApiQuery>)
      .mockReturnValueOnce({
        data: { trends: [], days: 30, startDate: '2026-01-01' },
        error: null,
        isLoading: false,
      } as ReturnType<typeof useApiQuery>);

    render(
      <MemoryRouter>
        <StatisticsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'アップロード' })).toHaveAttribute('href', '/upload');
    const deadStockLinks = screen.getAllByRole('link', { name: 'デッドストック' });
    expect(deadStockLinks.some((link) => link.getAttribute('href') === '/inventory/dead-stock')).toBe(true);
    expect(screen.getAllByRole('link', { name: '使用量リスト' }).some((link) => link.getAttribute('href') === '/inventory/used-medication')).toBe(true);
    expect(screen.getAllByRole('link', { name: '在庫参照' }).some((link) => link.getAttribute('href') === '/inventory/browse')).toBe(true);
    const matchingLinks = screen.getAllByRole('link', { name: 'マッチング' });
    expect(matchingLinks.some((link) => link.getAttribute('href') === '/matching')).toBe(true);
    expect(screen.getAllByRole('link', { name: '提案一覧' }).some((link) => link.getAttribute('href') === '/proposals')).toBe(true);
    expect(screen.getAllByRole('link', { name: '交換履歴' }).some((link) => link.getAttribute('href') === '/exchange-history')).toBe(true);
    expect(screen.getByRole('link', { name: '薬局一覧' })).toHaveAttribute('href', '/pharmacies');
    expect(screen.getAllByRole('link', { name: 'グループ' }).some((link) => link.getAttribute('href') === '/groups')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'アップロード品質' }).some((link) => link.getAttribute('href') === '/upload-quality')).toBe(true);
  });
});
