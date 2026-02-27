import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
}));

import { syncDrugMaster } from '../services/drug-master-sync-service';

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
    tx: {
      select,
      insert,
      update,
    },
    spies: {
      select,
      selectFrom,
      insert,
      insertValues,
      update,
      updateSet,
      updateWhere,
    },
  };
}

describe('drug-master-sync-service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('does not update existing row when there is no diff', async () => {
    const { tx, spies } = createTxMock([
      {
        id: 1,
        yjCode: '111111111111',
        drugName: '薬A',
        genericName: '成分A',
        specification: '10mg',
        unit: '錠',
        yakkaPrice: '12.50',
        manufacturer: 'メーカーA',
        category: '内用薬',
        therapeuticCategory: '123',
        isListed: true,
        listedDate: '2025-01-01',
        transitionDeadline: null,
        deletedDate: null,
      },
    ]);
    mocks.db.transaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await syncDrugMaster([
      {
        yjCode: '111111111111',
        drugName: '薬A',
        genericName: '成分A',
        specification: '10mg',
        unit: '錠',
        yakkaPrice: 12.5,
        manufacturer: 'メーカーA',
        category: '内用薬',
        therapeuticCategory: '123',
        listedDate: '2025-01-01',
        transitionDeadline: null,
      },
    ], 77, '2026-04-01');

    expect(result).toEqual({
      itemsProcessed: 1,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsDeleted: 0,
    });
    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('updates existing row only when values changed', async () => {
    const { tx, spies } = createTxMock([
      {
        id: 1,
        yjCode: '222222222222',
        drugName: '薬B',
        genericName: '成分B',
        specification: '20mg',
        unit: '錠',
        yakkaPrice: '15.00',
        manufacturer: '旧メーカー',
        category: '内用薬',
        therapeuticCategory: '321',
        isListed: true,
        listedDate: '2025-01-01',
        transitionDeadline: null,
        deletedDate: null,
      },
    ]);
    mocks.db.transaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await syncDrugMaster([
      {
        yjCode: '222222222222',
        drugName: '薬B',
        genericName: '成分B',
        specification: '20mg',
        unit: '錠',
        yakkaPrice: 15,
        manufacturer: '新メーカー',
        category: '内用薬',
        therapeuticCategory: '321',
        listedDate: '2025-01-01',
        transitionDeadline: null,
      },
    ], 88, '2026-04-01');

    expect(result).toEqual({
      itemsProcessed: 1,
      itemsAdded: 0,
      itemsUpdated: 1,
      itemsDeleted: 0,
    });
    expect(spies.update).toHaveBeenCalledTimes(2);
  });
});
