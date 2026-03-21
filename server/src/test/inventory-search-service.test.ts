import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted でモック変数を定義（vi.mock がホイストされるより前に初期化）
const mocks = vi.hoisted(() => {
  return {
    dbResponses: [] as unknown[],
    callCount: { value: 0 },
  };
});

vi.mock('../config/database.js', () => {
  const mockWhere = vi.fn(() => {
    const idx = mocks.callCount.value++;
    const result = mocks.dbResponses[idx] ?? [];
    // Support .then() chaining for Promise.all group query
    return Object.assign(Promise.resolve(result), {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    });
  });
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return {
    db: { select: mockSelect },
  };
});

import { scoreAndSortPharmacies, searchInventoryAvailability } from '../services/inventory-search-service.js';

function setupDbResponses(responses: unknown[]) {
  mocks.dbResponses = responses;
  mocks.callCount.value = 0;
}

describe('scoreAndSortPharmacies', () => {
  it('品目充足数 → 薬価合計 → 距離の順でソートする', () => {
    const pharmacyList = [
      { pharmacyId: 1, matchedCount: 1, totalYakka: 100, distance: 5 },
      { pharmacyId: 2, matchedCount: 2, totalYakka: 200, distance: 10 },
      { pharmacyId: 3, matchedCount: 2, totalYakka: 150, distance: 3 },
    ];
    const sorted = scoreAndSortPharmacies(pharmacyList);
    expect(sorted.map(p => p.pharmacyId)).toEqual([3, 2, 1]);
  });

  it('distance が null の薬局はソート末尾', () => {
    const pharmacyList = [
      { pharmacyId: 1, matchedCount: 2, totalYakka: 100, distance: null },
      { pharmacyId: 2, matchedCount: 2, totalYakka: 100, distance: 5 },
    ];
    const sorted = scoreAndSortPharmacies(pharmacyList);
    expect(sorted.map(p => p.pharmacyId)).toEqual([2, 1]);
  });

  it('matchedCount が同じ場合 totalYakka が低い薬局が優先される', () => {
    const pharmacyList = [
      { pharmacyId: 1, matchedCount: 3, totalYakka: 500, distance: 1 },
      { pharmacyId: 2, matchedCount: 3, totalYakka: 200, distance: 10 },
    ];
    const sorted = scoreAndSortPharmacies(pharmacyList);
    expect(sorted[0].pharmacyId).toBe(2);
  });

  it('空配列を渡した場合は空配列を返す', () => {
    expect(scoreAndSortPharmacies([])).toEqual([]);
  });

  it('distance が両方 null の場合は totalYakka で比較する', () => {
    const pharmacyList = [
      { pharmacyId: 1, matchedCount: 2, totalYakka: 100, distance: null },
      { pharmacyId: 2, matchedCount: 2, totalYakka: 200, distance: null },
    ];
    const sorted = scoreAndSortPharmacies(pharmacyList);
    expect(sorted[0].pharmacyId).toBe(1);
  });

  it('favoritePriority=true の場合は同充足数ならお気に入り薬局を優先する', () => {
    const pharmacyList = [
      { pharmacyId: 1, matchedCount: 2, totalYakka: 100, distance: 5, isFavorite: false },
      { pharmacyId: 2, matchedCount: 2, totalYakka: 200, distance: 1, isFavorite: true },
    ];

    const sorted = scoreAndSortPharmacies(pharmacyList, { favoritePriority: true });
    expect(sorted[0].pharmacyId).toBe(2);
  });

  it('favoritePriority=false の場合はお気に入り判定で順序を変えない', () => {
    const pharmacyList = [
      { pharmacyId: 1, matchedCount: 2, totalYakka: 100, distance: 5, isFavorite: false },
      { pharmacyId: 2, matchedCount: 2, totalYakka: 200, distance: 1, isFavorite: true },
    ];

    const sorted = scoreAndSortPharmacies(pharmacyList, { favoritePriority: false });
    expect(sorted[0].pharmacyId).toBe(1);
  });
});

describe('searchInventoryAvailability', () => {
  beforeEach(() => {
    mocks.callCount.value = 0;
    mocks.dbResponses = [];
  });

  it('drugGroups が空（source が見つからない）の場合、空のレスポンスを返す', async () => {
    // Batch resolveDrugGroups: 1. source batch, 2. equivalences batch → both empty
    setupDbResponses([
      [], // batch source lookup
      [], // batch equivalences lookup
    ]);

    const result = await searchInventoryAvailability(
      1,
      [{ drugMasterId: 999, genericName: null, specification: null }],
      { groupOnly: false, openOnly: false, favoritePriority: false },
      null,
    );

    expect(result.summary).toEqual([]);
    expect(result.matrix.rows).toEqual([]);
  });

  it('在庫がある薬局のみ summary に含まれる', async () => {
    // Batched query order (groupOnly: false):
    // 1. batch source lookup
    // 2. batch equivalences lookup
    // 3. genericName match
    // 4. deadStockItems
    // 5. pharmacies
    // 6-9 (Promise.all): blocked, my groups, favorites, manufacturers
    setupDbResponses([
      [{ id: 1, drugName: 'テスト薬', genericName: 'test', specification: '10mg', yakkaPrice: '50.00', manufacturer: null }],
      [], // equivalences batch
      [{ id: 1 }, { id: 2 }], // genericName match
      // inventory
      [
        { id: 10, pharmacyId: 2, drugMasterId: 1, drugName: 'テスト薬', quantity: 3, unit: '錠', yakkaUnitPrice: '50.00' },
        { id: 11, pharmacyId: 3, drugMasterId: 1, drugName: 'テスト薬', quantity: 7, unit: '錠', yakkaUnitPrice: '45.00' },
      ],
      // pharmacies
      [
        { id: 2, name: '薬局B', latitude: null, longitude: null },
        { id: 3, name: '薬局C', latitude: null, longitude: null },
      ],
      // Promise.all: blocked, my groups, favorites, manufacturers
      [], // blocked
      [], // my groups
      [], // favorites
      [{ id: 1, manufacturer: null }, { id: 2, manufacturer: null }], // manufacturers
    ]);

    const result = await searchInventoryAvailability(
      1,
      [{ drugMasterId: 1, genericName: 'test', specification: '10mg' }],
      { groupOnly: false, openOnly: false, favoritePriority: false },
      null,
    );

    expect(result.summary).toHaveLength(2);
    expect(result.matrix.rows).toHaveLength(2);
    // totalYakka が小さい薬局C (45.0) が先頭
    expect(result.summary[0].pharmacyId).toBe(3);
  });

  it('ブロックされた薬局の在庫は結果に含まれない', async () => {
    setupDbResponses([
      [{ id: 1, drugName: 'テスト薬', genericName: 'test', specification: '10mg', yakkaPrice: '100.00', manufacturer: 'A社' }],
      [], // equivalences batch
      [{ id: 1 }, { id: 2 }], // genericName match
      [{ id: 10, pharmacyId: 2, drugMasterId: 1, drugName: 'テスト薬', quantity: 5, unit: '錠', yakkaUnitPrice: '100.00' }],
      [{ id: 2, name: '薬局B', latitude: 35.0, longitude: 135.0 }],
      // Promise.all: blocked, my groups, favorites, manufacturers
      [{ pharmacyId: 1, targetPharmacyId: 2 }], // 薬局1が薬局2をブロック
      [], // my groups
      [], // favorites
      [{ id: 1, manufacturer: 'A社' }, { id: 2, manufacturer: 'A社' }],
    ]);

    const result = await searchInventoryAvailability(
      1,
      [{ drugMasterId: 1, genericName: 'test', specification: '10mg' }],
      { groupOnly: false, openOnly: false, favoritePriority: false },
      null,
    );

    expect(result.summary.map(s => s.pharmacyId)).not.toContain(2);
  });

  it('matrix の columns は drugGroups と対応する（在庫なし）', async () => {
    setupDbResponses([
      [{ id: 1, drugName: '薬A', genericName: 'gnA', specification: '10mg', yakkaPrice: '20.00', manufacturer: null }],
      [], // equivalences batch
      [{ id: 1 }], // genericName match (1件のみ)
      [], // 在庫なし
      // no pharmacies query (relevantPharmacyIds empty)
      // Promise.all: blocked, my groups, favorites, manufacturers (but allDrugMasterIds=[1] so these still run)
      [], // blocked
      [], // my groups
      [], // favorites
      [{ id: 1, manufacturer: null }], // manufacturers
    ]);

    const result = await searchInventoryAvailability(
      1,
      [{ drugMasterId: 1, genericName: 'gnA', specification: '10mg' }],
      { groupOnly: false, openOnly: false, favoritePriority: false },
      null,
    );

    expect(result.matrix.columns).toHaveLength(1);
    expect(result.matrix.columns[0].genericName).toBe('gnA');
    expect(result.matrix.columns[0].specification).toBe('10mg');
    expect(result.summary).toHaveLength(0);
  });

  it('非アクティブ薬局は結果から除外される', async () => {
    setupDbResponses([
      [{ id: 1, drugName: 'テスト薬', genericName: 'test', specification: '10mg', yakkaPrice: '100.00', manufacturer: null }],
      [],
      [{ id: 1 }],
      [{ id: 10, pharmacyId: 2, drugMasterId: 1, drugName: 'テスト薬', quantity: 5, unit: '錠', yakkaUnitPrice: '100.00' }],
      [],
      [],
      [],
      [],
      [{ id: 1, manufacturer: null }],
    ]);

    const result = await searchInventoryAvailability(
      1,
      [{ drugMasterId: 1, genericName: 'test', specification: '10mg' }],
      { groupOnly: false, openOnly: false, favoritePriority: false },
      null,
    );

    expect(result.summary).toEqual([]);
    expect(result.matrix.rows).toEqual([]);
  });

  it('groupOnly=false でも同一グループ薬局に isGroupMember を付与する', async () => {
    setupDbResponses([
      [{ id: 1, drugName: 'テスト薬', genericName: 'test', specification: '10mg', yakkaPrice: '80.00', manufacturer: null }],
      [],
      [{ id: 1 }],
      [{ id: 10, pharmacyId: 2, drugMasterId: 1, drugName: 'テスト薬', quantity: 5, unit: '錠', yakkaUnitPrice: '80.00' }],
      [{ id: 2, name: '薬局B', latitude: null, longitude: null }],
      [], // blocked
      [{ groupId: 10 }], // my groups
      [], // favorites
      [{ id: 1, manufacturer: null }], // manufacturers
      [{ pharmacyId: 1 }, { pharmacyId: 2 }], // group members
    ]);

    const result = await searchInventoryAvailability(
      1,
      [{ drugMasterId: 1, genericName: 'test', specification: '10mg' }],
      { groupOnly: false, openOnly: false, favoritePriority: false },
      null,
    );

    expect(result.summary).toHaveLength(1);
    expect(result.summary[0]?.isGroupMember).toBe(true);
  });
});
