import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { api } from '../api/client';
import { useInventorySearch } from '../hooks/useInventorySearch';
import { useInventorySearchPreferencesPersistence } from '../hooks/useInventorySearchPreferencesPersistence';
import { useInventorySearchRouteSync } from '../hooks/useInventorySearchRouteSync';
import InventorySearchForm from '../components/inventory/InventorySearchForm';
import { useGroupMembership } from '../hooks/useGroupMembership';
import PharmacySummaryCards from '../components/inventory/PharmacySummaryCards';
import InventoryMatrix from '../components/inventory/InventoryMatrix';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import AppDropdownMenu from '../components/ui/AppDropdownMenu';
import { useAuth } from '../contexts/AuthContext';
import type {
  InventorySearchHistoryItem,
  InventorySearchPreferencesResponse,
  InventorySearchSavedPreset,
} from '../../../shared/inventory-search-preferences';
import {
  buildMissingDrugWarning,
  defaultSearchState,
  hydrateRouteState,
  parseSearchParamsState,
} from './inventory-search-state';

export default function InventorySearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearchParamsRef = useRef(searchParams.toString());
  const { user } = useAuth();
  const {
    chips, addChip, removeChip,
    useCurrentLocation,
    filters, setFilters,
    result, isSearching, search, error,
    applyPersistedSearchState, resetResultView,
  } = useInventorySearch();
  const { isGroupMember } = useGroupMembership();
  const [searchHistory, setSearchHistory] = useState<InventorySearchHistoryItem[]>([]);
  const [savedPresets, setSavedPresets] = useState<InventorySearchSavedPreset[]>([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [isHydratingState, setIsHydratingState] = useState(true);

  const currentSearchState = useMemo(() => ({
    chips,
    filters,
    useCurrentLocation,
  }), [chips, filters, useCurrentLocation]);

  const applyLoadedPreferences = useCallback((preferences: InventorySearchPreferencesResponse) => {
    applyPersistedSearchState(preferences.draft);
    setSearchHistory(preferences.searchHistory);
    setSavedPresets(preferences.savedPresets);
  }, [applyPersistedSearchState]);

  const {
    preferencesSaveError,
    preferencesConflict,
    autosaveStatusLabel,
    seedLoadedPreferences,
    resetPersistenceState,
    acceptLatestConflictVersion,
    keepLocalChangesAfterConflict,
  } = useInventorySearchPreferencesPersistence({
    userId: user?.id,
    currentSearchState,
    searchHistory,
    savedPresets,
    preferencesLoaded,
    isHydratingState,
    applyLatestPreferences: applyLoadedPreferences,
  });

  const {
    setRouteWarningMessage,
    routeWarningMessage,
  } = useInventorySearchRouteSync({
    currentSearchState,
    preferencesLoaded,
    isHydratingState,
    searchParams,
    setSearchParams,
    applyPersistedSearchState,
    onResetResultView: resetResultView,
  });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    setPreferencesLoaded(false);
    setIsHydratingState(true);
    setSearchHistory([]);
    setSavedPresets([]);

    const routeState = parseSearchParamsState(new URLSearchParams(initialSearchParamsRef.current));

    if (!user?.id) {
      applyPersistedSearchState(defaultSearchState());
      setRouteWarningMessage(null);
      resetPersistenceState();
      if (routeState) {
        void hydrateRouteState(routeState, controller.signal)
          .then((hydratedState) => {
            if (!active || controller.signal.aborted) return;
            applyPersistedSearchState(hydratedState.state);
            setRouteWarningMessage(buildMissingDrugWarning(hydratedState.missingDrugMasterIds));
          })
          .catch(() => {
            if (!active || controller.signal.aborted) return;
            setRouteWarningMessage('URL の検索条件の読み込みに失敗しました。現在の条件を表示しています。');
          })
          .finally(() => {
            if (!active || controller.signal.aborted) return;
            setPreferencesLoaded(true);
            setIsHydratingState(false);
          });
        return () => {
          active = false;
          controller.abort();
        };
      }
      setPreferencesLoaded(true);
      setIsHydratingState(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    void api.get<InventorySearchPreferencesResponse>('/account/inventory-search-preferences', {
      signal: controller.signal,
    })
      .then((preferences) => {
        if (!active || controller.signal.aborted) return;
        applyLoadedPreferences(preferences);
        seedLoadedPreferences(preferences);
        setRouteWarningMessage(null);
        if (!routeState) {
          return;
        }
        return hydrateRouteState(routeState, controller.signal)
          .then((hydratedState) => {
            if (!active || controller.signal.aborted) return;
            applyPersistedSearchState(hydratedState.state);
            setRouteWarningMessage(buildMissingDrugWarning(hydratedState.missingDrugMasterIds));
            // Re-seed snapshot so the URL-derived state is treated as the
            // "last saved" baseline — prevents autosave from overwriting
            // the user's real draft with a shared-URL state.
            seedLoadedPreferences({
              ...preferences,
              draft: hydratedState.state,
            });
          })
          .catch(() => {
            if (!active || controller.signal.aborted) return;
            setRouteWarningMessage('URL の検索条件の読み込みに失敗しました。現在の条件を表示しています。');
          });
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        applyPersistedSearchState(defaultSearchState());
        setRouteWarningMessage(null);
        resetPersistenceState();
        if (!routeState) {
          return;
        }
        return hydrateRouteState(routeState, controller.signal)
          .then((hydratedState) => {
            if (!active || controller.signal.aborted) return;
            applyPersistedSearchState(hydratedState.state);
            setRouteWarningMessage(buildMissingDrugWarning(hydratedState.missingDrugMasterIds));
            seedLoadedPreferences({
              version: 0,
              draft: hydratedState.state,
              searchHistory: [],
              savedPresets: [],
            });
          })
          .catch(() => {
            if (!active || controller.signal.aborted) return;
            setRouteWarningMessage('URL の検索条件の読み込みに失敗しました。現在の条件を表示しています。');
          });
      })
      .finally(() => {
        if (!active || controller.signal.aborted) return;
        setPreferencesLoaded(true);
        setIsHydratingState(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    applyLoadedPreferences,
    applyPersistedSearchState,
    resetPersistenceState,
    seedLoadedPreferences,
    setRouteWarningMessage,
    user?.id,
  ]);

  const handleOpenMatchingCandidate = (pharmacyId: number) => {
    const params = new URLSearchParams({
      targetPharmacyId: String(pharmacyId),
    });
    const selectedDrugs = chips.map((chip) => chip.displayLabel).filter(Boolean).join(' / ');
    if (selectedDrugs) {
      params.set('inventorySearchDrugs', selectedDrugs);
    }
    navigate(`/matching?${params.toString()}`);
  };
  const matchingHref = useMemo(() => {
    const params = new URLSearchParams();
    const selectedDrugs = chips.map((chip) => chip.displayLabel).filter(Boolean).join(' / ');
    if (selectedDrugs) {
      params.set('inventorySearchDrugs', selectedDrugs);
    }
    return params.size > 0 ? `/matching?${params.toString()}` : '/matching';
  }, [chips]);

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">医薬品在庫検索</h4>
          <div className="text-muted small">検索条件を保ったままマッチングや在庫参照へ移動できます。</div>
        </div>
        <div className="dl-page-header-actions mobile-stack">
          <Link to={matchingHref} className="btn btn-primary btn-sm">この条件で候補を確認</Link>
          <AppDropdownMenu
            label="関連画面"
            variant="outline-secondary"
            items={[
              { key: 'dead-stock', to: '/inventory/dead-stock', label: 'デッドストックを確認' },
              { key: 'used', to: '/inventory/used-medication', label: '使用量を確認' },
              { key: 'browse', to: '/inventory/browse', label: '在庫を確認' },
            ]}
          />
        </div>
      </div>
      <ScrollArea>
        <InventorySearchForm
          chips={chips}
          onAddChip={addChip}
          onRemoveChip={removeChip}
          filters={filters}
          onFiltersChange={setFilters}
          onSearch={search}
          isSearching={isSearching}
          isGroupMember={isGroupMember}
        />

        {routeWarningMessage && <Alert variant="warning">{routeWarningMessage}</Alert>}
        {preferencesSaveError && (
          <Alert variant={preferencesConflict ? 'warning' : 'danger'}>
            <div>{preferencesSaveError}</div>
            {preferencesConflict && (
              <div className="dl-action-row mobile-stack mt-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={acceptLatestConflictVersion}
                >
                  最新の条件を反映
                </Button>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={keepLocalChangesAfterConflict}
                >
                  この画面の条件で再保存
                </Button>
              </div>
            )}
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        {autosaveStatusLabel && <p className="text-muted small mb-2">{autosaveStatusLabel}</p>}

        {!result && !isSearching && (
          <p className="text-muted text-center mt-4">
            検索したい薬剤を追加して在庫を確認してください
          </p>
        )}

        {isSearching && (
          <div className="text-center mt-4">
            <Spinner animation="border" />
          </div>
        )}

        {result && !isSearching && (
          <>
            <PharmacySummaryCards
              summaries={result.summary}
              onOpenMatching={handleOpenMatchingCandidate}
            />
            <InventoryMatrix
              columns={result.matrix.columns}
              rows={result.matrix.rows}
              totalDrugs={chips.length}
            />
          </>
        )}
      </ScrollArea>
    </PageShell>
  );
}
