import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  inArray: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
}));

import { enrichWithDrugMaster } from '../services/drug-master-enrichment';

/** DB select チェーンのモックを作成するヘルパー */
function makeChain(result: unknown[]) {
  const chain = {
    limit: vi.fn().mockResolvedValue(result),
    where: vi.fn().mockResolvedValue(result),
    // loadNameCache で `await db.select({}).from(table)` が使われるため thenable にする
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
    catch: (onRejected: (reason: unknown) => void) =>
      Promise.resolve(result).catch(onRejected),
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

describe('drug-master-enrichment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('マスターが空の場合', () => {
    it('全行を drugMasterId: null で返す', async () => {
      // masterCheck が 0件 → 早期リターン
      mocks.db.select.mockReturnValueOnce(makeChain([]));

      const rows = [
        { drugCode: 'YJ1234567890', drugName: '薬A', unit: '錠', yakkaUnitPrice: null },
      ];
      const result = await enrichWithDrugMaster(rows, 'dead_stock');

      expect(result).toHaveLength(1);
      expect(result[0].drugMasterId).toBeNull();
      expect(result[0].drugMasterPackageId).toBeNull();
      expect(result[0].packageLabel).toBeNull();
    });
  });

  describe('空の rows 配列', () => {
    it('空配列を返す', async () => {
      // masterCheck だけ呼ばれる（rows が空でもマスター確認は実行される）
      mocks.db.select.mockReturnValueOnce(makeChain([{ id: 1 }]));

      const result = await enrichWithDrugMaster([], 'dead_stock');

      expect(result).toHaveLength(0);
    });
  });

  describe('YJコードで一致する場合', () => {
    it('薬価と単位がマスターから補完される', async () => {
      const masterRow = {
        id: 1,
        yjCode: 'YJ1234567890',
        yakkaPrice: '150.5',
        unit: '錠',
      };

      mocks.db.select
        // masterCheck
        .mockReturnValueOnce(makeChain([{ id: 1 }]))
        // YJコード検索
        .mockReturnValueOnce(makeChain([masterRow]))
        // パッケージ候補 (unit なしなのでロードされない場合も考慮 → unit ありで呼ばれる)
        .mockReturnValueOnce(makeChain([]));

      const rows = [
        {
          drugCode: 'YJ1234567890',
          drugName: '薬A',
          unit: null,
          yakkaUnitPrice: null,
          quantity: 10,
          yakkaTotal: null,
          expirationDate: null,
          lotNumber: null,
        },
      ];
      const result = await enrichWithDrugMaster(rows, 'dead_stock');

      expect(result[0].drugMasterId).toBe(1);
      expect(result[0].yakkaUnitPrice).toBe(150.5);
      expect(result[0].unit).toBe('錠');
    });

    it('unit が指定されているときパッケージが補完される', async () => {
      const masterRow = {
        id: 1,
        yjCode: 'YJ1234567890',
        yakkaPrice: '100.0',
        unit: '錠',
      };
      const packageRow = {
        id: 5,
        drugMasterId: 1,
        packageDescription: '100錠入',
        packageQuantity: 100,
        packageUnit: '錠',
        normalizedPackageLabel: '100錠',
        packageForm: '錠剤',
        isLoosePackage: false,
      };

      mocks.db.select
        // masterCheck
        .mockReturnValueOnce(makeChain([{ id: 1 }]))
        // YJコード検索
        .mockReturnValueOnce(makeChain([masterRow]))
        // パッケージ候補一括読み込み
        .mockReturnValueOnce(makeChain([packageRow]));

      const rows = [
        {
          drugCode: 'YJ1234567890',
          drugName: '薬A',
          unit: '100錠',
          yakkaUnitPrice: null,
          quantity: 2,
          yakkaTotal: null,
          expirationDate: null,
          lotNumber: null,
        },
      ];
      const result = await enrichWithDrugMaster(rows, 'dead_stock');

      expect(result[0].drugMasterId).toBe(1);
      expect(result[0].drugMasterPackageId).toBe(5);
      expect(result[0].packageLabel).toBe('100錠');
    });
  });

  describe('GS1コードで一致する場合', () => {
    it('包装テーブル経由でマスター情報が補完される', async () => {
      const masterRow = { id: 1, yakkaPrice: '200.0', unit: 'mL' };
      const packageRow = {
        id: 10,
        gs1Code: 'GS100000001',
        janCode: null,
        hotCode: null,
        drugMasterId: 1,
        packageDescription: '500mL',
        packageQuantity: 500,
        packageUnit: 'mL',
        normalizedPackageLabel: '500mL',
        packageForm: '注射剤',
        isLoosePackage: false,
      };

      mocks.db.select
        // masterCheck
        .mockReturnValueOnce(makeChain([{ id: 1 }]))
        // YJコード検索 → 該当なし
        .mockReturnValueOnce(makeChain([]))
        // GS1/JAN/HOTコードでパッケージ検索
        .mockReturnValueOnce(makeChain([packageRow]))
        // masterId=1 のマスター取得
        .mockReturnValueOnce(makeChain([masterRow]));

      const rows = [
        { drugCode: 'GS100000001', drugName: '注射薬A', unit: null, yakkaUnitPrice: null },
      ];
      const result = await enrichWithDrugMaster(rows, 'used_medication');

      expect(result[0].drugMasterId).toBe(1);
      expect(result[0].drugMasterPackageId).toBe(10);
      expect(result[0].packageLabel).toBe('500mL');
    });
  });

  describe('コードなし・名前マッチの場合', () => {
    it('薬品名が完全一致するとき drugMasterId が補完される', async () => {
      const allMasters = [
        { id: 3, drugName: '薬テスト', yakkaPrice: '50.0', unit: '包' },
      ];

      mocks.db.select
        // masterCheck
        .mockReturnValueOnce(makeChain([{ id: 3 }]))
        // codesInRows は空 → YJコード検索はスキップ
        // 名前マッチ: loadNameCache で全マスターを取得
        .mockReturnValueOnce(makeChain(allMasters));

      const rows = [
        { drugCode: null, drugName: '薬テスト', unit: null, yakkaUnitPrice: null },
      ];
      const result = await enrichWithDrugMaster(rows, 'used_medication');

      expect(result[0].drugMasterId).toBe(3);
    });
  });

  describe('未登録コードの場合', () => {
    it('コード/名前ともに不一致なら drugMasterId が null になる', async () => {
      const allMasters = [
        { id: 1, drugName: '別の薬', yakkaPrice: '100.0', unit: '錠' },
      ];

      mocks.db.select
        // masterCheck
        .mockReturnValueOnce(makeChain([{ id: 1 }]))
        // YJコード検索 → 該当なし
        .mockReturnValueOnce(makeChain([]))
        // GS1/JAN/HOTコードでパッケージ検索 → 該当なし
        .mockReturnValueOnce(makeChain([]))
        // 名前マッチ: loadNameCache で全マスターを取得（名前が一致しない）
        .mockReturnValueOnce(makeChain(allMasters));

      const rows = [
        {
          drugCode: 'UNKNOWN999',
          drugName: '存在しない薬品',
          unit: null,
          yakkaUnitPrice: null,
        },
      ];
      const result = await enrichWithDrugMaster(rows, 'used_medication');

      expect(result[0].drugMasterId).toBeNull();
      expect(result[0].drugMasterPackageId).toBeNull();
    });
  });

  describe('dead_stock での yakkaTotal 再計算', () => {
    it('yakkaUnitPrice が null のとき yakkaTotal も計算される', async () => {
      const masterRow = {
        id: 1,
        yjCode: 'YJ0000000001',
        yakkaPrice: '20.0',
        unit: '錠',
      };

      mocks.db.select
        .mockReturnValueOnce(makeChain([{ id: 1 }]))
        .mockReturnValueOnce(makeChain([masterRow]))
        // unit なし → パッケージ候補ロードは不要（呼ばれない）
        .mockReturnValueOnce(makeChain([]));

      const rows = [
        {
          drugCode: 'YJ0000000001',
          drugName: '薬A',
          unit: null,
          yakkaUnitPrice: null,
          quantity: 5,
          yakkaTotal: null,
          expirationDate: null,
          lotNumber: null,
        },
      ];
      const result = await enrichWithDrugMaster(rows, 'dead_stock');

      expect(result[0].yakkaUnitPrice).toBe(20.0);
      expect((result[0] as { yakkaTotal: number | null }).yakkaTotal).toBe(100.0);
    });
  });
});
