import { describe, it, expect, vi } from 'vitest';

// DB と schema をモック
vi.mock('../db/index.js', () => ({ db: { select: vi.fn() } }));
vi.mock('../db/schema.js', () => ({
  drugMaster: { id: 'id', drugName: 'drug_name', genericName: 'generic_name', specification: 'specification', yakkaPrice: 'yakka_price', manufacturer: 'manufacturer' },
  drugEquivalences: { drugNameA: 'drug_name_a', drugNameB: 'drug_name_b' },
}));

// scoreAndSortPharmacies のテスト（純粋関数なのでモック不要）
import { scoreAndSortPharmacies } from '../services/prescription-search-service.js';

describe('scoreAndSortPharmacies', () => {
  it('品目充足数 → 薬価合計 → 距離の順でソートする', () => {
    const pharmacies = [
      { pharmacyId: 1, matchedCount: 1, totalYakka: 100, distance: 5 },
      { pharmacyId: 2, matchedCount: 2, totalYakka: 200, distance: 10 },
      { pharmacyId: 3, matchedCount: 2, totalYakka: 150, distance: 3 },
    ];
    const sorted = scoreAndSortPharmacies(pharmacies);
    expect(sorted.map(p => p.pharmacyId)).toEqual([3, 2, 1]);
  });

  it('distance が null の薬局はソート末尾', () => {
    const pharmacies = [
      { pharmacyId: 1, matchedCount: 2, totalYakka: 100, distance: null },
      { pharmacyId: 2, matchedCount: 2, totalYakka: 100, distance: 5 },
    ];
    const sorted = scoreAndSortPharmacies(pharmacies);
    expect(sorted.map(p => p.pharmacyId)).toEqual([2, 1]);
  });
});
