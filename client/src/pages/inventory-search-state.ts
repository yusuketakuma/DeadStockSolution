import type { SetURLSearchParams } from 'react-router-dom';
import { ApiError, api, type DrugChip, type InventorySearchFilters } from '../api/client';
import type {
  InventorySearchPreferencesResponse,
  InventorySearchStatePayload,
} from '../../../shared/inventory-search-preferences';
import { createDefaultInventorySearchState, normalizeInventorySearchPreferences } from '../../../shared/inventory-search-preferences.js';
import type { DrugMasterSuggestion } from '../components/SearchInput';

export interface SearchCoordinates {
  latitude: number;
  longitude: number;
}

export interface InventorySearchRouteState {
  drugMasterIds: number[];
  filters: InventorySearchFilters;
  useCurrentLocation: boolean;
}

export type PersistedInventorySearchState = InventorySearchStatePayload;

export interface HydratedRouteStateResult {
  state: PersistedInventorySearchState;
  missingDrugMasterIds: number[];
}

export interface PreferencesSaveResponse {
  message: string;
  version: number;
}

export interface UseRouteSyncParams {
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}

export function defaultSearchState(): PersistedInventorySearchState {
  return createDefaultInventorySearchState();
}

export function buildPersistedSearchKey(state: PersistedInventorySearchState): string {
  return JSON.stringify({
    chipIds: state.chips.map((chip) => chip.drugMasterId),
    filters: state.filters,
    useCurrentLocation: state.useCurrentLocation,
  });
}

export function parseSearchParamsState(searchParams: URLSearchParams): InventorySearchRouteState | null {
  const drugMasterIds = searchParams
    .getAll('drugId')
    .map((value) => Number(value))
    .filter((value, index, values) => Number.isInteger(value) && value > 0 && values.indexOf(value) === index)
    .slice(0, 10);

  const filters: InventorySearchFilters = {
    groupOnly: searchParams.get('groupOnly') === '1',
    openOnly: searchParams.get('openOnly') === '1',
    favoritePriority: searchParams.get('favoritePriority') === '1',
  };
  const useCurrentLocation = searchParams.get('useCurrentLocation') === '1';

  if (drugMasterIds.length === 0 && !filters.groupOnly && !filters.openOnly && !filters.favoritePriority && !useCurrentLocation) {
    return null;
  }

  return {
    drugMasterIds,
    filters,
    useCurrentLocation,
  };
}

export function buildSearchParams(state: PersistedInventorySearchState): URLSearchParams {
  const params = new URLSearchParams();
  for (const chip of state.chips) {
    params.append('drugId', String(chip.drugMasterId));
  }
  if (state.filters.groupOnly) params.set('groupOnly', '1');
  if (state.filters.openOnly) params.set('openOnly', '1');
  if (state.filters.favoritePriority) params.set('favoritePriority', '1');
  if (state.useCurrentLocation) params.set('useCurrentLocation', '1');
  return params;
}

export function buildSearchLabel(chips: DrugChip[]): string {
  return chips.map((chip) => chip.displayLabel).join(' / ');
}

export async function fetchDrugChipsByIds(
  drugMasterIds: number[],
  signal?: AbortSignal,
): Promise<{ chips: DrugChip[]; missingDrugMasterIds: number[] }> {
  if (drugMasterIds.length === 0) {
    return { chips: [], missingDrugMasterIds: [] };
  }

  const response = await api.get<DrugMasterSuggestion[]>(
    `/search/drug-master/by-ids?ids=${drugMasterIds.join(',')}`,
    { signal },
  );

  const byId = new Map(response.map((item) => [item.id, item]));
  const chips = drugMasterIds
    .map((id) => byId.get(id))
    .filter((item): item is DrugMasterSuggestion => item !== undefined)
    .map((item) => ({
      drugMasterId: item.id,
      genericName: item.genericName,
      specification: item.specification,
      displayLabel: item.genericName
        ? `${item.genericName} ${item.specification ?? ''}`.trim()
        : item.drugName,
    }));
  const missingDrugMasterIds = drugMasterIds.filter((id) => !byId.has(id));
  return { chips, missingDrugMasterIds };
}

export async function hydrateRouteState(
  state: InventorySearchRouteState,
  signal?: AbortSignal,
): Promise<HydratedRouteStateResult> {
  const { chips, missingDrugMasterIds } = await fetchDrugChipsByIds(state.drugMasterIds, signal);
  return {
    state: {
      chips,
      filters: state.filters,
      useCurrentLocation: state.useCurrentLocation,
    },
    missingDrugMasterIds,
  };
}

export function buildMissingDrugWarning(missingDrugMasterIds: number[]): string | null {
  if (missingDrugMasterIds.length === 0) return null;
  return `${missingDrugMasterIds.length}件の薬剤が見つからなかったため、URL の検索条件から除外しました。対象 ID: ${missingDrugMasterIds.join(', ')}`;
}

export function extractConflictPreferences(err: unknown): InventorySearchPreferencesResponse | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const latestData = (err.data as { latestData?: unknown } | undefined)?.latestData;
  return latestData ? normalizeInventorySearchPreferences(latestData) : null;
}

export function requestCurrentCoordinates(): Promise<SearchCoordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('この端末では位置情報を利用できません'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(new Error('位置情報の利用が許可されていません'));
            break;
          case error.POSITION_UNAVAILABLE:
            reject(new Error('現在地を取得できませんでした'));
            break;
          case error.TIMEOUT:
            reject(new Error('現在地の取得がタイムアウトしました'));
            break;
          default:
            reject(new Error('現在地の取得に失敗しました'));
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 300000,
      },
    );
  });
}
