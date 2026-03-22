import { z } from 'zod';

export const MAX_HISTORY_ITEMS = 5;
export const MAX_PRESET_ITEMS = 10;

export const inventorySearchFiltersSchema = z.object({
  groupOnly: z.boolean(),
  openOnly: z.boolean(),
  favoritePriority: z.boolean(),
});

export const inventorySearchChipSchema = z.object({
  drugMasterId: z.number().int().positive(),
  genericName: z.string().max(200).nullable(),
  specification: z.string().max(100).nullable(),
  displayLabel: z.string().min(1).max(200),
});

export const inventorySearchStateSchema = z.object({
  chips: z.array(inventorySearchChipSchema).max(10),
  filters: inventorySearchFiltersSchema,
  useCurrentLocation: z.boolean().default(false),
});

export const inventorySearchHistorySchema = inventorySearchStateSchema.extend({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(300),
  lastUsedAt: z.string().datetime(),
  useCount: z.number().int().min(1),
});

export const inventorySearchPresetSchema = inventorySearchStateSchema.extend({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  useCount: z.number().int().min(0),
  pinned: z.boolean().default(false),
});

export const inventorySearchPreferencesSchema = z.object({
  version: z.number().int().min(0),
  draft: inventorySearchStateSchema,
  searchHistory: z.array(inventorySearchHistorySchema).max(MAX_HISTORY_ITEMS),
  savedPresets: z.array(inventorySearchPresetSchema).max(MAX_PRESET_ITEMS),
});

export const inventorySearchDraftUpdateSchema = z.object({
  version: z.number().int().min(0),
  draft: inventorySearchStateSchema,
});

export const inventorySearchHistoryUpdateSchema = z.object({
  version: z.number().int().min(0),
  searchHistory: z.array(inventorySearchHistorySchema).max(MAX_HISTORY_ITEMS),
});

export const inventorySearchPresetsUpdateSchema = z.object({
  version: z.number().int().min(0),
  savedPresets: z.array(inventorySearchPresetSchema).max(MAX_PRESET_ITEMS),
});

export function createDefaultInventorySearchState() {
  return {
    chips: [],
    filters: {
      groupOnly: false,
      openOnly: false,
      favoritePriority: false,
    },
    useCurrentLocation: false,
  };
}

export function createDefaultInventorySearchPreferences() {
  return {
    version: 0,
    draft: createDefaultInventorySearchState(),
    searchHistory: [],
    savedPresets: [],
  };
}

export function sortInventorySearchHistory(items) {
  return [...items].sort((left, right) => {
    const timeDiff = new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime();
    return timeDiff !== 0 ? timeDiff : right.useCount - left.useCount;
  });
}

export function sortInventorySearchPresets(items) {
  return [...items].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    const timeDiff = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    return timeDiff !== 0 ? timeDiff : right.useCount - left.useCount;
  });
}

export function normalizeInventorySearchPreferences(value) {
  const parsed = inventorySearchPreferencesSchema.safeParse(value);
  if (!parsed.success) {
    return createDefaultInventorySearchPreferences();
  }

  return {
    ...parsed.data,
    searchHistory: sortInventorySearchHistory(parsed.data.searchHistory),
    savedPresets: sortInventorySearchPresets(parsed.data.savedPresets),
  };
}
