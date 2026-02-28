import { describe, expect, it, vi } from 'vitest';

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
import { createSelectWhereChain, createWhereQuery } from './helpers/mock-builders';
import { setupVitestMocks } from './helpers/setup';

function createTxMock(existingRows: unknown[]) {
  const { select, selectFrom, selectWhere } = createSelectWhereChain(existingRows);

  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });
  const execute = vi.fn().mockResolvedValue(undefined);

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const txDelete = vi.fn().mockReturnValue({ where: deleteWhere });

  return {
    tx: {
      select,
      insert,
      update,
      execute,
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
      execute,
      txDelete,
      deleteWhere,
    },
  };
}

describe('upload-diff-service', () => {
  setupVitestMocks();

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
    expect(spies.execute).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.insertValues.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pharmacyId: 10,
        uploadId: 55,
        expirationDateIso: '2026-05-20',
        isAvailable: true,
      }),
    ]));
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
    expect(spies.execute).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledTimes(0);
    expect(spies.txDelete).toHaveBeenCalledTimes(1);
  });

  it('splits bulk inserts into multiple batches when input size exceeds batch limit', async () => {
    const { tx, spies } = createTxMock([]);
    const incoming = Array.from({ length: 501 }, (_, index) => ({
      drugCode: `U${String(index + 1).padStart(4, '0')}`,
      drugName: `薬${index + 1}`,
      monthlyUsage: 10,
      unit: '錠',
      yakkaUnitPrice: 12,
    }));

    const applied = await applyUsedMedicationDiff(tx, 7, 66, incoming, { deleteMissing: false });

    expect(applied).toEqual({
      inserted: 501,
      updated: 0,
      deactivated: 0,
      unchanged: 0,
      totalIncoming: 501,
    });
    expect(spies.insert).toHaveBeenCalledTimes(2);
    expect(spies.insertValues).toHaveBeenCalledTimes(2);
  });

  it('deduplicates duplicate dead stock rows before applying inserts', async () => {
    const { tx, spies } = createTxMock([]);

    const result = await applyDeadStockDiff(tx, 10, 55, [
      {
        drugCode: 'D001',
        drugName: '薬D',
        quantity: 5,
        unit: '錠',
        yakkaUnitPrice: 10,
        yakkaTotal: 50,
        expirationDate: '2026-03-31',
        lotNumber: 'LOT-D',
      },
      {
        drugCode: 'D001',
        drugName: '薬D',
        quantity: 6,
        unit: '錠',
        yakkaUnitPrice: 10,
        yakkaTotal: 60,
        expirationDate: '2026-03-31',
        lotNumber: 'LOT-D',
      },
    ], { deleteMissing: false });

    expect(result).toEqual({
      inserted: 1,
      updated: 0,
      deactivated: 0,
      unchanged: 0,
      totalIncoming: 1,
    });
    expect(spies.insert).toHaveBeenCalledTimes(1);
    const insertedRows = spies.insertValues.mock.calls[0][0] as Array<{ quantity: number }>;
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].quantity).toBe(6);
  });

  it('deduplicates duplicate used medication rows in preview', async () => {
    mocks.db.select.mockImplementationOnce(() => createWhereQuery([]));

    const result = await previewUsedMedicationDiff(7, [
      {
        drugCode: 'U999',
        drugName: '薬Z',
        monthlyUsage: 10,
        unit: '錠',
        yakkaUnitPrice: 12,
      },
      {
        drugCode: 'U999',
        drugName: '薬Z',
        monthlyUsage: 10,
        unit: '錠',
        yakkaUnitPrice: 12,
      },
    ], { deleteMissing: false });

    expect(result).toEqual({
      inserted: 1,
      updated: 0,
      deactivated: 0,
      unchanged: 0,
      totalIncoming: 1,
    });
  });

  it('treats drug master link updates as changed in dead stock diff', async () => {
    const { tx } = createTxMock([
      {
        id: 1,
        drugCode: 'L001',
        drugName: '薬L',
        drugMasterId: null,
        drugMasterPackageId: null,
        packageLabel: null,
        quantity: 10,
        unit: '錠',
        yakkaUnitPrice: '10',
        yakkaTotal: '100',
        expirationDate: '2026-04-30',
        expirationDateIso: '2026-04-30',
        lotNumber: 'LOT-L',
        isAvailable: true,
      },
    ]);

    const result = await applyDeadStockDiff(tx, 10, 55, [
      {
        drugCode: 'L001',
        drugName: '薬L',
        drugMasterId: 101,
        drugMasterPackageId: 202,
        packageLabel: '10錠PTP',
        quantity: 10,
        unit: '錠',
        yakkaUnitPrice: 10,
        yakkaTotal: 100,
        expirationDate: '2026-04-30',
        lotNumber: 'LOT-L',
      },
    ], { deleteMissing: false });

    expect(result).toEqual({
      inserted: 0,
      updated: 1,
      deactivated: 0,
      unchanged: 0,
      totalIncoming: 1,
    });
  });

  it('treats drug master link updates as changed in used medication diff', async () => {
    const { tx } = createTxMock([
      {
        id: 1,
        drugCode: 'M001',
        drugName: '薬M',
        drugMasterId: null,
        drugMasterPackageId: null,
        packageLabel: null,
        unit: '錠',
        monthlyUsage: 100,
        yakkaUnitPrice: '20',
      },
    ]);

    const result = await applyUsedMedicationDiff(tx, 7, 66, [
      {
        drugCode: 'M001',
        drugName: '薬M',
        drugMasterId: 11,
        drugMasterPackageId: 12,
        packageLabel: '100錠',
        monthlyUsage: 100,
        unit: '錠',
        yakkaUnitPrice: 20,
      },
    ], { deleteMissing: false });

    expect(result).toEqual({
      inserted: 0,
      updated: 1,
      deactivated: 0,
      unchanged: 0,
      totalIncoming: 1,
    });
  });
});
