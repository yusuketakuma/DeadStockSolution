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
    return Promise.resolve(mocks.dbResponses[idx] ?? []);
  });
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return {
    db: { select: mockSelect },
  };
});

import { scoreAndSortPharmacies, searchPrescriptionInventory } from '../services/prescription-search-service.js';

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
});

describe('searchPrescriptionInventory', () => {
  beforeEach(() => {
    mocks.callCount.value = 0;
    mocks.dbResponses = [];
  });

  it('drugGroups が空（source が見つからない）の場合、空のレスポンスを返す', async () => {
    // resolveDrugGroups の drugMaster(source) → 空
    setupDbResponses([
      [],
    ]);

    const result = await searchPrescriptionInventory(
      1,
      [{ drugMasterId: 999, genericName: null, specification: null }],
      { groupOnly: false, openOnly: false, favoritePriority: false },
      null,
    );

    expect(result.summary).toEqual([]);
    expect(result.matrix.rows).toEqual([]);
  });

  it('在庫がある薬局のみ summary に含まれる', async () => {
    // クエリ順序（groupOnly: false）:
    // 1. drugMaster(source), 2. drugMaster(genericName match), 3. drugMaster(drugNames)
    // 4. deadStockItems, 5. pharmacies, 6. blocked, 7. favorite, 8. manufacturer
    setupDbResponses([
      [{ id: 1, drugName: 'テスト薬', genericName: 'test', specification: '10mg', yakkaPrice: '50.00', manufacturer: null }],
      [{ id: 1 }, { id: 2 }],
      [{ drugName: 'テスト薬' }, { drugName: 'テスト薬ジェネリック' }],
      [
        { id: 10, pharmacyId: 2, drugMasterId: 1, drugName: 'テスト薬', quantity: 3, unit: '錠', yakkaUnitPrice: '50.00' },
        { id: 11, pharmacyId: 3, drugMasterId: 1, drugName: 'テスト薬', quantity: 7, unit: '錠', yakkaUnitPrice: '45.00' },
      ],
      [
        { id: 2, name: '薬局B', latitude: null, longitude: null },
        { id: 3, name: '薬局C', latitude: null, longitude: null },
      ],
      [],
      [],
      [{ id: 1, manufacturer: null }, { id: 2, manufacturer: null }],
    ]);

    const result = await searchPrescriptionInventory(
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
    // genericName match が 2件 → matchedIds.length=2 → Pass 2(drugEquivalences)スキップ
    // クエリ: source, genericName match, drugNames, deadStockItems, pharmacies, blocked, favorite, manufacturer
    setupDbResponses([
      [{ id: 1, drugName: 'テスト薬', genericName: 'test', specification: '10mg', yakkaPrice: '100.00', manufacturer: 'A社' }],
      [{ id: 1 }, { id: 2 }], // 2件返す → Pass 2 スキップ
      [{ drugName: 'テスト薬' }, { drugName: 'テスト薬2' }],
      [{ id: 10, pharmacyId: 2, drugMasterId: 1, drugName: 'テスト薬', quantity: 5, unit: '錠', yakkaUnitPrice: '100.00' }],
      [{ id: 2, name: '薬局B', latitude: 35.0, longitude: 135.0 }],
      [{ pharmacyId: 1, targetPharmacyId: 2 }], // 薬局1が薬局2をブロック
      [],
      [{ id: 1, manufacturer: 'A社' }, { id: 2, manufacturer: 'A社' }],
    ]);

    const result = await searchPrescriptionInventory(
      1,
      [{ drugMasterId: 1, genericName: 'test', specification: '10mg' }],
      { groupOnly: false, openOnly: false, favoritePriority: false },
      null,
    );

    expect(result.summary.map(s => s.pharmacyId)).not.toContain(2);
  });

  it('distance が正しく計算される（同座標なら 0）', async () => {
    // genericName match が 1件 → matchedIds.length=1 → Pass 2(drugEquivalences)も実行される
    // クエリ: source, genericName match, drugEquivalences, drugNames, deadStockItems, pharmacies, blocked, favorite, manufacturer
    setupDbResponses([
      [{ id: 1, drugName: '薬A', genericName: 'gn', specification: '5mg', yakkaPrice: '10.00', manufacturer: null }],
      [{ id: 1 }], // 1件のみ → Pass 2 実行
      [], // drugEquivalences → 同等品なし
      [{ drugName: '薬A' }],
      [{ id: 10, pharmacyId: 2, drugMasterId: 1, drugName: '薬A', quantity: 1, unit: '錠', yakkaUnitPrice: '10.00' }],
      [{ id: 2, name: '薬局B', latitude: 35.6895, longitude: 139.6917 }],
      [],
      [],
      [{ id: 1, manufacturer: null }],
    ]);

    const result = await searchPrescriptionInventory(
      1,
      [{ drugMasterId: 1, genericName: 'gn', specification: '5mg' }],
      { groupOnly: false, openOnly: false, favoritePriority: false },
      { latitude: 35.6895, longitude: 139.6917 },
    );

    expect(result.summary).toHaveLength(1);
    expect(result.summary[0].distance).toBe(0);
  });

  it('isFavorite フラグが正しく設定される', async () => {
    // genericName match が 1件 → Pass 2(drugEquivalences)も実行
    setupDbResponses([
      [{ id: 1, drugName: '薬A', genericName: 'gn', specification: '5mg', yakkaPrice: '10.00', manufacturer: null }],
      [{ id: 1 }], // 1件のみ → Pass 2 実行
      [], // drugEquivalences
      [{ drugName: '薬A' }],
      [{ id: 10, pharmacyId: 2, drugMasterId: 1, drugName: '薬A', quantity: 1, unit: '錠', yakkaUnitPrice: '10.00' }],
      [{ id: 2, name: '薬局B', latitude: null, longitude: null }],
      [], // blocked
      [{ targetPharmacyId: 2 }], // 薬局2をお気に入り
      [{ id: 1, manufacturer: null }],
    ]);

    const result = await searchPrescriptionInventory(
      1,
      [{ drugMasterId: 1, genericName: 'gn', specification: '5mg' }],
      { groupOnly: false, openOnly: false, favoritePriority: false },
      null,
    );

    expect(result.summary).toHaveLength(1);
    expect(result.summary[0].isFavorite).toBe(true);
  });

  it('matrix の columns は drugGroups と対応する（在庫なし）', async () => {
    // genericName match が 1件 → Pass 2(drugEquivalences)も実行
    // 在庫なし → pharmacies クエリはスキップ
    setupDbResponses([
      [{ id: 1, drugName: '薬A', genericName: 'gnA', specification: '10mg', yakkaPrice: '20.00', manufacturer: null }],
      [{ id: 1 }], // 1件のみ → Pass 2 実行
      [], // drugEquivalences
      [{ drugName: '薬A' }],
      [], // 在庫なし deadStockItems
      // pharmacies クエリはスキップ（relevantPharmacyIds が空）
      [], // blocked
      [], // favorite
      [{ id: 1, manufacturer: null }], // manufacturer
    ]);

    const result = await searchPrescriptionInventory(
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

  it('groupOnly フィルタで自薬局のグループメンバー以外が除外される', async () => {
    // genericName match が 1件 → Pass 2(drugEquivalences)も実行
    // groupOnly: true → groupMembers クエリが追加（2件）
    // クエリ順: source, genericName match, drugEquivalences, drugNames,
    //          deadStockItems, pharmacies, blocked,
    //          groupMembers(自薬局のグループ), groupMembers(グループのメンバー),
    //          favorite, manufacturer
    setupDbResponses([
      [{ id: 1, drugName: '薬A', genericName: 'gn', specification: '5mg', yakkaPrice: '10.00', manufacturer: null }],
      [{ id: 1 }], // 1件のみ → Pass 2 実行
      [], // drugEquivalences
      [{ drugName: '薬A' }],
      [
        { id: 10, pharmacyId: 2, drugMasterId: 1, drugName: '薬A', quantity: 1, unit: '錠', yakkaUnitPrice: '10.00' },
        { id: 11, pharmacyId: 3, drugMasterId: 1, drugName: '薬A', quantity: 2, unit: '錠', yakkaUnitPrice: '10.00' },
      ],
      [
        { id: 2, name: '薬局B', latitude: null, longitude: null },
        { id: 3, name: '薬局C', latitude: null, longitude: null },
      ],
      [], // blocked
      [{ groupId: 10 }], // 自薬局が属するグループ
      [{ pharmacyId: 1 }, { pharmacyId: 3 }], // グループ10のメンバー
      [], // favorite
      [{ id: 1, manufacturer: null }],
    ]);

    const result = await searchPrescriptionInventory(
      1,
      [{ drugMasterId: 1, genericName: 'gn', specification: '5mg' }],
      { groupOnly: true, openOnly: false, favoritePriority: false },
      null,
    );

    const pharmacyIds = result.summary.map(s => s.pharmacyId);
    expect(pharmacyIds).not.toContain(2); // グループ外の薬局2は除外
    expect(pharmacyIds).toContain(3); // グループ内の薬局3は含まれる
  });
});
