import { buildExistingByKey } from '../utils/upload-diff-utils';

interface WithId {
  id: number;
}

export interface DiffPlan<TIncoming, TExisting extends WithId> {
  insertedItems: TIncoming[];
  updatedPairs: Array<{ current: TExisting; item: TIncoming }>;
  unchanged: number;
  seenExistingIds: Set<number>;
}

/**
 * Analyze incoming items against existing rows to determine what needs to be inserted, updated, or left unchanged.
 * This is the core diff algorithm used for both dead stock and used medication items.
 */
export function analyzeIncomingDiff<TIncoming, TExisting extends WithId>(
  existing: TExisting[],
  incoming: TIncoming[],
  buildKeyForExisting: (row: TExisting) => string,
  buildKeyForIncoming: (item: TIncoming) => string,
  hasRowChanged: (current: TExisting, item: TIncoming) => boolean,
): DiffPlan<TIncoming, TExisting> {
  const existingByKey = buildExistingByKey(existing, buildKeyForExisting);
  const insertedItems: TIncoming[] = [];
  const updatedPairs: Array<{ current: TExisting; item: TIncoming }> = [];
  const seenExistingIds = new Set<number>();
  let unchanged = 0;

  for (const item of incoming) {
    const current = existingByKey.get(buildKeyForIncoming(item));
    if (!current) {
      insertedItems.push(item);
      continue;
    }

    seenExistingIds.add(current.id);
    if (hasRowChanged(current, item)) {
      updatedPairs.push({ current, item });
      continue;
    }

    unchanged += 1;
  }

  return { insertedItems, updatedPairs, unchanged, seenExistingIds };
}
