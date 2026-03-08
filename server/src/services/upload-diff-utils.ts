import { sql, type SQL } from 'drizzle-orm';

/**
 * Convert a number to a nullable decimal string.
 * Used for yakka prices that need to be stored as strings in SQL.
 */
export function toNullableDecimalString(value: number | null): string | null {
  return value !== null ? String(value) : null;
}

/**
 * Build a SQL VALUES clause from items using a row builder function.
 * Used for batch updates with CTE (Common Table Expression).
 */
export function buildValuesSql<T>(items: T[], buildRow: (item: T) => SQL): SQL {
  return sql.join(items.map((item) => buildRow(item)), sql`, `);
}

/**
 * Compute optimal batch size based on total row count.
 * Larger datasets benefit from bigger batches to reduce round-trip overhead.
 */
export function computeOptimalBatchSize(totalCount: number): number {
  if (totalCount <= 1_000) return 500;
  if (totalCount <= 10_000) return 1_000;
  if (totalCount <= 100_000) return 2_000;
  return 5_000;
}

/**
 * Process items in batches with an async processor function.
 * Used for insert/update operations to avoid overwhelming the database.
 */
export async function processInBatches<T>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<void>,
): Promise<void> {
  for (let start = 0; start < items.length; start += batchSize) {
    await processor(items.slice(start, start + batchSize));
  }
}

function isMissingExistingRow<TExisting extends { id: number }>(
  row: TExisting,
  seenExistingIds: Set<number>,
  shouldInclude: (row: TExisting) => boolean,
): boolean {
  return shouldInclude(row) && !seenExistingIds.has(row.id);
}

/**
 * Collect IDs of rows that are missing from the incoming data.
 * Used to identify rows that should be deleted or deactivated.
 */
export function collectMissingIds<TExisting extends { id: number }>(
  existing: TExisting[],
  seenExistingIds: Set<number>,
  shouldInclude: (row: TExisting) => boolean = () => true,
): number[] {
  return existing
    .filter((row) => isMissingExistingRow(row, seenExistingIds, shouldInclude))
    .map((row) => row.id);
}

/**
 * Count rows that are missing from the incoming data.
 * Used to get a count without allocating an array.
 */
export function countMissingRows<TExisting extends { id: number }>(
  existing: TExisting[],
  seenExistingIds: Set<number>,
  shouldInclude: (row: TExisting) => boolean = () => true,
): number {
  let count = 0;
  for (const row of existing) {
    if (isMissingExistingRow(row, seenExistingIds, shouldInclude)) {
      count += 1;
    }
  }
  return count;
}
