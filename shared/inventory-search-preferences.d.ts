import type { z } from 'zod';

export interface InventorySearchDrugChip {
  drugMasterId: number;
  genericName: string | null;
  specification: string | null;
  displayLabel: string;
}

export interface InventorySearchFiltersPayload {
  groupOnly: boolean;
  openOnly: boolean;
  favoritePriority: boolean;
}

export interface InventorySearchStatePayload {
  chips: InventorySearchDrugChip[];
  filters: InventorySearchFiltersPayload;
  useCurrentLocation: boolean;
}

export interface InventorySearchSavedPreset extends InventorySearchStatePayload {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  useCount: number;
  pinned: boolean;
}

export interface InventorySearchHistoryItem extends InventorySearchStatePayload {
  id: string;
  label: string;
  lastUsedAt: string;
  useCount: number;
}

export interface InventorySearchPreferencesResponse {
  version: number;
  draft: InventorySearchStatePayload;
  searchHistory: InventorySearchHistoryItem[];
  savedPresets: InventorySearchSavedPreset[];
}

export type InventorySearchPreferencesSavePayload = InventorySearchPreferencesResponse;

export interface InventorySearchDraftUpdatePayload {
  version: number;
  draft: InventorySearchStatePayload;
}

export interface InventorySearchHistoryUpdatePayload {
  version: number;
  searchHistory: InventorySearchHistoryItem[];
}

export interface InventorySearchPresetsUpdatePayload {
  version: number;
  savedPresets: InventorySearchSavedPreset[];
}

export const MAX_HISTORY_ITEMS: number;
export const MAX_PRESET_ITEMS: number;
export const inventorySearchFiltersSchema: z.ZodType<InventorySearchFiltersPayload>;
export const inventorySearchChipSchema: z.ZodType<InventorySearchDrugChip>;
export const inventorySearchStateSchema: z.ZodType<InventorySearchStatePayload>;
export const inventorySearchHistorySchema: z.ZodType<InventorySearchHistoryItem>;
export const inventorySearchPresetSchema: z.ZodType<InventorySearchSavedPreset>;
export const inventorySearchPreferencesSchema: z.ZodType<InventorySearchPreferencesResponse>;
export const inventorySearchDraftUpdateSchema: z.ZodType<InventorySearchDraftUpdatePayload>;
export const inventorySearchHistoryUpdateSchema: z.ZodType<InventorySearchHistoryUpdatePayload>;
export const inventorySearchPresetsUpdateSchema: z.ZodType<InventorySearchPresetsUpdatePayload>;
export function createDefaultInventorySearchState(): InventorySearchStatePayload;
export function createDefaultInventorySearchPreferences(): InventorySearchPreferencesResponse;
export function sortInventorySearchHistory(items: InventorySearchHistoryItem[]): InventorySearchHistoryItem[];
export function sortInventorySearchPresets(items: InventorySearchSavedPreset[]): InventorySearchSavedPreset[];
export function normalizeInventorySearchPreferences(value: unknown): InventorySearchPreferencesResponse;
