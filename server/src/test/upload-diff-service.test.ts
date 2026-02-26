import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

import {
  applyDeadStockDiff,
  applyUsedMedicationDiff,
  previewDeadStockDiff,
  previewUsedMedicationDiff,
} from '../services/upload-diff-service';

function createWhereQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

function createTxMock(existingRows: unknown[]) {
  const selectWhere = vi.fn().mockResolvedValue(existingRows);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const txDelete = vi.fn().mockReturnValue({ where: deleteWhere });

  return {
    tx: {
      select,
      insert,
      update,
      delete: txDelete,
    },
    spies: {
      select,
      selectFrom,
      selectWhere,
      insert,
      insertValues,
      update,
      updateSet,
      updateWhere,
      txDelete,
      deleteWhere,
    },
  };
}

describe('upload-diff-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates dead stock preview summary with insert/update/deactivate', async () => {
    mocks.db.select.mockImplementationOnce(() => createWhereQuery([
      {
        id: 1,
        drugCode: 'A001',
        drugName: '薬A',
        quantity: 10,
        unit: '錠',
        yakkaUnitPrice: '12.5',
        yakkaTotal: '125',
        expirationDate: '2026-03-31',
        expirationDateIso: '2026-03-31',
        lotNumber: 'LOT-A',
        isAvailable: true,
      },
      {
        id: 2,
        drugCode: 'B001',
        drugName: '薬B',
        quantity: 5,
        unit: '錠',
        yakkaUnitPrice: '10',
        yakkaTotal: '50',
        expirationDate: '2026-04-30',
        expirationDateIso: '2026-04-30',
        lotNumber: 'LOT-B',
        isAvailable: true,
      },
    ]));

    const result = await previewDeadStockDiff(10, [
      {
        drugCode: 'A001',
        drugName: '薬A',
        quantity: 12,
        unit: '錠',
        yakkaUnitPrice: 12.5,
        yakkaTotal: 150,
        expirationDate: '2026-03-31',
        lotNumber: 'LOT-A',
      },
      {
        drugCode: 'C001',
        drugName: '薬C',
        quantity: 3,
        unit: '瓶',
        yakkaUnitPrice: 20,
        yakkaTotal: 60,
        expirationDate: '2026/05/20',
        lotNumber: 'LOT-C',
      },
    ], { deleteMissing: true });

    expect(result).toEqual({
      inserted: 1,
      updated: 1,
      deactivated: 1,
      unchanged: 0,
      totalIncoming: 2,
    });
  });

  it('applies dead stock diff with update, insert, and deactivate operation', async () => {
    const { tx, spies } = createTxMock([
      {
        id: 1,
        drugCode: 'A001',
        drugName: '薬A',
        quantity: 10,
        unit: '錠',
        yakkaUnitPrice: '12.5',
        yakkaTotal: '125',
        expirationDate: '2026-03-31',
        expirationDateIso: '2026-03-31',
        lotNumber: 'LOT-A',
        isAvailable: true,
      },
      {
        id: 2,
        drugCode: 'B001',
        drugName: '薬B',
        quantity: 5,
        unit: '錠',
        yakkaUnitPrice: '10',
        yakkaTotal: '50',
        expirationDate: '2026-04-30',
        expirationDateIso: '2026-04-30',
        lotNumber: 'LOT-B',
        isAvailable: true,
      },
    ]);

    const result = await applyDeadStockDiff(tx, 10, 55, [
      {
        drugCode: 'A001',
        drugName: '薬A',
        quantity: 12,
        unit: '錠',
        yakkaUnitPrice: 12.5,
        yakkaTotal: 150,
        expirationDate: '2026-03-31',
        lotNumber: 'LOT-A',
      },
      {
        drugCode: 'C001',
        drugName: '薬C',
        quantity: 3,
        unit: '瓶',
        yakkaUnitPrice: 20,
        yakkaTotal: 60,
        expirationDate: '2026/05/20',
        lotNumber: 'LOT-C',
      },
    ], { deleteMissing: true });

    expect(result).toEqual({
      inserted: 1,
      updated: 1,
      deactivated: 1,
      unchanged: 0,
      totalIncoming: 2,
    });
    expect(spies.insert).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledTimes(2);
    expect(spies.insertValues.mock.calls[0][0]).toEqual(expect.objectContaining({
      pharmacyId: 10,
      uploadId: 55,
      expirationDateIso: '2026-05-20',
      isAvailable: true,
    }));
  });

  it('calculates and applies used medication diffs', async () => {
    mocks.db.select.mockImplementationOnce(() => createWhereQuery([
      {
        id: 1,
        drugCode: 'U001',
        drugName: '薬U',
        unit: '錠',
        monthlyUsage: 100,
        yakkaUnitPrice: '11',
      },
      {
        id: 2,
        drugCode: 'U002',
        drugName: '薬V',
        unit: '瓶',
        monthlyUsage: 30,
        yakkaUnitPrice: '20',
      },
    ]));

    const preview = await previewUsedMedicationDiff(7, [
      {
        drugCode: 'U001',
        drugName: '薬U',
        monthlyUsage: 110,
        unit: '錠',
        yakkaUnitPrice: 11,
      },
      {
        drugCode: 'U003',
        drugName: '薬W',
        monthlyUsage: 10,
        unit: '包',
        yakkaUnitPrice: 8,
      },
    ], { deleteMissing: true });

    expect(preview).toEqual({
      inserted: 1,
      updated: 1,
      deactivated: 1,
      unchanged: 0,
      totalIncoming: 2,
    });

    const { tx, spies } = createTxMock([
      {
        id: 1,
        drugCode: 'U001',
        drugName: '薬U',
        unit: '錠',
        monthlyUsage: 100,
        yakkaUnitPrice: '11',
      },
      {
        id: 2,
        drugCode: 'U002',
        drugName: '薬V',
        unit: '瓶',
        monthlyUsage: 30,
        yakkaUnitPrice: '20',
      },
    ]);

    const applied = await applyUsedMedicationDiff(tx, 7, 66, [
      {
        drugCode: 'U001',
        drugName: '薬U',
        monthlyUsage: 110,
        unit: '錠',
        yakkaUnitPrice: 11,
      },
      {
        drugCode: 'U003',
        drugName: '薬W',
        monthlyUsage: 10,
        unit: '包',
        yakkaUnitPrice: 8,
      },
    ], { deleteMissing: true });

    expect(applied).toEqual({
      inserted: 1,
      updated: 1,
      deactivated: 1,
      unchanged: 0,
      totalIncoming: 2,
    });
    expect(spies.insert).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.txDelete).toHaveBeenCalledTimes(1);
  });
});
