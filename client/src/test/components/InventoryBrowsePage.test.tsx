import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import InventoryBrowsePage from '../../pages/InventoryBrowsePage';
import type { PrescriptionSearchResponse } from '../../api/client';

// Mock the hook so page tests are independent of network/API logic
vi.mock('../../hooks/usePrescriptionSearch', () => ({
  usePrescriptionSearch: vi.fn(),
}));

// PrescriptionSearchForm depends on api.get for suggestions and BarcodeScanButton for camera
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

// PharmacySummaryCards is not part of this test's scope
vi.mock('../../components/inventory/PharmacySummaryCards', () => ({
  default: () => null,
}));

import { usePrescriptionSearch } from '../../hooks/usePrescriptionSearch';

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
      <InventoryBrowsePage />
    </MemoryRouter>,
  );
}

describe('InventoryBrowsePage', () => {
  it('shows the pre-search guidance message when result is null and not searching', () => {
    vi.mocked(usePrescriptionSearch).mockReturnValue(defaultHookReturn);

    renderPage();

    expect(
      screen.getByText('処方せんに記載された薬剤を追加して検索してください'),
    ).toBeInTheDocument();
  });

  it('does not show the guidance message while searching', () => {
    vi.mocked(usePrescriptionSearch).mockReturnValue({
      ...defaultHookReturn,
      isSearching: true,
    });

    renderPage();

    expect(
      screen.queryByText('処方せんに記載された薬剤を追加して検索してください'),
    ).not.toBeInTheDocument();
  });

  it('shows an error alert when error is set', () => {
    vi.mocked(usePrescriptionSearch).mockReturnValue({
      ...defaultHookReturn,
      error: '検索中にエラーが発生しました',
    });

    renderPage();

    expect(screen.getByText('検索中にエラーが発生しました')).toBeInTheDocument();
  });

  it('shows the inventory matrix when result is available', () => {
    const result: PrescriptionSearchResponse = {
      summary: [],
      matrix: {
        columns: [{ genericName: 'アスピリン', specification: '100mg', columnLabel: 'アスピリン 100mg' }],
        rows: [],
      },
    };

    vi.mocked(usePrescriptionSearch).mockReturnValue({
      ...defaultHookReturn,
      chips: [{ drugMasterId: 1, genericName: 'アスピリン', specification: '100mg', displayLabel: 'アスピリン 100mg' }],
      result,
    });

    renderPage();

    // InventoryMatrix renders "在庫が見つかりませんでした" when rows is empty
    expect(screen.getByText('在庫が見つかりませんでした')).toBeInTheDocument();
    // Pre-search message should be gone
    expect(
      screen.queryByText('処方せんに記載された薬剤を追加して検索してください'),
    ).not.toBeInTheDocument();
  });
});
