import { useState, useCallback, useRef, useEffect } from 'react';
import { api, type DrugChip, type InventorySearchFilters, type InventorySearchResponse } from '../api/client';

interface UseInventorySearchReturn {
  chips: DrugChip[];
  addChip: (chip: DrugChip) => void;
  removeChip: (index: number) => void;
  clearChips: () => void;
  filters: InventorySearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<InventorySearchFilters>>;
  result: InventorySearchResponse | null;
  isSearching: boolean;
  search: () => Promise<void>;
  error: string | null;
}

export function useInventorySearch(): UseInventorySearchReturn {
  const [chips, setChips] = useState<DrugChip[]>([]);
  const [filters, setFilters] = useState<InventorySearchFilters>({
    groupOnly: false, openOnly: false, favoritePriority: false,
  });
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

  const search = useCallback(async () => {
    if (chips.length === 0) return;

    // 前回のリクエストをキャンセル
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsSearching(true);
    setError(null);
    try {
      const searchResult = await api.inventorySearch(
        {
          drugKeys: chips.map(c => ({
            drugMasterId: c.drugMasterId,
            genericName: c.genericName,
            specification: c.specification,
          })),
          filters,
          coordinates: null,
        },
        { signal: controller.signal },
      );
      // abort された場合は結果を反映しない
      if (!controller.signal.aborted) {
        setResult(searchResult);
      }
    } catch {
      if (controller.signal.aborted) return;
      setError('検索中にエラーが発生しました');
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, [chips, filters]);

  return { chips, addChip, removeChip, clearChips, filters, setFilters, result, isSearching, search, error };
}
