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

const normalizePackageInfoMock = vi.fn().mockReturnValue({
  normalizedPackageLabel: 'normalized-label',
  packageForm: 'tablet',
  isLoosePackage: false,
});

vi.mock('../utils/package-utils', () => ({
  normalizePackageInfo: (...args: unknown[]) => normalizePackageInfoMock(...args),
}));

import { syncDrugMaster, syncPackageData } from '../services/drug-master-sync-service';

// ── Helpers ──

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

function makeRow(overrides: Partial<ExistingDrugRow> = {}): ExistingDrugRow {
  return {
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
    ...overrides,
  };
}

function makeParsedRow(overrides: Record<string, unknown> = {}) {
  return {
    yjCode: '111111111111',
    drugName: '薬A',
    genericName: '成分A',
    specification: '10mg',
    unit: '錠',
    yakkaPrice: 100,
    manufacturer: 'メーカーA',
    category: '内用薬',
    therapeuticCategory: '123',
    listedDate: '2025-01-01',
    transitionDeadline: null,
    ...overrides,
  };
}

describe('drug-master-sync-deep', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-setup normalizePackageInfoMock after resetAllMocks clears it
    normalizePackageInfoMock.mockReturnValue({
      normalizedPackageLabel: 'normalized-label',
      packageForm: 'tablet',
      isLoosePackage: false,
    });
  });

  // ── syncDrugMaster additional scenarios ──

  describe('syncDrugMaster', () => {
    it('updates when metadata changes (drugName differs)', async () => {
      const { tx, spies } = createTxMock([makeRow()]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow({ drugName: '薬A改名' })],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
      expect(spies.update).toHaveBeenCalled();
    });

    it('updates when genericName changes', async () => {
      const { tx } = createTxMock([makeRow()]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow({ genericName: '新成分' })],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
    });

    it('updates when specification changes', async () => {
      const { tx } = createTxMock([makeRow()]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow({ specification: '20mg' })],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
    });

    it('updates when unit changes', async () => {
      const { tx } = createTxMock([makeRow()]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow({ unit: 'カプセル' })],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
    });

    it('updates when manufacturer changes', async () => {
      const { tx } = createTxMock([makeRow()]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow({ manufacturer: '新メーカー' })],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
    });

    it('updates when category changes', async () => {
      const { tx } = createTxMock([makeRow()]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow({ category: '外用薬' })],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
    });

    it('updates when therapeuticCategory changes', async () => {
      const { tx } = createTxMock([makeRow()]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow({ therapeuticCategory: '456' })],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
    });

    it('does not update when nothing has changed', async () => {
      const { tx } = createTxMock([makeRow()]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow()],
        1,
        '2026-04-01',
      );

      expect(result.itemsProcessed).toBe(1);
      expect(result.itemsUpdated).toBe(0);
      expect(result.itemsAdded).toBe(0);
    });

    it('records new_listing revision type when delisted item is re-listed with price change', async () => {
      const { tx, spies } = createTxMock([
        makeRow({ isListed: false, yakkaPrice: '80.00', deletedDate: '2025-06-01' }),
      ]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow({ yakkaPrice: 120 })],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
      // Both update (drug row) and insert (price history) should be called
      expect(spies.update).toHaveBeenCalled();
      expect(spies.insert).toHaveBeenCalled();
    });

    it('handles multiple batches when rows exceed BATCH_SIZE', async () => {
      // Create 600 existing rows to exceed BATCH_SIZE of 500
      const existingRows: ExistingDrugRow[] = [];
      const parsedRows = [];
      for (let i = 0; i < 600; i++) {
        const yjCode = String(i).padStart(12, '0');
        existingRows.push(makeRow({ id: i + 1, yjCode }));
        parsedRows.push(makeParsedRow({ yjCode }));
      }

      const { tx } = createTxMock(existingRows);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(parsedRows, 1, '2026-04-01');

      expect(result.itemsProcessed).toBe(600);
    });

    it('handles delisting of multiple items in batches', async () => {
      // 600 existing items but no incoming items → all get delisted
      const existingRows: ExistingDrugRow[] = [];
      for (let i = 0; i < 600; i++) {
        const yjCode = String(i).padStart(12, '0');
        existingRows.push(makeRow({ id: i + 1, yjCode }));
      }

      const { tx, spies } = createTxMock(existingRows);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      // Send one new row that won't match any existing
      const result = await syncDrugMaster(
        [makeParsedRow({ yjCode: '999999999999' })],
        1,
        '2026-04-01',
      );

      expect(result.itemsDeleted).toBe(600);
      expect(result.itemsAdded).toBe(1);
      // Update for delisting + insert for new row
      expect(spies.update).toHaveBeenCalled();
      expect(spies.insert).toHaveBeenCalled();
    });

    it('updates when deletedDate is non-null (existing item was soft-deleted)', async () => {
      const { tx } = createTxMock([
        makeRow({ deletedDate: '2025-12-01' }),
      ]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow()],
        1,
        '2026-04-01',
      );

      // deletedDate !== null triggers metadataChanged
      expect(result.itemsUpdated).toBe(1);
    });

    it('updates when listedDate changes', async () => {
      const { tx } = createTxMock([makeRow()]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow({ listedDate: '2026-01-01' })],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
    });

    it('updates when transitionDeadline changes', async () => {
      const { tx } = createTxMock([makeRow()]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow({ transitionDeadline: '2027-04-01' })],
        1,
        '2026-04-01',
      );

      expect(result.itemsUpdated).toBe(1);
    });

    it('does not insert price history when only metadata changes without price change', async () => {
      const { tx, spies } = createTxMock([makeRow()]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      await syncDrugMaster(
        [makeParsedRow({ drugName: '薬A改' })],
        1,
        '2026-04-01',
      );

      // insert should be called for price history only if price changed
      // In this case, only metadata changed, so no price history insert
      // The insert call count should only be for the sync log update pathway
      // (update is used for sync log, not insert)
      expect(spies.insertValues).not.toHaveBeenCalled();
    });

    it('skips already-delisted items during delisting phase', async () => {
      const { tx } = createTxMock([
        makeRow({ yjCode: '000000000001', isListed: false }),
        makeRow({ yjCode: '000000000002', isListed: true, id: 2 }),
      ]);
      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const result = await syncDrugMaster(
        [makeParsedRow({ yjCode: '999999999999' })],
        1,
        '2026-04-01',
      );

      // Only item 2 (isListed=true) should be delisted, not item 1
      expect(result.itemsDeleted).toBe(1);
    });
  });

  // ── syncPackageData additional scenarios ──

  describe('syncPackageData', () => {
    function createPackageDbMock(
      masterItems: Array<{ id: number; yjCode: string }>,
      existingPackages: Array<{
        id: number;
        drugMasterId: number;
        gs1Code: string | null;
        janCode: string | null;
        hotCode: string | null;
        packageDescription: string | null;
        packageQuantity: number | null;
        packageUnit: string | null;
        normalizedPackageLabel: string | null;
        packageForm: string | null;
        isLoosePackage: boolean;
      }>,
    ) {
      // First select: drug_master items
      // Second select: existing packages
      const selectCalls: unknown[][] = [masterItems, existingPackages];
      let selectCallIdx = 0;

      const selectMock = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            const result = selectCalls[selectCallIdx] ?? [];
            selectCallIdx++;
            return Promise.resolve(result);
          }),
        })),
      }));

      mocks.db.select.mockImplementation(selectMock);

      // Transaction mock
      const insertReturning = vi.fn().mockResolvedValue([]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
      const txInsert = vi.fn().mockReturnValue({ values: insertValues });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      const txUpdate = vi.fn().mockReturnValue({ set: updateSet });

      const tx = {
        insert: txInsert,
        update: txUpdate,
      };

      mocks.db.transaction.mockImplementation(
        async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
      );

      return { tx, spies: { txInsert, insertValues, insertReturning, txUpdate, updateSet } };
    }

    it('inserts new package when no existing match found', async () => {
      const { spies } = createPackageDbMock(
        [{ id: 1, yjCode: '111111111111' }],
        [],
      );

      spies.insertReturning.mockResolvedValue([{
        id: 100,
        drugMasterId: 1,
        gs1Code: 'GS1-NEW',
        janCode: null,
        hotCode: null,
        packageDescription: '10錠',
        packageQuantity: 10,
        packageUnit: '錠',
        normalizedPackageLabel: 'normalized-label',
        packageForm: 'tablet',
        isLoosePackage: false,
      }]);

      const result = await syncPackageData([
        {
          yjCode: '111111111111',
          gs1Code: 'GS1-NEW',
          janCode: null,
          hotCode: null,
          packageDescription: '10錠',
          packageQuantity: 10,
          packageUnit: '錠',
        },
      ]);

      expect(result.added).toBe(1);
      expect(result.updated).toBe(0);
    });

    it('updates existing package matched by gs1Code', async () => {
      createPackageDbMock(
        [{ id: 1, yjCode: '111111111111' }],
        [{
          id: 50,
          drugMasterId: 1,
          gs1Code: 'GS1-EXISTING',
          janCode: null,
          hotCode: null,
          packageDescription: '古い10錠',
          packageQuantity: 10,
          packageUnit: '錠',
          normalizedPackageLabel: 'old-label',
          packageForm: 'tablet',
          isLoosePackage: false,
        }],
      );

      const result = await syncPackageData([
        {
          yjCode: '111111111111',
          gs1Code: 'GS1-EXISTING',
          janCode: null,
          hotCode: null,
          packageDescription: '新しい10錠',
          packageQuantity: 10,
          packageUnit: '錠',
        },
      ]);

      expect(result.updated).toBe(1);
      expect(result.added).toBe(0);
    });

    it('matches existing package by janCode when gs1Code is null', async () => {
      createPackageDbMock(
        [{ id: 1, yjCode: '111111111111' }],
        [{
          id: 51,
          drugMasterId: 1,
          gs1Code: null,
          janCode: 'JAN-EXISTING',
          hotCode: null,
          packageDescription: '20錠',
          packageQuantity: 20,
          packageUnit: '錠',
          normalizedPackageLabel: 'label',
          packageForm: 'tablet',
          isLoosePackage: false,
        }],
      );

      const result = await syncPackageData([
        {
          yjCode: '111111111111',
          gs1Code: null,
          janCode: 'JAN-EXISTING',
          hotCode: null,
          packageDescription: '20錠 更新',
          packageQuantity: 20,
          packageUnit: '錠',
        },
      ]);

      expect(result.updated).toBe(1);
    });

    it('matches existing package by hotCode when gs1Code and janCode are null', async () => {
      createPackageDbMock(
        [{ id: 1, yjCode: '111111111111' }],
        [{
          id: 52,
          drugMasterId: 1,
          gs1Code: null,
          janCode: null,
          hotCode: 'HOT-EXISTING',
          packageDescription: '30錠',
          packageQuantity: 30,
          packageUnit: '錠',
          normalizedPackageLabel: 'label',
          packageForm: 'tablet',
          isLoosePackage: false,
        }],
      );

      const result = await syncPackageData([
        {
          yjCode: '111111111111',
          gs1Code: null,
          janCode: null,
          hotCode: 'HOT-EXISTING',
          packageDescription: '30錠 更新',
          packageQuantity: 30,
          packageUnit: '錠',
        },
      ]);

      expect(result.updated).toBe(1);
    });

    it('skips rows with unmatched yjCode (no drug_master entry)', async () => {
      createPackageDbMock(
        [{ id: 1, yjCode: '111111111111' }],
        [],
      );

      const result = await syncPackageData([
        {
          yjCode: '999999999999',
          gs1Code: 'GS1-ORPHAN',
          janCode: null,
          hotCode: null,
          packageDescription: '10錠',
          packageQuantity: 10,
          packageUnit: '錠',
        },
      ]);

      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
    });

    it('handles multiple rows for the same yjCode', async () => {
      const { spies } = createPackageDbMock(
        [{ id: 1, yjCode: '111111111111' }],
        [],
      );

      spies.insertReturning.mockResolvedValue([
        {
          id: 100,
          drugMasterId: 1,
          gs1Code: 'GS1-A',
          janCode: null,
          hotCode: null,
          packageDescription: '10錠',
          packageQuantity: 10,
          packageUnit: '錠',
          normalizedPackageLabel: 'label-a',
          packageForm: 'tablet',
          isLoosePackage: false,
        },
        {
          id: 101,
          drugMasterId: 1,
          gs1Code: 'GS1-B',
          janCode: null,
          hotCode: null,
          packageDescription: '100錠',
          packageQuantity: 100,
          packageUnit: '錠',
          normalizedPackageLabel: 'label-b',
          packageForm: 'tablet',
          isLoosePackage: false,
        },
      ]);

      const result = await syncPackageData([
        {
          yjCode: '111111111111',
          gs1Code: 'GS1-A',
          janCode: null,
          hotCode: null,
          packageDescription: '10錠',
          packageQuantity: 10,
          packageUnit: '錠',
        },
        {
          yjCode: '111111111111',
          gs1Code: 'GS1-B',
          janCode: null,
          hotCode: null,
          packageDescription: '100錠',
          packageQuantity: 100,
          packageUnit: '錠',
        },
      ]);

      expect(result.added).toBe(2);
    });

    it('handles large dataset chunking (> 500 rows)', async () => {
      const rows = [];
      for (let i = 0; i < 600; i++) {
        rows.push({
          yjCode: '111111111111',
          gs1Code: `GS1-${String(i).padStart(4, '0')}`,
          janCode: null,
          hotCode: null,
          packageDescription: `${i}錠`,
          packageQuantity: i + 1,
          packageUnit: '錠',
        });
      }

      const { spies } = createPackageDbMock(
        [{ id: 1, yjCode: '111111111111' }],
        [],
      );

      // The transaction processes rows in batches of 500.
      // tx.insert().values().returning() is called once per batch with items.
      // We need to return results for both batch 1 (500 items) and batch 2 (100 items).
      spies.insertReturning
        .mockResolvedValueOnce(
          rows.slice(0, 500).map((r, idx) => ({
            id: idx + 100,
            drugMasterId: 1,
            gs1Code: r.gs1Code,
            janCode: null,
            hotCode: null,
            packageDescription: r.packageDescription,
            packageQuantity: r.packageQuantity,
            packageUnit: r.packageUnit,
            normalizedPackageLabel: 'normalized-label',
            packageForm: 'tablet',
            isLoosePackage: false,
          })),
        )
        .mockResolvedValueOnce(
          rows.slice(500).map((r, idx) => ({
            id: idx + 600,
            drugMasterId: 1,
            gs1Code: r.gs1Code,
            janCode: null,
            hotCode: null,
            packageDescription: r.packageDescription,
            packageQuantity: r.packageQuantity,
            packageUnit: r.packageUnit,
            normalizedPackageLabel: 'normalized-label',
            packageForm: 'tablet',
            isLoosePackage: false,
          })),
        );

      const result = await syncPackageData(rows);

      expect(result.added).toBe(600);
    });
  });
});
