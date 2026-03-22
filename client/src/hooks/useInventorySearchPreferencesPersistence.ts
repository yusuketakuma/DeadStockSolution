import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type {
  InventorySearchDraftUpdatePayload,
  InventorySearchHistoryItem,
  InventorySearchHistoryUpdatePayload,
  InventorySearchPreferencesResponse,
  InventorySearchPresetsUpdatePayload,
  InventorySearchSavedPreset,
} from '../../../shared/inventory-search-preferences';
import type {
  PersistedInventorySearchState,
  PreferencesSaveResponse,
} from '../pages/inventory-search-state';
import {
  buildPersistedSearchKey,
  defaultSearchState,
  extractConflictPreferences,
} from '../pages/inventory-search-state';

interface UseInventorySearchPreferencesPersistenceParams {
  userId?: number;
  currentSearchState: PersistedInventorySearchState;
  searchHistory: InventorySearchHistoryItem[];
  savedPresets: InventorySearchSavedPreset[];
  preferencesLoaded: boolean;
  isHydratingState: boolean;
  applyLatestPreferences?: (preferences: InventorySearchPreferencesResponse) => void;
}

interface UseInventorySearchPreferencesPersistenceResult {
  preferencesVersion: number;
  preferencesSaveError: string | null;
  preferencesConflict: InventorySearchPreferencesResponse | null;
  autosaveStatusLabel: string | null;
  seedLoadedPreferences: (preferences: InventorySearchPreferencesResponse) => void;
  resetPersistenceState: () => void;
  clearConflict: () => void;
  acceptLatestConflictVersion: () => void;
  keepLocalChangesAfterConflict: () => void;
}

export function useInventorySearchPreferencesPersistence({
  userId,
  currentSearchState,
  searchHistory,
  savedPresets,
  preferencesLoaded,
  isHydratingState,
  applyLatestPreferences,
}: UseInventorySearchPreferencesPersistenceParams): UseInventorySearchPreferencesPersistenceResult {
  const [preferencesVersion, setPreferencesVersion] = useState(0);
  const [preferencesSaveError, setPreferencesSaveError] = useState<string | null>(null);
  const [preferencesConflict, setPreferencesConflict] = useState<InventorySearchPreferencesResponse | null>(null);
  const [autosaveStatusLabel, setAutosaveStatusLabel] = useState<string | null>(null);
  const lastSavedDraftSnapshotRef = useRef(buildPersistedSearchKey(defaultSearchState()));
  const lastSavedHistorySnapshotRef = useRef(JSON.stringify([]));
  const lastSavedPresetsSnapshotRef = useRef(JSON.stringify([]));
  const saveStatusTimerRef = useRef<number | null>(null);

  const currentDraftSnapshot = useMemo(
    () => buildPersistedSearchKey(currentSearchState),
    [currentSearchState],
  );
  const currentHistorySnapshot = useMemo(
    () => JSON.stringify(searchHistory),
    [searchHistory],
  );
  const currentPresetsSnapshot = useMemo(
    () => JSON.stringify(savedPresets),
    [savedPresets],
  );

  const updateAutosaveStatus = useCallback((label: string | null) => {
    if (saveStatusTimerRef.current !== null) {
      window.clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = null;
    }
    setAutosaveStatusLabel(label);
    if (label === '自動保存済み') {
      saveStatusTimerRef.current = window.setTimeout(() => {
        setAutosaveStatusLabel(null);
        saveStatusTimerRef.current = null;
      }, 1500);
    }
  }, []);

  const clearConflict = useCallback(() => {
    setPreferencesConflict(null);
    setPreferencesSaveError(null);
  }, []);

  const seedLoadedPreferences = useCallback((preferences: InventorySearchPreferencesResponse) => {
    setPreferencesVersion(preferences.version);
    lastSavedDraftSnapshotRef.current = buildPersistedSearchKey(preferences.draft);
    lastSavedHistorySnapshotRef.current = JSON.stringify(preferences.searchHistory);
    lastSavedPresetsSnapshotRef.current = JSON.stringify(preferences.savedPresets);
    clearConflict();
    updateAutosaveStatus(null);
  }, [clearConflict, updateAutosaveStatus]);

  const resetPersistenceState = useCallback(() => {
    setPreferencesVersion(0);
    lastSavedDraftSnapshotRef.current = buildPersistedSearchKey(defaultSearchState());
    lastSavedHistorySnapshotRef.current = JSON.stringify([]);
    lastSavedPresetsSnapshotRef.current = JSON.stringify([]);
    clearConflict();
    updateAutosaveStatus(null);
  }, [clearConflict, updateAutosaveStatus]);

  const handleSaveFailure = useCallback((err: unknown, fallbackMessage: string) => {
    const latestPreferences = extractConflictPreferences(err);
    if (latestPreferences) {
      setPreferencesConflict(latestPreferences);
      setPreferencesSaveError('別の画面で検索条件が更新されました。最新条件を反映するか、この画面の条件で上書き保存してください。');
      updateAutosaveStatus('競合が発生しました');
      return;
    }
    setPreferencesSaveError(fallbackMessage);
    updateAutosaveStatus('自動保存に失敗しました');
  }, [updateAutosaveStatus]);

  const acceptLatestConflictVersion = useCallback(() => {
    if (!preferencesConflict) return;
    applyLatestPreferences?.(preferencesConflict);
    lastSavedDraftSnapshotRef.current = buildPersistedSearchKey(preferencesConflict.draft);
    lastSavedHistorySnapshotRef.current = JSON.stringify(preferencesConflict.searchHistory);
    lastSavedPresetsSnapshotRef.current = JSON.stringify(preferencesConflict.savedPresets);
    setPreferencesVersion(preferencesConflict.version);
    clearConflict();
    updateAutosaveStatus('最新の条件を反映しました');
  }, [applyLatestPreferences, clearConflict, preferencesConflict, updateAutosaveStatus]);

  const keepLocalChangesAfterConflict = useCallback(() => {
    if (!preferencesConflict) return;
    setPreferencesVersion(preferencesConflict.version);
    clearConflict();
    updateAutosaveStatus('この画面の条件を再保存します');
  }, [clearConflict, preferencesConflict, updateAutosaveStatus]);

  useEffect(() => {
    return () => {
      if (saveStatusTimerRef.current !== null) {
        window.clearTimeout(saveStatusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!preferencesLoaded || isHydratingState || !userId || preferencesConflict) return;
    if (currentDraftSnapshot === lastSavedDraftSnapshotRef.current) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      updateAutosaveStatus('自動保存中...');
      const payload: InventorySearchDraftUpdatePayload = {
        version: preferencesVersion,
        draft: currentSearchState,
      };
      void api.put<PreferencesSaveResponse>('/account/inventory-search-preferences/draft', payload, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          lastSavedDraftSnapshotRef.current = currentDraftSnapshot;
          setPreferencesVersion(response.version);
          setPreferencesSaveError(null);
          updateAutosaveStatus('自動保存済み');
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          handleSaveFailure(err, '検索条件の保存に失敗しました。再操作で再試行します。');
        });
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    currentDraftSnapshot,
    currentSearchState,
    handleSaveFailure,
    isHydratingState,
    preferencesConflict,
    preferencesLoaded,
    preferencesVersion,
    updateAutosaveStatus,
    userId,
  ]);

  useEffect(() => {
    if (!preferencesLoaded || isHydratingState || !userId || preferencesConflict) return;
    if (currentHistorySnapshot === lastSavedHistorySnapshotRef.current) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      updateAutosaveStatus('自動保存中...');
      const payload: InventorySearchHistoryUpdatePayload = {
        version: preferencesVersion,
        searchHistory,
      };
      void api.put<PreferencesSaveResponse>('/account/inventory-search-preferences/history', payload, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          lastSavedHistorySnapshotRef.current = currentHistorySnapshot;
          setPreferencesVersion(response.version);
          setPreferencesSaveError(null);
          updateAutosaveStatus('自動保存済み');
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          handleSaveFailure(err, '検索履歴の保存に失敗しました。再操作で再試行します。');
        });
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    currentHistorySnapshot,
    handleSaveFailure,
    isHydratingState,
    preferencesConflict,
    preferencesLoaded,
    preferencesVersion,
    searchHistory,
    updateAutosaveStatus,
    userId,
  ]);

  useEffect(() => {
    if (!preferencesLoaded || isHydratingState || !userId || preferencesConflict) return;
    if (currentPresetsSnapshot === lastSavedPresetsSnapshotRef.current) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      updateAutosaveStatus('自動保存中...');
      const payload: InventorySearchPresetsUpdatePayload = {
        version: preferencesVersion,
        savedPresets,
      };
      void api.put<PreferencesSaveResponse>('/account/inventory-search-preferences/presets', payload, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          lastSavedPresetsSnapshotRef.current = currentPresetsSnapshot;
          setPreferencesVersion(response.version);
          setPreferencesSaveError(null);
          updateAutosaveStatus('自動保存済み');
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          handleSaveFailure(err, '保存済み検索の保存に失敗しました。再操作で再試行します。');
        });
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    currentPresetsSnapshot,
    handleSaveFailure,
    isHydratingState,
    preferencesConflict,
    preferencesLoaded,
    preferencesVersion,
    savedPresets,
    updateAutosaveStatus,
    userId,
  ]);

  return {
    preferencesVersion,
    preferencesSaveError,
    preferencesConflict,
    autosaveStatusLabel,
    seedLoadedPreferences,
    resetPersistenceState,
    clearConflict,
    acceptLatestConflictVersion,
    keepLocalChangesAfterConflict,
  };
}
