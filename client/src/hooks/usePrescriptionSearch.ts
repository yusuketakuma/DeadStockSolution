import { useState, useCallback } from 'react';
import { api, type DrugChip, type PrescriptionSearchFilters, type PrescriptionSearchResponse } from '../api/client';

interface UsePrescriptionSearchReturn {
  chips: DrugChip[];
  addChip: (chip: DrugChip) => void;
  removeChip: (index: number) => void;
  clearChips: () => void;
  filters: PrescriptionSearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<PrescriptionSearchFilters>>;
  result: PrescriptionSearchResponse | null;
  isSearching: boolean;
  search: () => Promise<void>;
  error: string | null;
}

export function usePrescriptionSearch(): UsePrescriptionSearchReturn {
  const [chips, setChips] = useState<DrugChip[]>([]);
  const [filters, setFilters] = useState<PrescriptionSearchFilters>({
    groupOnly: false, openOnly: false, favoritePriority: false,
  });
  const [result, setResult] = useState<PrescriptionSearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setIsSearching(true);
    setError(null);
    try {
      const searchResult = await api.prescriptionSearch({
        drugKeys: chips.map(c => ({
          drugMasterId: c.drugMasterId,
          genericName: c.genericName,
          specification: c.specification,
        })),
        filters,
        coordinates: null,
      });
      setResult(searchResult);
    } catch {
      setError('検索中にエラーが発生しました');
    } finally {
      setIsSearching(false);
    }
  }, [chips, filters]);

  return { chips, addChip, removeChip, clearChips, filters, setFilters, result, isSearching, search, error };
}
