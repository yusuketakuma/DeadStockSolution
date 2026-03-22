import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInventorySearch } from '../../hooks/useInventorySearch';
import { api, type InventorySearchResponse } from '../../api/client';
import type { PersistedInventorySearchState } from '../../pages/inventory-search-state';

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      inventorySearch: vi.fn(),
    },
  };
});

const mockApi = vi.mocked(api);

const mockResult: InventorySearchResponse = {
  summary: [
    {
      pharmacyId: 2,
      pharmacyName: 'テスト薬局',
      matchedCount: 1,
      totalDrugs: 1,
      totalYakka: 100,
      distance: null,
      businessStatus: { isOpen: true, message: '09:00〜18:00', isConfigured: true },
      isFavorite: false,
      isGroupMember: false,
    },
  ],
  matrix: {
    columns: [{ genericName: 'アスピリン', specification: '100mg', columnLabel: 'アスピリン 100mg' }],
    rows: [
      {
        pharmacyId: 2,
        pharmacyName: 'テスト薬局',
        cells: [{ available: true, items: [{ drugName: 'アスピリン錠100mg', manufacturer: null, yakkaUnitPrice: 100, quantity: 5, unit: '錠' }] }],
      },
    ],
  },
};

describe('useInventorySearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.inventorySearch.mockResolvedValue(mockResult);
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(),
      },
    });
  });

  it('returns search results after search is called with chips', async () => {
    const { result } = renderHook(() => useInventorySearch());

    act(() => {
      result.current.addChip({
        drugMasterId: 1,
        genericName: 'アスピリン',
        specification: '100mg',
        displayLabel: 'アスピリン 100mg',
      });
    });

    await act(async () => {
      await result.current.search();
    });

    expect(result.current.result).toEqual(mockResult);
    expect(result.current.isSearching).toBe(false);
  });

  it('clearChips resets result to null', async () => {
    const { result } = renderHook(() => useInventorySearch());

    act(() => {
      result.current.addChip({
        drugMasterId: 1,
        genericName: 'アスピリン',
        specification: '100mg',
        displayLabel: 'アスピリン 100mg',
      });
    });

    await act(async () => {
      await result.current.search();
    });

    expect(result.current.result).toEqual(mockResult);

    act(() => {
      result.current.clearChips();
    });

    expect(result.current.result).toBeNull();
    expect(result.current.chips).toHaveLength(0);
  });

  it('passes coordinates as null and includes drugKeys and filters in search request', async () => {
    const { result } = renderHook(() => useInventorySearch());

    act(() => {
      result.current.addChip({
        drugMasterId: 1,
        genericName: 'アスピリン',
        specification: '100mg',
        displayLabel: 'アスピリン 100mg',
      });
    });

    await act(async () => {
      await result.current.search();
    });

    expect(mockApi.inventorySearch).toHaveBeenCalledWith(
      {
        drugKeys: [{ drugMasterId: 1, genericName: 'アスピリン', specification: '100mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        coordinates: null,
      },
      expect.anything(),
    );
  });

  it('requests current coordinates when useCurrentLocation is enabled', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 35.68,
          longitude: 139.76,
        },
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    const { result } = renderHook(() => useInventorySearch());

    act(() => {
      result.current.addChip({
        drugMasterId: 1,
        genericName: 'アスピリン',
        specification: '100mg',
        displayLabel: 'アスピリン 100mg',
      });
      result.current.setUseCurrentLocation(true);
    });

    await act(async () => {
      await result.current.search();
    });

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(mockApi.inventorySearch).toHaveBeenCalledWith(
      {
        drugKeys: [{ drugMasterId: 1, genericName: 'アスピリン', specification: '100mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        coordinates: { latitude: 35.68, longitude: 139.76 },
      },
      expect.anything(),
    );
  });

  it('surfaces current-location errors without issuing the search request', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback | undefined) => {
      error?.({
        code: 1,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    const { result } = renderHook(() => useInventorySearch());

    act(() => {
      result.current.addChip({
        drugMasterId: 1,
        genericName: 'アスピリン',
        specification: '100mg',
        displayLabel: 'アスピリン 100mg',
      });
      result.current.setUseCurrentLocation(true);
    });

    await act(async () => {
      await result.current.search();
    });

    expect(mockApi.inventorySearch).not.toHaveBeenCalled();
    expect(result.current.error).toBe('位置情報の利用が許可されていません');
    expect(result.current.isSearching).toBe(false);
  });

  it('applies a persisted search state and clears the previous result view', async () => {
    const { result } = renderHook(() => useInventorySearch());

    act(() => {
      result.current.addChip({
        drugMasterId: 1,
        genericName: 'アスピリン',
        specification: '100mg',
        displayLabel: 'アスピリン 100mg',
      });
    });

    await act(async () => {
      await result.current.search();
    });

    const persistedState: PersistedInventorySearchState = {
      chips: [{ drugMasterId: 2, genericName: 'ロキソプロフェン', specification: '60mg', displayLabel: 'ロキソプロフェン 60mg' }],
      filters: { groupOnly: true, openOnly: true, favoritePriority: false },
      useCurrentLocation: false,
    };

    act(() => {
      result.current.applyPersistedSearchState(persistedState);
    });

    expect(result.current.chips).toEqual(persistedState.chips);
    expect(result.current.filters).toEqual(persistedState.filters);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('resetResultView clears result and error without changing chips', async () => {
    const { result } = renderHook(() => useInventorySearch());

    act(() => {
      result.current.addChip({
        drugMasterId: 1,
        genericName: 'アスピリン',
        specification: '100mg',
        displayLabel: 'アスピリン 100mg',
      });
    });

    await act(async () => {
      await result.current.search();
    });

    act(() => {
      result.current.resetResultView();
    });

    expect(result.current.chips).toHaveLength(1);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
