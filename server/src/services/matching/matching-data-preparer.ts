import {
  buildUsedMedIndex,
  PreparedDrugName,
  prepareDrugName,
  roundTo2,
  UsedMedRow,
} from '../matching-score-service';
import { DeadStockRow } from './matching-data-fetcher';

export type UsedMedIndex = ReturnType<typeof buildUsedMedIndex>;
export type PreparedStockRow = { stock: DeadStockRow; preparedDrugName: PreparedDrugName };

export function applyReservationsToStockRows(
  rows: DeadStockRow[],
  reservedByItemId: Map<number, number>,
): DeadStockRow[] {
  const adjusted: DeadStockRow[] = [];
  for (const row of rows) {
    const reservedQty = reservedByItemId.get(row.id) ?? 0;
    const availableQty = roundTo2(Number(row.quantity) - reservedQty);
    if (!Number.isFinite(availableQty) || availableQty <= 0) continue;
    adjusted.push({
      ...row,
      quantity: availableQty,
    });
  }
  return adjusted;
}

export function getFirstOfMonthIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function buildBlockedPairSet(rows: Array<{ pharmacyId: number; targetPharmacyId: number }>): Set<string> {
  const blockedPairs = new Set<string>();
  for (const row of rows) {
    blockedPairs.add(`${row.pharmacyId}:${row.targetPharmacyId}`);
  }
  return blockedPairs;
}

export function isBlockedPair(blockedPairs: Set<string>, pharmacyAId: number, pharmacyBId: number): boolean {
  return blockedPairs.has(`${pharmacyAId}:${pharmacyBId}`) || blockedPairs.has(`${pharmacyBId}:${pharmacyAId}`);
}

export function buildUsedMedIndexByPharmacy(
  rowsByPharmacy: Map<number, UsedMedRow[]>,
): Map<number, UsedMedIndex> {
  const indexByPharmacy = new Map<number, UsedMedIndex>();
  for (const [pharmacyId, rows] of rowsByPharmacy.entries()) {
    if (rows.length === 0) continue;
    indexByPharmacy.set(pharmacyId, buildUsedMedIndex(rows));
  }
  return indexByPharmacy;
}

export function buildPreparedDeadStockByPharmacy(
  rowsByPharmacy: Map<number, DeadStockRow[]>,
): Map<number, PreparedStockRow[]> {
  const preparedByPharmacy = new Map<number, PreparedStockRow[]>();
  const preparedDrugNameCache = new Map<string, PreparedDrugName>();

  for (const [pharmacyId, rows] of rowsByPharmacy.entries()) {
    if (rows.length === 0) continue;

    const preparedRows: PreparedStockRow[] = rows.map((stock) => {
      const cached = preparedDrugNameCache.get(stock.drugName);
      if (cached) {
        return { stock, preparedDrugName: cached };
      }

      const preparedDrugName = prepareDrugName(stock.drugName);
      preparedDrugNameCache.set(stock.drugName, preparedDrugName);
      return { stock, preparedDrugName };
    });

    preparedByPharmacy.set(pharmacyId, preparedRows);
  }

  return preparedByPharmacy;
}

export function buildMatchingIndexes(
  deadStockByPharmacy: Map<number, DeadStockRow[]>,
  usedMedsByPharmacy: Map<number, UsedMedRow[]>,
): {
  preparedDeadStockByPharmacy: Map<number, PreparedStockRow[]>;
  usedMedIndexByPharmacy: Map<number, UsedMedIndex>;
} {
  return {
    preparedDeadStockByPharmacy: buildPreparedDeadStockByPharmacy(deadStockByPharmacy),
    usedMedIndexByPharmacy: buildUsedMedIndexByPharmacy(usedMedsByPharmacy),
  };
}

export function getSourcePreparedData(
  pharmacyId: number,
  preparedDeadStockByPharmacy: Map<number, PreparedStockRow[]>,
  usedMedIndexByPharmacy: Map<number, UsedMedIndex>,
): { myPreparedDeadStock: PreparedStockRow[]; myUsedMedIndex: UsedMedIndex } | null {
  const myPreparedDeadStock = preparedDeadStockByPharmacy.get(pharmacyId) ?? [];
  const myUsedMedIndex = usedMedIndexByPharmacy.get(pharmacyId);
  if (myPreparedDeadStock.length === 0 || !myUsedMedIndex) {
    return null;
  }
  return { myPreparedDeadStock, myUsedMedIndex };
}
