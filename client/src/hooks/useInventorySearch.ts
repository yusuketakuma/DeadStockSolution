import { useState, useCallback, useRef, useEffect } from 'react';
import { api, type DrugChip, type InventorySearchFilters, type InventorySearchResponse } from '../api/client';
import {
  requestCurrentCoordinates,
  type PersistedInventorySearchState,
} from '../pages/inventory-search-state';

interface UseInventorySearchReturn {
  chips: DrugChip[];
  addChip: (chip: DrugChip) => void;
  removeChip: (index: number) => void;
  clearChips: () => void;
  applyPersistedSearchState: (state: PersistedInventorySearchState) => void;
  useCurrentLocation: boolean;
  setUseCurrentLocation: React.Dispatch<React.SetStateAction<boolean>>;
  filters: InventorySearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<InventorySearchFilters>>;
  result: InventorySearchResponse | null;
  resetResultView: () => void;
  isSearching: boolean;
  search: () => Promise<void>;
  error: string | null;
}

export function useInventorySearch(): UseInventorySearchReturn {
  const [chips, setChips] = useState<DrugChip[]>([]);
  const [filters, setFilters] = useState<InventorySearchFilters>({
    groupOnly: false, openOnly: false, favoritePriority: false,
  });
  const [useCurrentLocation, setUseCurrentLocation] = useState(false);
  const [result, setResult] = useState<InventorySearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // アンマウント時に進行中のリクエストをキャンセル
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const addChip = useCallback((chip: DrugChip) => {
    setChips(prev => {
      if (prev.length >= 10) return prev;
      if (prev.some(c => c.drugMasterId === chip.drugMasterId)) return prev;
      return [...prev, chip];
    });
  }, []);

  const removeChip = useCallback((index: number) => {
    setChips(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearChips = useCallback(() => { setChips([]); setResult(null); }, []);
  const resetResultView = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);
  const applyPersistedSearchState = useCallback((state: PersistedInventorySearchState) => {
    setChips(state.chips);
    setFilters(state.filters);
    setUseCurrentLocation(state.useCurrentLocation);
    setResult(null);
    setError(null);
  }, []);

  const search = useCallback(async () => {
    if (chips.length === 0) return;

    // 前回のリクエストをキャンセル
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsSearching(true);
    setError(null);
    try {
      const coordinates = useCurrentLocation
        ? await requestCurrentCoordinates()
        : null;
      if (controller.signal.aborted) return;

      const searchResult = await api.inventorySearch(
        {
          drugKeys: chips.map(c => ({
            drugMasterId: c.drugMasterId,
            genericName: c.genericName,
            specification: c.specification,
          })),
          filters,
          coordinates,
        },
        { signal: controller.signal },
      );
      // abort された場合は結果を反映しない
      if (!controller.signal.aborted) {
        setResult(searchResult);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : '検索中にエラーが発生しました');
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, [chips, filters, useCurrentLocation]);

  return {
    chips,
    addChip,
    removeChip,
    clearChips,
    applyPersistedSearchState,
    useCurrentLocation,
    setUseCurrentLocation,
    filters,
    setFilters,
    result,
    resetResultView,
    isSearching,
    search,
    error,
  };
}
