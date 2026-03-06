/**
 * exchange-service-final.test.ts
 * Covers uncovered lines in exchange-service.ts:
 * - completeProposal: successful full path (stock update, insert exchangeHistory, delete reservations)
 * - completeProposal: !stock case (stock not in stockMap)
 * - completeProposal: stock.pharmacyId mismatch case
 * - createProposal: blocked pharmacy error
 * - createProposal: stock not found in stockMap
 * - createProposal: stock belongs to wrong pharmacy (pharmacyId !== pharmacyAId)
 * - createProposal: stock not available
 * - createProposal: quantity exceeds available
 * - createProposal: unit price zero/invalid
 * - createProposal: value difference exceeds tolerance
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDeleteQuery,
  createGroupByQuery,
  createInsertQuery,
  createInsertReturningQuery,
  createSelectQuery,
  createSimpleSelectQuery,
  createUpdateReturningQuery,
} from './helpers/mock-builders';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
  createNotification: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('../services/notification-service', () => ({
  createNotification: mocks.createNotification,
}));

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

import { completeProposal, createProposal } from '../services/exchange-service';

// ── Tests ──────────────────────────────────────────────────────────

describe('exchange-service-final', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createNotification.mockResolvedValue({ id: 99 });
  });

  describe('completeProposal — successful full path', () => {
    it('completes proposal successfully: updates stocks, inserts history, deletes reservations', async () => {
      const tx = {
        select: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
      };

      tx.select
        // 1st: proposal
        .mockImplementationOnce(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'confirmed',
          totalValueA: '15000',
          totalValueB: '15000',
        }]))
        // 2nd: proposal items
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { deadStockItemId: 11, fromPharmacyId: 1, quantity: 5 },
          { deadStockItemId: 22, fromPharmacyId: 2, quantity: 3 },
        ]))
        // 3rd: stock rows
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { id: 11, pharmacyId: 1, quantity: 10, isAvailable: true },
          { id: 22, pharmacyId: 2, quantity: 5, isAvailable: true },
        ]));

      // 1st update: claim proposal (optimistic lock)
      tx.update
        .mockImplementationOnce(() => createUpdateReturningQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          totalValueA: '15000',
          totalValueB: '15000',
        }]))
        // 2nd update: stock item 11
        .mockImplementationOnce(() => createUpdateReturningQuery([{ id: 11 }]))
        // 3rd update: stock item 22
        .mockImplementationOnce(() => createUpdateReturningQuery([{ id: 22 }]));

      tx.insert.mockReturnValue(createInsertQuery());
      tx.delete.mockReturnValue(createDeleteQuery());

      mocks.db.transaction.mockImplementation(
        async (cb: (t: typeof tx) => Promise<void>) => cb(tx),
      );

      await expect(completeProposal(100, 1)).resolves.toBeUndefined();

      // Verify exchangeHistory was inserted
      expect(tx.insert).toHaveBeenCalled();
      // Verify deadStockReservations were deleted
      expect(tx.delete).toHaveBeenCalled();
    });

    it('throws when stock not found in stockMap (!stock branch)', async () => {
      const tx = {
        select: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
      };

      tx.select
        .mockImplementationOnce(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'confirmed',
          totalValueA: '15000',
          totalValueB: '15000',
        }]))
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { deadStockItemId: 11, fromPharmacyId: 1, quantity: 5 },
        ]))
        .mockImplementationOnce(() => createSimpleSelectQuery([])); // empty stockRows => stockMap empty

      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        totalValueA: '15000',
        totalValueB: '15000',
      }]));

      mocks.db.transaction.mockImplementation(
        async (cb: (t: typeof tx) => Promise<void>) => cb(tx),
      );

      await expect(completeProposal(100, 1)).rejects.toThrow('在庫状態が変更されているため、交換を完了できません');
    });

    it('throws when stock.pharmacyId does not match item.fromPharmacyId', async () => {
      const tx = {
        select: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
      };

      tx.select
        .mockImplementationOnce(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'confirmed',
          totalValueA: '15000',
          totalValueB: '15000',
        }]))
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { deadStockItemId: 11, fromPharmacyId: 1, quantity: 5 },
        ]))
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { id: 11, pharmacyId: 99, quantity: 10, isAvailable: true }, // wrong pharmacyId
        ]));

      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        totalValueA: '15000',
        totalValueB: '15000',
      }]));

      mocks.db.transaction.mockImplementation(
        async (cb: (t: typeof tx) => Promise<void>) => cb(tx),
      );

      await expect(completeProposal(100, 1)).rejects.toThrow('在庫状態が変更されているため、交換を完了できません');
    });
  });

  describe('createProposal — additional uncovered paths', () => {
    function setupTx() {
      return {
        select: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
        execute: vi.fn().mockResolvedValue(undefined),
      };
    }

    it('throws when stock item is not found in stockMap (itemsFromA)', async () => {
      const tx = setupTx();

      tx.select
        // pharmacyB active
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: true }]))
        // no blocked relationship
        .mockImplementationOnce(() => createSelectQuery([]))
        // stock rows: does not include item 1
        .mockImplementationOnce(() => createSimpleSelectQuery([]))
        // reservations: none
        .mockImplementationOnce(() => createGroupByQuery([]));

      tx.execute.mockResolvedValue(undefined);
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const candidate = {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };

      await expect(createProposal(1, candidate)).rejects.toThrow('提案対象の在庫が見つかりません');
    });

    it('throws when stock does not belong to pharmacyA (itemsFromA)', async () => {
      const tx = setupTx();

      tx.select
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: true }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        // stock belongs to pharmacy 99, not pharmacy 1
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { id: 1, pharmacyId: 99, quantity: 10, yakkaUnitPrice: '1000', isAvailable: true },
          { id: 2, pharmacyId: 2, quantity: 10, yakkaUnitPrice: '1000', isAvailable: true },
        ]))
        .mockImplementationOnce(() => createGroupByQuery([]));

      tx.execute.mockResolvedValue(undefined);
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const candidate = {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };

      await expect(createProposal(1, candidate)).rejects.toThrow('自薬局の在庫のみ提案できます');
    });

    it('throws when stock in itemsFromA is not available', async () => {
      const tx = setupTx();

      tx.select
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: true }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { id: 1, pharmacyId: 1, quantity: 10, yakkaUnitPrice: '1000', isAvailable: false },
          { id: 2, pharmacyId: 2, quantity: 10, yakkaUnitPrice: '1000', isAvailable: true },
        ]))
        .mockImplementationOnce(() => createGroupByQuery([]));

      tx.execute.mockResolvedValue(undefined);
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const candidate = {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };

      await expect(createProposal(1, candidate)).rejects.toThrow('提案対象の在庫が既に利用不可です');
    });

    it('throws when itemsFromA quantity exceeds available', async () => {
      const tx = setupTx();

      tx.select
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: true }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { id: 1, pharmacyId: 1, quantity: 3, yakkaUnitPrice: '1000', isAvailable: true },
          { id: 2, pharmacyId: 2, quantity: 10, yakkaUnitPrice: '1000', isAvailable: true },
        ]))
        // no reservations
        .mockImplementationOnce(() => createGroupByQuery([]));

      tx.execute.mockResolvedValue(undefined);
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const candidate = {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 10 }], // quantity > available 3
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };

      await expect(createProposal(1, candidate)).rejects.toThrow('提案数量が利用可能在庫数を超えています');
    });

    it('throws when stock in itemsFromA has invalid unit price (zero)', async () => {
      const tx = setupTx();

      tx.select
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: true }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { id: 1, pharmacyId: 1, quantity: 10, yakkaUnitPrice: '0', isAvailable: true },
          { id: 2, pharmacyId: 2, quantity: 10, yakkaUnitPrice: '1000', isAvailable: true },
        ]))
        .mockImplementationOnce(() => createGroupByQuery([]));

      tx.execute.mockResolvedValue(undefined);
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const candidate = {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };

      await expect(createProposal(1, candidate)).rejects.toThrow('薬価が設定されていない在庫は提案できません');
    });

    it('throws when stock in itemsFromB does not belong to pharmacyB', async () => {
      const tx = setupTx();

      tx.select
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: true }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { id: 1, pharmacyId: 1, quantity: 10, yakkaUnitPrice: '1000', isAvailable: true },
          { id: 2, pharmacyId: 99, quantity: 10, yakkaUnitPrice: '1000', isAvailable: true }, // wrong pharmacy
        ]))
        .mockImplementationOnce(() => createGroupByQuery([]));

      tx.execute.mockResolvedValue(undefined);
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const candidate = {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };

      await expect(createProposal(1, candidate)).rejects.toThrow('交換先薬局の在庫のみ指定できます');
    });

    it('throws when value difference exceeds tolerance', async () => {
      const tx = setupTx();

      // A: 1 unit at price 10000 = 10000
      // B: 1 unit at price 10500 = 10500 => diff = 500 > VALUE_TOLERANCE(10)
      tx.select
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: true }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { id: 1, pharmacyId: 1, quantity: 10, yakkaUnitPrice: '10000', isAvailable: true },
          { id: 2, pharmacyId: 2, quantity: 10, yakkaUnitPrice: '10500', isAvailable: true },
        ]))
        .mockImplementationOnce(() => createGroupByQuery([]));

      tx.execute.mockResolvedValue(undefined);
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const candidate = {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };

      await expect(createProposal(1, candidate)).rejects.toThrow('交換金額差が許容範囲を超えています');
    });

    it('successfully creates proposal and returns proposal ID', async () => {
      const tx = setupTx();

      // A: 1 unit at 10000, B: 1 unit at 10000 => diff = 0, min = 10000 >= MIN_EXCHANGE_VALUE
      tx.select
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: true }]))
        .mockImplementationOnce(() => createSelectQuery([])) // no blocked
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { id: 1, pharmacyId: 1, quantity: 10, yakkaUnitPrice: '10000', isAvailable: true },
          { id: 2, pharmacyId: 2, quantity: 10, yakkaUnitPrice: '10000', isAvailable: true },
        ]))
        .mockImplementationOnce(() => createGroupByQuery([])); // no reservations

      tx.execute.mockResolvedValue(undefined);

      // Insert proposal
      tx.insert
        .mockReturnValueOnce(createInsertReturningQuery([{ id: 42 }]))
        // Insert proposal items
        .mockReturnValueOnce(createInsertQuery())
        // Insert deadStockReservations
        .mockReturnValueOnce(createInsertQuery());

      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const proposalId = await createProposal(1, {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      });

      expect(proposalId).toBe(42);
      expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        pharmacyId: 2,
        type: 'proposal_received',
      }));
    });

    it('logs warning when notification fails on createProposal', async () => {
      mocks.createNotification.mockResolvedValue(null);
      const tx = setupTx();

      tx.select
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: true }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSimpleSelectQuery([
          { id: 1, pharmacyId: 1, quantity: 10, yakkaUnitPrice: '10000', isAvailable: true },
          { id: 2, pharmacyId: 2, quantity: 10, yakkaUnitPrice: '10000', isAvailable: true },
        ]))
        .mockImplementationOnce(() => createGroupByQuery([]));

      tx.execute.mockResolvedValue(undefined);
      tx.insert
        .mockReturnValueOnce(createInsertReturningQuery([{ id: 55 }]))
        .mockReturnValueOnce(createInsertQuery())
        .mockReturnValueOnce(createInsertQuery());

      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const proposalId = await createProposal(1, {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      });

      expect(proposalId).toBe(55);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Proposal notification could not be persisted',
        expect.any(Object),
      );
    });
  });
});
