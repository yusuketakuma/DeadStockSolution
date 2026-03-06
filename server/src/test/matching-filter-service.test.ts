import { describe, it, expect } from 'vitest';
import {
  balanceValues,
  groupByPharmacy,
  MIN_EXCHANGE_VALUE,
  VALUE_TOLERANCE,
  MAX_CANDIDATES,
} from '../services/matching-filter-service';
import type { MatchItem } from '../types';

function makeItem(overrides: Partial<MatchItem> & { yakkaUnitPrice: number; quantity: number }): MatchItem {
  return {
    deadStockItemId: 1,
    drugName: 'テスト薬品',
    unit: '錠',
    yakkaValue: overrides.quantity * overrides.yakkaUnitPrice,
    ...overrides,
  };
}

describe('matching-filter-service', () => {
  describe('定数', () => {
    it('MIN_EXCHANGE_VALUE が 10000 である', () => {
      expect(MIN_EXCHANGE_VALUE).toBe(10000);
    });

    it('VALUE_TOLERANCE が 10 である', () => {
      expect(VALUE_TOLERANCE).toBe(10);
    });

    it('MAX_CANDIDATES が 30 である', () => {
      expect(MAX_CANDIDATES).toBe(30);
    });
  });

  describe('balanceValues', () => {
    describe('空リスト', () => {
      it('両方空リストのとき空リストを返す', () => {
        const result = balanceValues([], []);
        expect(result.balancedA).toEqual([]);
        expect(result.balancedB).toEqual([]);
        expect(result.totalA).toBe(0);
        expect(result.totalB).toBe(0);
      });

      it('B が空のとき A は最小まで削減される（B に合わせるため）', () => {
        const itemA = makeItem({ yakkaUnitPrice: 100, quantity: 5 });
        const result = balanceValues([itemA], []);
        // B が空（totalB=0）なので A は VALUE_TOLERANCE 以内まで削減される
        expect(result.totalA).toBeLessThanOrEqual(VALUE_TOLERANCE);
        expect(result.balancedB).toEqual([]);
        expect(result.totalB).toBe(0);
      });
    });

    describe('許容範囲内（全一致）', () => {
      it('差が VALUE_TOLERANCE 以内ならそのまま返す', () => {
        const itemA = makeItem({ yakkaUnitPrice: 1000, quantity: 10 }); // 10000
        const itemB = makeItem({ yakkaUnitPrice: 1000, quantity: 10, deadStockItemId: 2 }); // 10000
        const result = balanceValues([itemA], [itemB]);
        expect(result.totalA).toBe(10000);
        expect(result.totalB).toBe(10000);
        expect(result.balancedA).toHaveLength(1);
        expect(result.balancedB).toHaveLength(1);
      });

      it('差が VALUE_TOLERANCE 以内のとき調整なし', () => {
        // 差がちょうど 0 のケース
        const itemA2 = makeItem({ yakkaUnitPrice: 1000, quantity: 10 }); // 10000
        const itemB2 = makeItem({ yakkaUnitPrice: 1000, quantity: 10, deadStockItemId: 3 }); // 10000
        const result2 = balanceValues([itemA2], [itemB2]);
        expect(Math.abs(result2.totalA - result2.totalB)).toBeLessThanOrEqual(VALUE_TOLERANCE);
        // 元のリストの内容が維持されていること
        expect(result2.balancedA).toHaveLength(1);
        expect(result2.balancedB).toHaveLength(1);
      });
    });

    describe('A > B の調整', () => {
      it('A の合計が B より大きいとき A を削減する', () => {
        const itemA = makeItem({ yakkaUnitPrice: 1000, quantity: 20 }); // 20000
        const itemB = makeItem({ yakkaUnitPrice: 1000, quantity: 10, deadStockItemId: 2 }); // 10000
        const result = balanceValues([itemA], [itemB]);
        expect(result.totalA).toBeLessThanOrEqual(result.totalB + VALUE_TOLERANCE);
        expect(result.totalA).toBeGreaterThan(0);
        expect(result.totalB).toBe(10000);
      });

      it('複数アイテムで最も単価の高いものから削減する', () => {
        const highPrice = makeItem({ deadStockItemId: 1, yakkaUnitPrice: 2000, quantity: 10 }); // 20000
        const lowPrice = makeItem({ deadStockItemId: 2, yakkaUnitPrice: 100, quantity: 10 });  // 1000
        const itemB = makeItem({ deadStockItemId: 3, yakkaUnitPrice: 1000, quantity: 10 });     // 10000
        const result = balanceValues([highPrice, lowPrice], [itemB]);
        // 高単価から削減されるため B の合計に近い値になる
        expect(result.totalA).toBeLessThanOrEqual(result.totalB + VALUE_TOLERANCE);
      });
    });

    describe('B > A の調整', () => {
      it('B の合計が A より大きいとき B を削減する', () => {
        const itemA = makeItem({ yakkaUnitPrice: 1000, quantity: 10 }); // 10000
        const itemB = makeItem({ yakkaUnitPrice: 1000, quantity: 20, deadStockItemId: 2 }); // 20000
        const result = balanceValues([itemA], [itemB]);
        expect(result.totalB).toBeLessThanOrEqual(result.totalA + VALUE_TOLERANCE);
        expect(result.totalB).toBeGreaterThan(0);
        expect(result.totalA).toBe(10000);
      });
    });

    describe('quantity が 0 の除外', () => {
      it('quantity が 0 のアイテムは結果から除外される', () => {
        const zeroQty = makeItem({ deadStockItemId: 1, yakkaUnitPrice: 1000, quantity: 0 });
        const normal = makeItem({ deadStockItemId: 2, yakkaUnitPrice: 1000, quantity: 10 });
        // 同じ量のBを用意（差なし）
        const itemB = makeItem({ deadStockItemId: 3, yakkaUnitPrice: 1000, quantity: 10 });
        const result = balanceValues([zeroQty, normal], [itemB]);
        // zeroQty は除外される
        const hasZeroQty = result.balancedA.some((item) => item.deadStockItemId === 1);
        expect(hasZeroQty).toBe(false);
      });
    });

    describe('数値精度', () => {
      it('totalA, totalB は小数点2桁に丸められる', () => {
        const itemA = makeItem({ yakkaUnitPrice: 333.33, quantity: 3 }); // 999.99
        const itemB = makeItem({ deadStockItemId: 2, yakkaUnitPrice: 333.33, quantity: 3 }); // 999.99
        const result = balanceValues([itemA], [itemB]);
        const decimalPlacesA = (result.totalA.toString().split('.')[1] ?? '').length;
        const decimalPlacesB = (result.totalB.toString().split('.')[1] ?? '').length;
        expect(decimalPlacesA).toBeLessThanOrEqual(2);
        expect(decimalPlacesB).toBeLessThanOrEqual(2);
      });
    });
  });

  describe('groupByPharmacy', () => {
    describe('空リスト', () => {
      it('空リストのとき空 Map を返す', () => {
        const result = groupByPharmacy([]);
        expect(result.size).toBe(0);
      });
    });

    describe('全て同じ薬局', () => {
      it('同一 pharmacyId の場合 1つのキーにまとめる', () => {
        const rows = [
          { pharmacyId: 1, name: '薬局A' },
          { pharmacyId: 1, name: '薬局A' },
          { pharmacyId: 1, name: '薬局A' },
        ];
        const result = groupByPharmacy(rows);
        expect(result.size).toBe(1);
        expect(result.get(1)).toHaveLength(3);
      });
    });

    describe('複数薬局', () => {
      it('異なる pharmacyId は別々のキーになる', () => {
        const rows = [
          { pharmacyId: 1, name: '薬局A' },
          { pharmacyId: 2, name: '薬局B' },
          { pharmacyId: 1, name: '薬局A' },
          { pharmacyId: 3, name: '薬局C' },
        ];
        const result = groupByPharmacy(rows);
        expect(result.size).toBe(3);
        expect(result.get(1)).toHaveLength(2);
        expect(result.get(2)).toHaveLength(1);
        expect(result.get(3)).toHaveLength(1);
      });

      it('各グループに元のオブジェクトが含まれる', () => {
        const rowA = { pharmacyId: 10, value: 'A' };
        const rowB = { pharmacyId: 20, value: 'B' };
        const result = groupByPharmacy([rowA, rowB]);
        expect(result.get(10)).toEqual([rowA]);
        expect(result.get(20)).toEqual([rowB]);
      });
    });

    describe('全除外（存在しないID）', () => {
      it('存在しない pharmacyId は undefined を返す', () => {
        const rows = [{ pharmacyId: 5, name: '薬局X' }];
        const result = groupByPharmacy(rows);
        expect(result.get(999)).toBeUndefined();
      });
    });
  });
});
