import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SetURLSearchParams } from 'react-router-dom';
import type { InventorySearchRouteState, PersistedInventorySearchState } from '../pages/inventory-search-state';
import {
  buildMissingDrugWarning,
  buildPersistedSearchKey,
  buildSearchParams,
  defaultSearchState,
  hydrateRouteState,
  parseSearchParamsState,
} from '../pages/inventory-search-state';

const EMPTY_ROUTE_KEY = buildPersistedSearchKey(defaultSearchState());

interface UseInventorySearchRouteSyncParams {
  currentSearchState: PersistedInventorySearchState;
  preferencesLoaded: boolean;
  isHydratingState: boolean;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  applyPersistedSearchState: (state: PersistedInventorySearchState) => void;
  onResetResultView: () => void;
}

interface UseInventorySearchRouteSyncResult {
  routeWarningMessage: string | null;
  setRouteWarningMessage: React.Dispatch<React.SetStateAction<string | null>>;
  replaceRouteState: (state: PersistedInventorySearchState) => void;
}

export function useInventorySearchRouteSync({
  currentSearchState,
  preferencesLoaded,
  isHydratingState,
  searchParams,
  setSearchParams,
  applyPersistedSearchState,
  onResetResultView,
}: UseInventorySearchRouteSyncParams): UseInventorySearchRouteSyncResult {
  const [routeWarningMessage, setRouteWarningMessage] = useState<string | null>(null);
  const skipNextRouteSyncRef = useRef(false);
  const latestSearchParamsRef = useRef(searchParams);
  const currentRouteKeyRef = useRef('empty');
  const currentRouteKey = useMemo(
    () => buildPersistedSearchKey(currentSearchState),
    [currentSearchState],
  );

  const replaceRouteState = useCallback((state: PersistedInventorySearchState) => {
    const nextParams = buildSearchParams(state);
    if (nextParams.toString() === latestSearchParamsRef.current.toString()) {
      return;
    }
    skipNextRouteSyncRef.current = true;
    setSearchParams(nextParams, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    latestSearchParamsRef.current = searchParams;
  }, [searchParams]);

  useEffect(() => {
    currentRouteKeyRef.current = currentRouteKey;
  }, [currentRouteKey]);

  useEffect(() => {
    if (!preferencesLoaded || isHydratingState) return;

    const nextParams = buildSearchParams(currentSearchState);
    if (nextParams.toString() !== searchParams.toString()) {
      skipNextRouteSyncRef.current = true;
      setSearchParams(nextParams, { replace: true });
    }
  }, [currentSearchState, isHydratingState, preferencesLoaded, searchParams, setSearchParams]);

  useEffect(() => {
    if (!preferencesLoaded || isHydratingState) return;
    if (skipNextRouteSyncRef.current) {
      skipNextRouteSyncRef.current = false;
      return;
    }

    const routeState: InventorySearchRouteState | null = parseSearchParamsState(searchParams);

    if (routeState === null) {
      if (currentRouteKeyRef.current === EMPTY_ROUTE_KEY) {
        return;
      }
      applyPersistedSearchState(defaultSearchState());
      onResetResultView();
      setRouteWarningMessage(null);
      return;
    }

    const expectedKey = JSON.stringify({
      chipIds: routeState.drugMasterIds,
      filters: routeState.filters,
      useCurrentLocation: routeState.useCurrentLocation,
    });

    if (expectedKey === currentRouteKeyRef.current) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    void hydrateRouteState(routeState, controller.signal)
      .then((hydratedState) => {
        if (!active || controller.signal.aborted) return;
        applyPersistedSearchState(hydratedState.state);
        setRouteWarningMessage(buildMissingDrugWarning(hydratedState.missingDrugMasterIds));
        onResetResultView();
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setRouteWarningMessage('URL の検索条件の読み込みに失敗しました。現在の条件を表示しています。');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [applyPersistedSearchState, isHydratingState, onResetResultView, preferencesLoaded, searchParams]);

  return {
    routeWarningMessage,
    setRouteWarningMessage,
    replaceRouteState,
  };
}
