import { and, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { inventorySearchPreferences } from '../db/schema';
import type {
  InventorySearchPreferencesResponse,
  InventorySearchPreferencesSavePayload,
} from '../../../shared/inventory-search-preferences.js';
import {
  createDefaultInventorySearchPreferences,
  normalizeInventorySearchPreferences,
} from '../../../shared/inventory-search-preferences.js';

export async function loadInventorySearchPreferences(pharmacyId: number): Promise<InventorySearchPreferencesResponse> {
  const rows = await db.select({
    draftJson: inventorySearchPreferences.draftJson,
    searchHistoryJson: inventorySearchPreferences.searchHistoryJson,
    savedPresetsJson: inventorySearchPreferences.savedPresetsJson,
    version: inventorySearchPreferences.version,
  })
    .from(inventorySearchPreferences)
    .where(eq(inventorySearchPreferences.pharmacyId, pharmacyId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return createDefaultInventorySearchPreferences();
  }

  return normalizeInventorySearchPreferences({
    version: row.version,
    draft: row.draftJson,
    searchHistory: row.searchHistoryJson,
    savedPresets: row.savedPresetsJson,
  });
}

export async function saveInventorySearchPreferences(
  pharmacyId: number,
  preferences: InventorySearchPreferencesSavePayload,
): Promise<{ ok: true; version: number } | { ok: false; latestData: InventorySearchPreferencesResponse }> {
  const now = new Date().toISOString();
  if (preferences.version === 0) {
    const inserted = await db.insert(inventorySearchPreferences)
      .values({
        pharmacyId,
        draftJson: preferences.draft,
        searchHistoryJson: preferences.searchHistory,
        savedPresetsJson: preferences.savedPresets,
        version: 1,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: inventorySearchPreferences.pharmacyId })
      .returning({ version: inventorySearchPreferences.version });

    if (inserted[0]) {
      return { ok: true, version: inserted[0].version };
    }
  } else {
    const updated = await db.update(inventorySearchPreferences)
      .set({
        draftJson: preferences.draft,
        searchHistoryJson: preferences.searchHistory,
        savedPresetsJson: preferences.savedPresets,
        version: preferences.version + 1,
        updatedAt: now,
      })
      .where(and(
        eq(inventorySearchPreferences.pharmacyId, pharmacyId),
        eq(inventorySearchPreferences.version, preferences.version),
      ))
      .returning({ version: inventorySearchPreferences.version });

    if (updated[0]) {
      return { ok: true, version: updated[0].version };
    }
  }

  const latestData = await loadInventorySearchPreferences(pharmacyId);
  return { ok: false, latestData };
}

export async function saveUpdatedInventorySearchPreferences<TPayload extends { version: number }>(
  pharmacyId: number,
  payload: TPayload,
  recipe: (current: InventorySearchPreferencesResponse) => InventorySearchPreferencesSavePayload,
): Promise<{ ok: true; version: number } | { ok: false; latestData: InventorySearchPreferencesResponse }> {
  const current = await loadInventorySearchPreferences(pharmacyId);
  if (current.version !== payload.version) {
    return { ok: false, latestData: current };
  }
  return saveInventorySearchPreferences(pharmacyId, recipe(current));
}
