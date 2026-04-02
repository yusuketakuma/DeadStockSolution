import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InventorySearchPage from '../../pages/InventorySearchPage';
import { api, type InventorySearchResponse } from '../../api/client';

const persistenceHookReturn = {
  preferencesVersion: 0,
  preferencesSaveError: null,
  preferencesConflict: null,
  autosaveStatusLabel: null,
  seedLoadedPreferences: vi.fn(),
  resetPersistenceState: vi.fn(),
  clearConflict: vi.fn(),
  acceptLatestConflictVersion: vi.fn(),
  keepLocalChangesAfterConflict: vi.fn(),
};

const routeSyncHookReturn = {
  routeWarningMessage: null,
  setRouteWarningMessage: vi.fn(),
  replaceRouteState: vi.fn(),
};

vi.mock('../../hooks/useInventorySearch', () => ({
  useInventorySearch: vi.fn(),
}));

vi.mock('../../hooks/useGroupMembership', () => ({
  useGroupMembership: vi.fn(() => ({ isGroupMember: false, groupPharmacyIds: new Set<number>() })),
}));

vi.mock('../../hooks/useInventorySearchPreferencesPersistence', () => ({
  useInventorySearchPreferencesPersistence: vi.fn(() => persistenceHookReturn),
}));

vi.mock('../../hooks/useInventorySearchRouteSync', () => ({
  useInventorySearchRouteSync: vi.fn(() => routeSyncHookReturn),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, email: 'test@example.com', name: 'テスト薬局', prefecture: '東京都', isAdmin: false },
  })),
}));

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn().mockResolvedValue({
        version: 1,
        draft: { chips: [], filters: { groupOnly: false, openOnly: false, favoritePriority: false }, useCurrentLocation: false },
        searchHistory: [],
        savedPresets: [],
      }),
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
const mockApiGet = vi.mocked(api.get);

const defaultHookReturn = {
  chips: [],
  addChip: vi.fn(),
  removeChip: vi.fn(),
  clearChips: vi.fn(),
  applyPersistedSearchState: vi.fn(),
  useCurrentLocation: false,
  setUseCurrentLocation: vi.fn(),
  filters: { groupOnly: false, openOnly: false, favoritePriority: false },
  setFilters: vi.fn(),
  result: null,
  resetResultView: vi.fn(),
  isSearching: false,
  search: vi.fn(),
  error: null,
};

function renderPage(route = '/inventory-search') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <InventorySearchPage />
    </MemoryRouter>,
  );
}

describe('InventorySearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useInventorySearch).mockReturnValue(defaultHookReturn);
    mockApiGet.mockResolvedValue({
      version: 1,
      draft: { chips: [], filters: { groupOnly: false, openOnly: false, favoritePriority: false }, useCurrentLocation: false },
      searchHistory: [],
      savedPresets: [],
    });
  });

  it('shows the pre-search guidance message when result is null and not searching', () => {
    renderPage();

    expect(
      screen.getByText('検索したい薬剤を追加して在庫を確認してください'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '在庫参照' })).toHaveAttribute('href', '/inventory/browse');
    expect(screen.getByRole('link', { name: 'この条件でマッチング' })).toHaveAttribute('href', '/matching');
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

  it('carries selected chips into the matching link', () => {
    vi.mocked(useInventorySearch).mockReturnValue({
      ...defaultHookReturn,
      chips: [{ drugMasterId: 1, genericName: 'アスピリン', specification: '100mg', displayLabel: 'アスピリン 100mg' }],
    });

    renderPage();

    expect(screen.getByRole('link', { name: 'この条件でマッチング' })).toHaveAttribute(
      'href',
      '/matching?inventorySearchDrugs=%E3%82%A2%E3%82%B9%E3%83%94%E3%83%AA%E3%83%B3+100mg',
    );
  });

  it('seeds the hydrated route state as the autosave baseline when preferences load fails', async () => {
    const applyPersistedSearchState = vi.fn();
    vi.mocked(useInventorySearch).mockReturnValue({
      ...defaultHookReturn,
      applyPersistedSearchState,
    });
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/account/inventory-search-preferences') {
        throw new Error('preferences failed');
      }
      if (path.startsWith('/search/drug-master/by-ids?ids=1')) {
        return [{
          id: 1,
          drugName: 'アスピリン錠',
          genericName: 'アスピリン',
          specification: '100mg',
        }];
      }
      throw new Error(`unexpected path: ${path}`);
    });

    renderPage('/inventory-search?drugId=1&groupOnly=1');

    await waitFor(() => {
      expect(persistenceHookReturn.seedLoadedPreferences).toHaveBeenCalledWith({
        version: 0,
        draft: {
          chips: [{
            drugMasterId: 1,
            genericName: 'アスピリン',
            specification: '100mg',
            displayLabel: 'アスピリン 100mg',
          }],
          filters: {
            groupOnly: true,
            openOnly: false,
            favoritePriority: false,
          },
          useCurrentLocation: false,
        },
        searchHistory: [],
        savedPresets: [],
      });
    });
  });
});
