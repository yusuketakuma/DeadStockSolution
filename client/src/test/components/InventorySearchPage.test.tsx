import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import InventorySearchPage from '../../pages/InventorySearchPage';
import type { InventorySearchResponse } from '../../api/client';

vi.mock('../../hooks/useInventorySearch', () => ({
  useInventorySearch: vi.fn(),
}));

vi.mock('../../hooks/useGroupMembership', () => ({
  useGroupMembership: vi.fn(() => ({ isGroupMember: false, groupPharmacyIds: new Set<number>() })),
}));

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock('../../components/mobile/BarcodeScanButton', () => ({
  default: () => null,
}));

vi.mock('../../components/inventory/PharmacySummaryCards', () => ({
  default: () => null,
}));

import { useInventorySearch } from '../../hooks/useInventorySearch';

const defaultHookReturn = {
  chips: [],
  addChip: vi.fn(),
  removeChip: vi.fn(),
  clearChips: vi.fn(),
  filters: { groupOnly: false, openOnly: false, favoritePriority: false },
  setFilters: vi.fn(),
  result: null,
  isSearching: false,
  search: vi.fn(),
  error: null,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <InventorySearchPage />
    </MemoryRouter>,
  );
}

describe('InventorySearchPage', () => {
  it('shows the pre-search guidance message when result is null and not searching', () => {
    vi.mocked(useInventorySearch).mockReturnValue(defaultHookReturn);

    renderPage();

    expect(
      screen.getByText('検索したい薬剤を追加して在庫を確認してください'),
    ).toBeInTheDocument();
  });

  it('does not show the guidance message while searching', () => {
    vi.mocked(useInventorySearch).mockReturnValue({
      ...defaultHookReturn,
      isSearching: true,
    });

    renderPage();

    expect(
      screen.queryByText('検索したい薬剤を追加して在庫を確認してください'),
    ).not.toBeInTheDocument();
  });

  it('shows an error alert when error is set', () => {
    vi.mocked(useInventorySearch).mockReturnValue({
      ...defaultHookReturn,
      error: '検索中にエラーが発生しました',
    });

    renderPage();

    expect(screen.getByText('検索中にエラーが発生しました')).toBeInTheDocument();
  });

  it('shows the inventory matrix when result is available', () => {
    const result: InventorySearchResponse = {
      summary: [],
      matrix: {
        columns: [{ genericName: 'アスピリン', specification: '100mg', columnLabel: 'アスピリン 100mg' }],
        rows: [],
      },
    };

    vi.mocked(useInventorySearch).mockReturnValue({
      ...defaultHookReturn,
      chips: [{ drugMasterId: 1, genericName: 'アスピリン', specification: '100mg', displayLabel: 'アスピリン 100mg' }],
      result,
    });

    renderPage();

    expect(screen.getByText('在庫が見つかりませんでした')).toBeInTheDocument();
    expect(
      screen.queryByText('検索したい薬剤を追加して在庫を確認してください'),
    ).not.toBeInTheDocument();
  });
});
