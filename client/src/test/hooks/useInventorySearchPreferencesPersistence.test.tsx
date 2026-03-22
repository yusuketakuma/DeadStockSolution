import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInventorySearchPreferencesPersistence } from '../../hooks/useInventorySearchPreferencesPersistence';
import { api, ApiError } from '../../api/client';
import { defaultSearchState } from '../../pages/inventory-search-state';
import type { PersistedInventorySearchState } from '../../pages/inventory-search-state';
import type {
  InventorySearchHistoryItem,
  InventorySearchPreferencesResponse,
  InventorySearchSavedPreset,
} from '../../../../shared/inventory-search-preferences';

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      put: vi.fn(),
    },
  };
});

const mockApi = vi.mocked(api);

function makeHistoryItem(id: string): InventorySearchHistoryItem {
  return {
    id,
    label: `検索 ${id}`,
    lastUsedAt: new Date().toISOString(),
    useCount: 1,
    chips: [],
    filters: { groupOnly: false, openOnly: false, favoritePriority: false },
    useCurrentLocation: false,
  };
}

function makePreset(id: string): InventorySearchSavedPreset {
  return {
    id,
    name: `プリセット ${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    useCount: 0,
    pinned: false,
    chips: [],
    filters: { groupOnly: false, openOnly: false, favoritePriority: false },
    useCurrentLocation: false,
  };
}

function makePreferences(overrides: Partial<InventorySearchPreferencesResponse> = {}): InventorySearchPreferencesResponse {
  return {
    version: 1,
    draft: defaultSearchState(),
    searchHistory: [],
    savedPresets: [],
    ...overrides,
  };
}

interface HookParams {
  userId?: number;
  currentSearchState: PersistedInventorySearchState;
  searchHistory: InventorySearchHistoryItem[];
  savedPresets: InventorySearchSavedPreset[];
  preferencesLoaded: boolean;
  isHydratingState: boolean;
  applyLatestPreferences?: (preferences: InventorySearchPreferencesResponse) => void;
}

function makeDefaultParams(overrides: Partial<HookParams> = {}): HookParams {
  return {
    userId: 1,
    currentSearchState: defaultSearchState(),
    searchHistory: [],
    savedPresets: [],
    preferencesLoaded: true,
    isHydratingState: false,
    ...overrides,
  };
}

describe('useInventorySearchPreferencesPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // shouldAdvanceTime allows @testing-library/react's waitFor polling to work
    // while still controlling setTimeout/setInterval for debounce assertions.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('initializes with preferencesVersion 0', () => {
      const { result } = renderHook(() =>
        useInventorySearchPreferencesPersistence(makeDefaultParams()),
      );
      expect(result.current.preferencesVersion).toBe(0);
    });

    it('initializes with no save error', () => {
      const { result } = renderHook(() =>
        useInventorySearchPreferencesPersistence(makeDefaultParams()),
      );
      expect(result.current.preferencesSaveError).toBeNull();
    });

    it('initializes with no conflict', () => {
      const { result } = renderHook(() =>
        useInventorySearchPreferencesPersistence(makeDefaultParams()),
      );
      expect(result.current.preferencesConflict).toBeNull();
    });

    it('initializes with no autosave status label', () => {
      const { result } = renderHook(() =>
        useInventorySearchPreferencesPersistence(makeDefaultParams()),
      );
      expect(result.current.autosaveStatusLabel).toBeNull();
    });
  });

  describe('seedLoadedPreferences', () => {
    it('updates preferencesVersion from loaded preferences', () => {
      const { result } = renderHook(() =>
        useInventorySearchPreferencesPersistence(makeDefaultParams()),
      );

      act(() => {
        result.current.seedLoadedPreferences(makePreferences({ version: 5 }));
      });

      expect(result.current.preferencesVersion).toBe(5);
    });

    it('clears conflict and error when seeding preferences', () => {
      const { result } = renderHook(() =>
        useInventorySearchPreferencesPersistence(makeDefaultParams()),
      );

      // Manually set conflict state via acceptLatestConflictVersion indirectly
      // by seeding with conflict data first then clearing
      act(() => {
        result.current.seedLoadedPreferences(makePreferences({ version: 3 }));
      });

      expect(result.current.preferencesConflict).toBeNull();
      expect(result.current.preferencesSaveError).toBeNull();
    });

    it('clears autosave status label when seeding preferences', () => {
      const { result } = renderHook(() =>
        useInventorySearchPreferencesPersistence(makeDefaultParams()),
      );

      act(() => {
        result.current.seedLoadedPreferences(makePreferences({ version: 2 }));
      });

      expect(result.current.autosaveStatusLabel).toBeNull();
    });
  });

  describe('resetPersistenceState', () => {
    it('resets preferencesVersion to 0', () => {
      const { result } = renderHook(() =>
        useInventorySearchPreferencesPersistence(makeDefaultParams()),
      );

      act(() => {
        result.current.seedLoadedPreferences(makePreferences({ version: 7 }));
      });

      expect(result.current.preferencesVersion).toBe(7);

      act(() => {
        result.current.resetPersistenceState();
      });

      expect(result.current.preferencesVersion).toBe(0);
    });

    it('clears conflict state', () => {
      const { result } = renderHook(() =>
        useInventorySearchPreferencesPersistence(makeDefaultParams()),
      );

      act(() => {
        result.current.resetPersistenceState();
      });

      expect(result.current.preferencesConflict).toBeNull();
      expect(result.current.preferencesSaveError).toBeNull();
    });
  });

  describe('clearConflict', () => {
    it('clears preferencesConflict and preferencesSaveError', () => {
      const { result } = renderHook(() =>
        useInventorySearchPreferencesPersistence(makeDefaultParams()),
      );

      act(() => {
        result.current.clearConflict();
      });

      expect(result.current.preferencesConflict).toBeNull();
      expect(result.current.preferencesSaveError).toBeNull();
    });
  });

  describe('acceptLatestConflictVersion', () => {
    it('does nothing when there is no conflict', () => {
      const { result } = renderHook(() =>
        useInventorySearchPreferencesPersistence(makeDefaultParams()),
      );

      const versionBefore = result.current.preferencesVersion;

      act(() => {
        result.current.acceptLatestConflictVersion();
      });

      expect(result.current.preferencesVersion).toBe(versionBefore);
    });

    it('applies the latest conflict payload and updates the version', async () => {
      const conflictPreferences = makePreferences({
        version: 10,
        draft: {
          chips: [{ drugMasterId: 99, genericName: '最新薬', specification: '5mg', displayLabel: '最新薬 5mg' }],
          filters: { groupOnly: true, openOnly: false, favoritePriority: true },
          useCurrentLocation: false,
        },
        searchHistory: [makeHistoryItem('remote')],
        savedPresets: [makePreset('remote')],
      });
      const applyLatestPreferences = vi.fn();
      const apiError = new ApiError(409, 'Conflict', { latestData: conflictPreferences });
      (mockApi.put as ReturnType<typeof vi.fn>).mockRejectedValue(apiError);

      const changedState: PersistedInventorySearchState = {
        chips: [{ drugMasterId: 10, genericName: '手元薬', specification: '10mg', displayLabel: '手元薬 10mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        useCurrentLocation: false,
      };

      const params = makeDefaultParams({ currentSearchState: changedState, applyLatestPreferences });
      const { result } = renderHook(() => useInventorySearchPreferencesPersistence(params));

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current.preferencesConflict).toEqual(conflictPreferences);
      });

      act(() => {
        result.current.acceptLatestConflictVersion();
      });

      expect(applyLatestPreferences).toHaveBeenCalledWith(conflictPreferences);
      expect(result.current.preferencesVersion).toBe(10);
      expect(result.current.preferencesConflict).toBeNull();
      expect(result.current.preferencesSaveError).toBeNull();
      expect(result.current.autosaveStatusLabel).toBe('最新の条件を反映しました');
    });
  });

  describe('keepLocalChangesAfterConflict', () => {
    it('promotes the latest version and clears the conflict without applying remote state', async () => {
      const conflictPreferences = makePreferences({ version: 8 });
      const applyLatestPreferences = vi.fn();
      const apiError = new ApiError(409, 'Conflict', { latestData: conflictPreferences });
      (mockApi.put as ReturnType<typeof vi.fn>).mockRejectedValue(apiError);

      const changedState: PersistedInventorySearchState = {
        chips: [{ drugMasterId: 12, genericName: '継続薬', specification: '10mg', displayLabel: '継続薬 10mg' }],
        filters: { groupOnly: false, openOnly: true, favoritePriority: false },
        useCurrentLocation: false,
      };

      const params = makeDefaultParams({ currentSearchState: changedState, applyLatestPreferences });
      const { result } = renderHook(() => useInventorySearchPreferencesPersistence(params));

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current.preferencesConflict).toEqual(conflictPreferences);
      });

      act(() => {
        result.current.keepLocalChangesAfterConflict();
      });

      expect(applyLatestPreferences).not.toHaveBeenCalled();
      expect(result.current.preferencesVersion).toBe(8);
      expect(result.current.preferencesConflict).toBeNull();
      expect(result.current.preferencesSaveError).toBeNull();
      expect(result.current.autosaveStatusLabel).toBe('この画面の条件を再保存します');
    });
  });

  describe('autosave debouncing — draft', () => {
    it('does not call api.put immediately when draft changes', () => {
      const changedState: PersistedInventorySearchState = {
        chips: [{ drugMasterId: 1, genericName: 'アスピリン', specification: '100mg', displayLabel: 'アスピリン 100mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        useCurrentLocation: false,
      };

      const params = makeDefaultParams({ currentSearchState: changedState });
      renderHook(() => useInventorySearchPreferencesPersistence(params));

      // No save yet — timer hasn't fired
      expect(mockApi.put).not.toHaveBeenCalled();
    });

    it('calls api.put after 300ms debounce when draft changes', async () => {
      (mockApi.put as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok', version: 2 });

      const changedState: PersistedInventorySearchState = {
        chips: [{ drugMasterId: 1, genericName: 'アスピリン', specification: '100mg', displayLabel: 'アスピリン 100mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        useCurrentLocation: false,
      };

      // First, seed preferences so lastSavedDraftSnapshot is set (version = 0 initially, draft = default)
      // Then rerender with changed state so the snapshot differs
      const params = makeDefaultParams({ currentSearchState: changedState });
      renderHook(() => useInventorySearchPreferencesPersistence(params));

      // Advance timers by exactly 300ms to fire debounce
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(mockApi.put).toHaveBeenCalledWith(
        '/account/inventory-search-preferences/draft',
        expect.objectContaining({ draft: changedState }),
        expect.anything(),
      );
    });

    it('shows "自動保存中..." status while saving', async () => {
      let resolveSave!: (value: { message: string; version: number }) => void;
      (mockApi.put as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise((resolve) => { resolveSave = resolve; }),
      );

      const changedState: PersistedInventorySearchState = {
        chips: [{ drugMasterId: 2, genericName: 'Drug', specification: '5mg', displayLabel: 'Drug 5mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        useCurrentLocation: false,
      };

      const params = makeDefaultParams({ currentSearchState: changedState });
      const { result } = renderHook(() => useInventorySearchPreferencesPersistence(params));

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.autosaveStatusLabel).toBe('自動保存中...');

      await act(async () => {
        resolveSave({ message: 'ok', version: 2 });
      });
    });

    it('shows "自動保存済み" status after successful save', async () => {
      (mockApi.put as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok', version: 2 });

      const changedState: PersistedInventorySearchState = {
        chips: [{ drugMasterId: 3, genericName: 'Drug3', specification: '10mg', displayLabel: 'Drug3 10mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        useCurrentLocation: false,
      };

      const params = makeDefaultParams({ currentSearchState: changedState });
      const { result } = renderHook(() => useInventorySearchPreferencesPersistence(params));

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current.autosaveStatusLabel).toBe('自動保存済み');
      });
    });

    it('does not autosave when preferencesLoaded is false', () => {
      (mockApi.put as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok', version: 2 });

      const changedState: PersistedInventorySearchState = {
        chips: [{ drugMasterId: 4, genericName: 'Drug4', specification: '5mg', displayLabel: 'Drug4 5mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        useCurrentLocation: false,
      };

      const params = makeDefaultParams({ currentSearchState: changedState, preferencesLoaded: false });
      renderHook(() => useInventorySearchPreferencesPersistence(params));

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(mockApi.put).not.toHaveBeenCalled();
    });

    it('does not autosave when userId is undefined', () => {
      (mockApi.put as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok', version: 2 });

      const changedState: PersistedInventorySearchState = {
        chips: [{ drugMasterId: 5, genericName: 'Drug5', specification: '5mg', displayLabel: 'Drug5 5mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        useCurrentLocation: false,
      };

      const params = makeDefaultParams({ currentSearchState: changedState, userId: undefined });
      renderHook(() => useInventorySearchPreferencesPersistence(params));

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(mockApi.put).not.toHaveBeenCalled();
    });

    it('does not autosave when isHydratingState is true', () => {
      (mockApi.put as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok', version: 2 });

      const changedState: PersistedInventorySearchState = {
        chips: [{ drugMasterId: 6, genericName: 'Drug6', specification: '5mg', displayLabel: 'Drug6 5mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        useCurrentLocation: false,
      };

      const params = makeDefaultParams({ currentSearchState: changedState, isHydratingState: true });
      renderHook(() => useInventorySearchPreferencesPersistence(params));

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(mockApi.put).not.toHaveBeenCalled();
    });
  });

  describe('conflict detection (409 response)', () => {
    it('sets preferencesConflict when api.put returns 409', async () => {
      const conflictPreferences = makePreferences({ version: 10 });
      const apiError = new ApiError(409, 'Conflict', { latestData: conflictPreferences });
      (mockApi.put as ReturnType<typeof vi.fn>).mockRejectedValue(apiError);

      const changedState: PersistedInventorySearchState = {
        chips: [{ drugMasterId: 10, genericName: 'Drug10', specification: '10mg', displayLabel: 'Drug10 10mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        useCurrentLocation: false,
      };

      const params = makeDefaultParams({ currentSearchState: changedState });
      const { result } = renderHook(() => useInventorySearchPreferencesPersistence(params));

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current.preferencesConflict).not.toBeNull();
      });

      expect(result.current.preferencesSaveError).toBe('別の画面で検索条件が更新されました。最新条件を反映するか、この画面の条件で上書き保存してください。');
      expect(result.current.autosaveStatusLabel).toBe('競合が発生しました');
    });

    it('sets generic error message on non-409 API failure', async () => {
      const apiError = new ApiError(500, 'Internal Server Error');
      (mockApi.put as ReturnType<typeof vi.fn>).mockRejectedValue(apiError);

      const changedState: PersistedInventorySearchState = {
        chips: [{ drugMasterId: 11, genericName: 'Drug11', specification: '10mg', displayLabel: 'Drug11 10mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
        useCurrentLocation: false,
      };

      const params = makeDefaultParams({ currentSearchState: changedState });
      const { result } = renderHook(() => useInventorySearchPreferencesPersistence(params));

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(result.current.preferencesSaveError).toBe('検索条件の保存に失敗しました。再操作で再試行します。');
      });

      expect(result.current.preferencesConflict).toBeNull();
      expect(result.current.autosaveStatusLabel).toBe('自動保存に失敗しました');
    });
  });

  describe('autosave — history', () => {
    it('calls api.put for history endpoint after 300ms when history changes', async () => {
      (mockApi.put as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok', version: 2 });

      const history = [makeHistoryItem('h1')];
      const params = makeDefaultParams({ searchHistory: history });
      renderHook(() => useInventorySearchPreferencesPersistence(params));

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(mockApi.put).toHaveBeenCalledWith(
        '/account/inventory-search-preferences/history',
        expect.objectContaining({ searchHistory: history }),
        expect.anything(),
      );
    });
  });

  describe('autosave — presets', () => {
    it('calls api.put for presets endpoint after 300ms when presets change', async () => {
      (mockApi.put as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok', version: 2 });

      const presets = [makePreset('p1')];
      const params = makeDefaultParams({ savedPresets: presets });
      renderHook(() => useInventorySearchPreferencesPersistence(params));

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(mockApi.put).toHaveBeenCalledWith(
        '/account/inventory-search-preferences/presets',
        expect.objectContaining({ savedPresets: presets }),
        expect.anything(),
      );
    });
  });
});
