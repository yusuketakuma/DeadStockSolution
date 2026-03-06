import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
}));

vi.mock('../utils/package-utils', () => ({
  normalizePackageInfo: vi.fn().mockReturnValue({
    normalizedPackageLabel: 'normalized-label',
    packageForm: 'tablet',
    isLoosePackage: false,
  }),
}));

import { syncDrugMaster, syncPackageData, createSyncLog, completeSyncLog } from '../services/drug-master-sync-service';

interface ExistingDrugRow {
  id: number;
  yjCode: string;
  drugName: string;
  genericName: string | null;
  specification: string | null;
  unit: string | null;
  yakkaPrice: string;
  manufacturer: string | null;
  category: string | null;
  therapeuticCategory: string | null;
  isListed: boolean;
  listedDate: string | null;
  transitionDeadline: string | null;
  deletedDate: string | null;
}

function createTxMock(existingRows: ExistingDrugRow[]) {
  const selectFrom = vi.fn().mockResolvedValue(existingRows);
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return {
    tx: { select, insert, update },
    spies: { select, selectFrom, insert, insertValues, update, updateSet, updateWhere },
  };
}

describe('drug-master-sync-service additional coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('syncDrugMaster', () => {
    it('adds a new row when yjCode does not exist', async () => {
      const { tx, spies } = createTxMock([]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [
          {
            yjCode: '111111111111',
            drugName: '新薬A',
            genericName: '成分A',
            specification: '10mg',
            unit: '錠',
            yakkaPrice: 100.5,
            manufacturer: 'メーカーA',
            category: '内用薬',
            therapeuticCategory: '123',
            listedDate: '2025-01-01',
            transitionDeadline: null,
          },
        ],
        1,
        '2026-04-01',
      );

      expect(result.itemsProcessed).toBe(1);
      expect(result.itemsAdded).toBe(1);
      expect(result.itemsUpdated).toBe(0);
      expect(result.itemsDeleted).toBe(0);
      expect(spies.insert).toHaveBeenCalled();
    });

    it('marks delisted items when incoming data lacks the yjCode', async () => {
      const { tx, spies } = createTxMock([
        {
          id: 1,
          yjCode: '999999999999',
          drugName: '旧薬',
          genericName: null,
          specification: null,
          unit: null,
          yakkaPrice: '50.00',
          manufacturer: null,
          category: null,
          therapeuticCategory: null,
          isListed: true,
          listedDate: null,
          transitionDeadline: null,
          deletedDate: null,
        },
      ]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [
          {
            yjCode: '111111111111',
            drugName: '新薬',
            genericName: null,
            specification: null,
            unit: null,
            yakkaPrice: 100,
            manufacturer: null,
            category: null,
            therapeuticCategory: null,
            listedDate: null,
            transitionDeadline: null,
          },
        ],
        1,
        '2026-04-01',
      );

      expect(result.itemsDeleted).toBe(1);
    });

    it('updates price when yakkaPrice changes', async () => {
      const { tx, spies } = createTxMock([
        {
          id: 1,
          yjCode: '111111111111',
          drugName: '薬A',
          genericName: '成分A',
          specification: '10mg',
          unit: '錠',
          yakkaPrice: '100.00',
          manufacturer: 'メーカーA',
          category: '内用薬',
          therapeuticCategory: '123',
          isListed: true,
          listedDate: '2025-01-01',
          transitionDeadline: null,
          deletedDate: null,
        },
      ]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [
          {
            yjCode: '111111111111',
            drugName: '薬A',
            genericName: '成分A',
            specification: '10mg',
            unit: '錠',
            yakkaPrice: 200.0,
            manufacturer: 'メーカーA',
            category: '内用薬',
            therapeuticCategory: '123',
            listedDate: '2025-01-01',
            transitionDeadline: null,
          },
        ],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
      // update for drug row + price history + sync log update
      expect(spies.update).toHaveBeenCalled();
      // price history should be inserted
      expect(spies.insert).toHaveBeenCalled();
    });

    it('re-lists a delisted item', async () => {
      const { tx } = createTxMock([
        {
          id: 1,
          yjCode: '111111111111',
          drugName: '薬A',
          genericName: null,
          specification: null,
          unit: null,
          yakkaPrice: '100.00',
          manufacturer: null,
          category: null,
          therapeuticCategory: null,
          isListed: false,
          listedDate: null,
          transitionDeadline: null,
          deletedDate: '2025-06-01',
        },
      ]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [
          {
            yjCode: '111111111111',
            drugName: '薬A',
            genericName: null,
            specification: null,
            unit: null,
            yakkaPrice: 100,
            manufacturer: null,
            category: null,
            therapeuticCategory: null,
            listedDate: null,
            transitionDeadline: null,
          },
        ],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
    });

    it('throws error for duplicate yjCodes', async () => {
      const { tx } = createTxMock([]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      await expect(
        syncDrugMaster(
          [
            {
              yjCode: '111111111111',
              drugName: '薬A',
              genericName: null,
              specification: null,
              unit: null,
              yakkaPrice: 100,
              manufacturer: null,
              category: null,
              therapeuticCategory: null,
              listedDate: null,
              transitionDeadline: null,
            },
            {
              yjCode: '111111111111',
              drugName: '薬B',
              genericName: null,
              specification: null,
              unit: null,
              yakkaPrice: 200,
              manufacturer: null,
              category: null,
              therapeuticCategory: null,
              listedDate: null,
              transitionDeadline: null,
            },
          ],
          1,
          '2026-04-01',
        ),
      ).rejects.toThrow('YJコードが重複');
    });
  });

  describe('createSyncLog', () => {
    it('inserts a sync log and returns it', async () => {
      const mockLog = { id: 42 };
      mocks.db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockLog]),
        }),
      });

      const result = await createSyncLog('auto', '自動取得', null);
      expect(result.id).toBe(42);
    });
  });

  describe('completeSyncLog', () => {
    it('updates a sync log with completion details', async () => {
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      await expect(
        completeSyncLog(42, 'success', {
          itemsProcessed: 100,
          itemsAdded: 50,
          itemsUpdated: 30,
          itemsDeleted: 20,
        }),
      ).resolves.toBeUndefined();
    });

    it('updates a sync log with error message', async () => {
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      await expect(
        completeSyncLog(
          42,
          'failed',
          { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 },
          'Parse error',
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('syncPackageData', () => {
    it('handles empty parsedRows', async () => {
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof mocks.db) => Promise<unknown>) => callback(mocks.db),
      );

      const result = await syncPackageData([]);
      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
    });
  });
});
