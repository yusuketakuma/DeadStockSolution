import { MatchItem } from '../types';
import { roundTo2 } from './matching-score-service';
import type { BalancedValueResult } from '../types/matching';

export const MIN_EXCHANGE_VALUE = 10000;
export const VALUE_TOLERANCE = 10;
export const MAX_CANDIDATES = 30;
const BOX_COUNT_EPSILON = 0.0001;

function filterPositiveQuantityItems(items: MatchItem[]): MatchItem[] {
  return items.filter((item) => item.quantity > 0);
}

function getPackageQuantity(item: MatchItem): number | null {
  const packageQuantity = Number(item.packageQuantity);
  return Number.isFinite(packageQuantity) && packageQuantity > 0 ? packageQuantity : null;
}

function getBoxCount(item: MatchItem): number | null {
  if (Number.isInteger(item.boxCount) && Number(item.boxCount) > 0) {
    return Number(item.boxCount);
  }

  const packageQuantity = getPackageQuantity(item);
  if (!packageQuantity) return null;

  const boxCount = Math.floor((Number(item.quantity) + BOX_COUNT_EPSILON) / packageQuantity);
  return boxCount > 0 ? boxCount : null;
}

function hasBoxSizing(item: MatchItem): boolean {
  return getPackageQuantity(item) !== null && getBoxCount(item) !== null;
}

function updateItemBoxCount(item: MatchItem, nextBoxCount: number, packageQuantity: number): MatchItem {
  const quantity = roundTo2(nextBoxCount * packageQuantity);
  return {
    ...item,
    quantity,
    boxCount: nextBoxCount,
    yakkaValue: roundTo2(quantity * item.yakkaUnitPrice),
  };
}

function adjustBoxItemsTowardTarget(items: MatchItem[], targetTotal: number): MatchItem[] {
  const adjusted = items.map((item) => ({ ...item }));
  let currentTotal = adjusted.reduce((sum, item) => sum + item.yakkaValue, 0);
  let currentDiff = Math.abs(currentTotal - targetTotal);

  while (currentDiff > VALUE_TOLERANCE) {
    let best:
      | { index: number; boxCount: number; total: number; diff: number; packageQuantity: number }
      | null = null;

    for (let index = 0; index < adjusted.length; index += 1) {
      const item = adjusted[index];
      const packageQuantity = getPackageQuantity(item);
      const currentBoxCount = getBoxCount(item);
      if (!packageQuantity || !currentBoxCount) continue;

      for (let nextBoxCount = currentBoxCount - 1; nextBoxCount >= 0; nextBoxCount -= 1) {
        const nextQuantity = roundTo2(nextBoxCount * packageQuantity);
        const nextValue = roundTo2(nextQuantity * item.yakkaUnitPrice);
        const nextTotal = roundTo2(currentTotal - item.yakkaValue + nextValue);
        const nextDiff = Math.abs(nextTotal - targetTotal);
        if (nextDiff >= currentDiff) continue;
        if (!best || nextDiff < best.diff) {
          best = { index, boxCount: nextBoxCount, total: nextTotal, diff: nextDiff, packageQuantity };
        }
      }
    }

    if (!best) break;
    adjusted[best.index] = updateItemBoxCount(adjusted[best.index], best.boxCount, best.packageQuantity);
    currentTotal = best.total;
    currentDiff = best.diff;
  }

  return adjusted;
}

function adjustLegacyItemsTowardTarget(items: MatchItem[], remaining: number): MatchItem[] {
  const adjustable = [...items].sort((a, b) => (b.yakkaUnitPrice || 0) - (a.yakkaUnitPrice || 0));
  let nextRemaining = remaining;

  for (const item of adjustable) {
    if (nextRemaining <= VALUE_TOLERANCE) break;

    const maxReduction = item.yakkaValue;
    const minReductionUnit = item.yakkaUnitPrice * 0.1;
    const reduction = Math.min(nextRemaining, Math.max(0, maxReduction - minReductionUnit));
    if (reduction <= 0) continue;

    const unitsToRemove = Math.floor((reduction / item.yakkaUnitPrice) * 10) / 10;
    const newQty = Math.max(0.1, item.quantity - unitsToRemove);
    const actualReduction = (item.quantity - newQty) * item.yakkaUnitPrice;
    item.quantity = newQty;
    item.yakkaValue = roundTo2(newQty * item.yakkaUnitPrice);
    nextRemaining -= actualReduction;
  }

  return adjustable;
}

function adjustItemsTowardTarget(items: MatchItem[], targetTotal: number): MatchItem[] {
  if (items.some(hasBoxSizing)) {
    return adjustBoxItemsTowardTarget(items, targetTotal);
  }
  const currentTotal = items.reduce((sum, item) => sum + item.yakkaValue, 0);
  return adjustLegacyItemsTowardTarget(items, currentTotal - targetTotal);
}

export function balanceValues(itemsA: MatchItem[], itemsB: MatchItem[]): BalancedValueResult {
  let totalA = itemsA.reduce((sum, i) => sum + i.yakkaValue, 0);
  let totalB = itemsB.reduce((sum, i) => sum + i.yakkaValue, 0);

  if (Math.abs(totalA - totalB) <= VALUE_TOLERANCE) {
    return {
      balancedA: itemsA.filter((item) => item.quantity > 0),
      balancedB: itemsB.filter((item) => item.quantity > 0),
      totalA: roundTo2(totalA),
      totalB: roundTo2(totalB),
    };
  }

  let balancedA = itemsA;
  let balancedB = itemsB;

  if (totalA > totalB + VALUE_TOLERANCE) {
    balancedA = adjustItemsTowardTarget(itemsA, totalB);
    totalA = balancedA.reduce((sum, item) => sum + item.yakkaValue, 0);
  } else if (totalB > totalA + VALUE_TOLERANCE) {
    balancedB = adjustItemsTowardTarget(itemsB, totalA);
    totalB = balancedB.reduce((sum, item) => sum + item.yakkaValue, 0);
  }

  return {
    balancedA: filterPositiveQuantityItems(balancedA),
    balancedB: filterPositiveQuantityItems(balancedB),
    totalA: roundTo2(totalA),
    totalB: roundTo2(totalB),
  };
}

export function groupByPharmacy<T extends { pharmacyId: number }>(rows: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.pharmacyId);
    if (list) {
      list.push(row);
    } else {
      grouped.set(row.pharmacyId, [row]);
    }
  }
  return grouped;
}
