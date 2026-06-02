import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('renders attention shortcuts when proposals or alerts require action', async () => {
    const user = userEvent.setup();
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

    expect(screen.getAllByRole('link', { name: '提案を確認' }).some((link) => link.getAttribute('href') === '/proposals')).toBe(true);
    expect(screen.queryByRole('link', { name: 'アラートを確認' })).not.toBeInTheDocument();
    const attentionPanel = screen.getByText('要対応').closest('.card');
    expect(attentionPanel).not.toBeNull();
    const attentionScope = within(attentionPanel as HTMLElement);
    await user.click(attentionScope.getByRole('button', { name: '関連' }));
    expect(attentionScope.getByRole('link', { name: 'アラートを確認' })).toHaveAttribute('href', '/alerts');
  });

  it('renders section shortcuts back to upload, inventory, matching, and network pages', async () => {
    const user = userEvent.setup();
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

    const inventoryPanel = screen.getByText('在庫状況').closest('.card');
    expect(inventoryPanel).not.toBeNull();
    const inventoryScope = within(inventoryPanel as HTMLElement);
    expect(inventoryScope.getByRole('link', { name: 'デッドストックを確認' })).toHaveAttribute('href', '/inventory/dead-stock');
    await user.click(inventoryScope.getByRole('button', { name: '関連' }));
    expect(inventoryScope.getByRole('link', { name: '使用量リストを確認' })).toHaveAttribute('href', '/inventory/used-medication');
    expect(inventoryScope.getByRole('link', { name: '在庫参照を確認' })).toHaveAttribute('href', '/inventory/browse');

    const matchingPanel = screen.getByText('マッチング・交換').closest('.card');
    expect(matchingPanel).not.toBeNull();
    const matchingScope = within(matchingPanel as HTMLElement);
    expect(matchingScope.getByRole('link', { name: '候補を確認' })).toHaveAttribute('href', '/matching');
    await user.click(matchingScope.getByRole('button', { name: '関連' }));
    expect(matchingScope.getByRole('link', { name: '提案一覧を確認' })).toHaveAttribute('href', '/proposals');
    expect(matchingScope.getByRole('link', { name: '交換履歴を確認' })).toHaveAttribute('href', '/exchange-history');

    expect(screen.getByRole('link', { name: '薬局一覧' })).toHaveAttribute('href', '/pharmacies');
    await user.click(screen.getByRole('button', { name: '関連画面' }));
    expect(screen.getAllByRole('link', { name: 'グループを確認' }).some((link) => link.getAttribute('href') === '/groups')).toBe(true);
    expect(screen.getAllByRole('link', { name: '品質を確認' }).some((link) => link.getAttribute('href') === '/upload-quality')).toBe(true);
  });
});
