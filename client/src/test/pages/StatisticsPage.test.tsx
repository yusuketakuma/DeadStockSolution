import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatisticsPage from '../../pages/StatisticsPage';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

import { useApiQuery } from '../../hooks/useApiQuery';

describe('StatisticsPage', () => {
  it('shows loading indicator and renders empty-state panels before the first summary payload arrives', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
    } as ReturnType<typeof useApiQuery>);

    render(<StatisticsPage />);

    // The page shows the loading indicator while fetching
    expect(screen.getByText('統計データを読み込み中...')).toBeInTheDocument();
    // The page always renders data panels using EMPTY_STATS as fallback,
    // so section headers and labels are present even during loading.
    expect(screen.getAllByText('デッドストック').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('取引ネットワーク')).toBeInTheDocument();
  });
});
