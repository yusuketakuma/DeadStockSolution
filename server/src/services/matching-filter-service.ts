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
    const adjustableA = [...itemsA].sort((a, b) => (b.yakkaUnitPrice || 0) - (a.yakkaUnitPrice || 0));
    let remaining = totalA - totalB;
    for (const item of adjustableA) {
      if (remaining <= VALUE_TOLERANCE) break;

      const maxReduction = item.yakkaValue;
      const minReductionUnit = item.yakkaUnitPrice * 0.1;
      const reduction = Math.min(remaining, Math.max(0, maxReduction - minReductionUnit));
      if (reduction <= 0) continue;

      const unitsToRemove = Math.floor((reduction / item.yakkaUnitPrice) * 10) / 10;
      const newQty = Math.max(0.1, item.quantity - unitsToRemove);
      const actualReduction = (item.quantity - newQty) * item.yakkaUnitPrice;
      item.quantity = newQty;
      item.yakkaValue = roundTo2(newQty * item.yakkaUnitPrice);
      remaining -= actualReduction;
    }
    totalA = adjustableA.reduce((sum, i) => sum + i.yakkaValue, 0);
    balancedA = adjustableA;
  } else if (totalB > totalA + VALUE_TOLERANCE) {
    const adjustableB = [...itemsB].sort((a, b) => (b.yakkaUnitPrice || 0) - (a.yakkaUnitPrice || 0));
    let remaining = totalB - totalA;
    for (const item of adjustableB) {
      if (remaining <= VALUE_TOLERANCE) break;

      const maxReduction = item.yakkaValue;
      const minReductionUnit = item.yakkaUnitPrice * 0.1;
      const reduction = Math.min(remaining, Math.max(0, maxReduction - minReductionUnit));
      if (reduction <= 0) continue;

      const unitsToRemove = Math.floor((reduction / item.yakkaUnitPrice) * 10) / 10;
      const newQty = Math.max(0.1, item.quantity - unitsToRemove);
      const actualReduction = (item.quantity - newQty) * item.yakkaUnitPrice;
      item.quantity = newQty;
      item.yakkaValue = roundTo2(newQty * item.yakkaUnitPrice);
      remaining -= actualReduction;
    }
    totalB = adjustableB.reduce((sum, i) => sum + i.yakkaValue, 0);
    balancedB = adjustableB;
  }

  return {
    balancedA: balancedA.filter((item) => item.quantity > 0),
    balancedB: balancedB.filter((item) => item.quantity > 0),
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
