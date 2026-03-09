import { MatchItem } from '../types';
import { roundTo2 } from './matching-score-service';

export const MIN_EXCHANGE_VALUE = 10000;
export const VALUE_TOLERANCE = 10;
export const MAX_CANDIDATES = 30;

export interface BalancedValueResult {
  balancedA: MatchItem[];
  balancedB: MatchItem[];
  totalA: number;
  totalB: number;
}

function filterPositiveQuantityItems(items: MatchItem[]): MatchItem[] {
  return items.filter((item) => item.quantity > 0);
}

function adjustItemsTowardTarget(items: MatchItem[], remaining: number): MatchItem[] {
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
    balancedA = adjustItemsTowardTarget(itemsA, totalA - totalB);
    totalA = balancedA.reduce((sum, item) => sum + item.yakkaValue, 0);
  } else if (totalB > totalA + VALUE_TOLERANCE) {
    balancedB = adjustItemsTowardTarget(itemsB, totalB - totalA);
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
