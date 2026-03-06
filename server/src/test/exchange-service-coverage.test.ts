import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDeleteQuery,
  createGroupByQuery,
  createInsertQuery,
  createInsertReturningQuery,
  createSelectQuery,
  createUpdateReturningQuery,
} from './helpers/mock-builders';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
  or: vi.fn(() => ({})),
  createNotification: vi.fn().mockResolvedValue(true),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  or: mocks.or,
  sql: vi.fn(() => ({})),
}));

vi.mock('../services/notification-service', () => ({
  createNotification: mocks.createNotification,
}));

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

import {
  createProposal,
  acceptProposal,
  rejectProposal,
  completeProposal,
} from '../services/exchange-service';

describe('exchange-service coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── parseProposalItems validation ──────────────────────

  describe('createProposal input validation', () => {
    function setupTx() {
      return {
        select: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
        execute: vi.fn().mockResolvedValue(undefined),
      };
    }

    it('rejects non-object candidate', async () => {
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(setupTx()));
      await expect(createProposal(1, null)).rejects.toThrow('候補データが不正です');
    });

    it('rejects non-array itemsFromA', async () => {
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(setupTx()));
      const candidate = { pharmacyId: 2, itemsFromA: 'not-array', itemsFromB: [{ deadStockItemId: 1, quantity: 1 }] };
      await expect(createProposal(1, candidate)).rejects.toThrow('itemsFromA が不正です');
    });

    it('rejects empty itemsFromA', async () => {
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(setupTx()));
      const candidate = { pharmacyId: 2, itemsFromA: [], itemsFromB: [{ deadStockItemId: 1, quantity: 1 }] };
      await expect(createProposal(1, candidate)).rejects.toThrow('itemsFromA が不正です');
    });

    it('rejects item with invalid deadStockItemId', async () => {
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(setupTx()));
      const candidate = {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: -1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 1, quantity: 1 }],
      };
      await expect(createProposal(1, candidate)).rejects.toThrow('不正な在庫ID');
    });

    it('rejects item with zero quantity', async () => {
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(setupTx()));
      const candidate = {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 0 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };
      await expect(createProposal(1, candidate)).rejects.toThrow('不正な数量');
    });

    it('rejects duplicate deadStockItemId in items', async () => {
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(setupTx()));
      const candidate = {
        pharmacyId: 2,
        itemsFromA: [
          { deadStockItemId: 1, quantity: 1 },
          { deadStockItemId: 1, quantity: 2 },
        ],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };
      await expect(createProposal(1, candidate)).rejects.toThrow('重複した在庫ID');
    });

    it('rejects same pharmacyId as self', async () => {
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(setupTx()));
      const candidate = {
        pharmacyId: 1, // same as pharmacyAId
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };
      await expect(createProposal(1, candidate)).rejects.toThrow('交換先薬局IDが不正です');
    });

    it('rejects non-object item element', async () => {
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(setupTx()));
      const candidate = {
        pharmacyId: 2,
        itemsFromA: [null],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };
      await expect(createProposal(1, candidate)).rejects.toThrow('不正な要素');
    });

    it('rejects inactive pharmacy B', async () => {
      const tx = setupTx();
      tx.select
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: false }]))
        .mockImplementationOnce(() => createSelectQuery([]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const candidate = {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };

      // No blocked relationship found, but pharmacy is inactive
      await expect(createProposal(1, candidate)).rejects.toThrow('交換先薬局が見つからないか、無効です');
    });

    it('rejects when total value below minimum', async () => {
      const tx = setupTx();
      tx.select
        // pharmacyB
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: true }]))
        // blocked
        .mockImplementationOnce(() => createSelectQuery([]))
        // stock rows
        .mockImplementationOnce(() => {
          const query = {
            from: vi.fn(),
            where: vi.fn(),
          };
          query.from.mockReturnValue(query);
          query.where.mockResolvedValue([
            { id: 1, pharmacyId: 1, quantity: 1, yakkaUnitPrice: '1', isAvailable: true },
            { id: 2, pharmacyId: 2, quantity: 1, yakkaUnitPrice: '1', isAvailable: true },
          ]);
          return query;
        })
        // reservations
        .mockImplementationOnce(() => createGroupByQuery([]));

      tx.execute.mockResolvedValue(undefined);
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const candidate = {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      };

      await expect(createProposal(1, candidate)).rejects.toThrow('交換金額が最低金額に達していません');
    });
  });

  // ── acceptProposal ─────────────────────────────────────

  describe('acceptProposal', () => {
    it('throws when proposal not found', async () => {
      const tx = { select: vi.fn(), update: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(acceptProposal(999, 1)).rejects.toThrow('マッチングが見つかりません');
    });

    it('throws when pharmacy is not party to proposal', async () => {
      const tx = { select: vi.fn(), update: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
      }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(acceptProposal(100, 3)).rejects.toThrow('アクセスする権限がありません');
    });

    it('sets accepted_a when pharmacy A accepts proposed', async () => {
      const tx = { select: vi.fn(), update: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
      }]));
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{ id: 100 }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const newStatus = await acceptProposal(100, 1);
      expect(newStatus).toBe('accepted_a');
    });

    it('sets accepted_b when pharmacy B accepts proposed', async () => {
      const tx = { select: vi.fn(), update: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
      }]));
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{ id: 100 }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const newStatus = await acceptProposal(100, 2);
      expect(newStatus).toBe('accepted_b');
    });

    it('sets confirmed when pharmacy B accepts accepted_a', async () => {
      const tx = { select: vi.fn(), update: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'accepted_a',
      }]));
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{ id: 100 }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const newStatus = await acceptProposal(100, 2);
      expect(newStatus).toBe('confirmed');
    });

    it('sets confirmed when pharmacy A accepts accepted_b', async () => {
      const tx = { select: vi.fn(), update: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'accepted_b',
      }]));
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{ id: 100 }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      const newStatus = await acceptProposal(100, 1);
      expect(newStatus).toBe('confirmed');
    });

    it('throws when same party tries to accept again', async () => {
      const tx = { select: vi.fn(), update: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'accepted_a',
      }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      // Pharmacy A tries to accept when already accepted_a
      await expect(acceptProposal(100, 1)).rejects.toThrow('承認できる状態ではありません');
    });

    it('throws on optimistic lock failure', async () => {
      const tx = { select: vi.fn(), update: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
      }]));
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(acceptProposal(100, 1)).rejects.toThrow('状態が変更されたため');
    });

    it('sends notification on successful accept', async () => {
      const tx = { select: vi.fn(), update: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
      }]));
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{ id: 100 }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await acceptProposal(100, 1);
      expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        pharmacyId: 2,
        type: 'proposal_status_changed',
      }));
    });
  });

  // ── rejectProposal ────────────────────────────────────

  describe('rejectProposal', () => {
    it('throws when proposal not found', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), delete: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(rejectProposal(999, 1)).rejects.toThrow('マッチングが見つかりません');
    });

    it('throws when pharmacy is not party to proposal', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), delete: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
      }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(rejectProposal(100, 3)).rejects.toThrow('アクセスする権限がありません');
    });

    it('throws for non-rejectable status', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), delete: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'completed',
      }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(rejectProposal(100, 1)).rejects.toThrow('拒否できる状態ではありません');
    });

    it('successfully rejects a proposed proposal', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), delete: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
      }]));
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{ id: 100 }]));
      tx.delete.mockImplementationOnce(() => createDeleteQuery());
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(rejectProposal(100, 1)).resolves.toBeUndefined();
      expect(tx.delete).toHaveBeenCalled();
    });

    it('throws on optimistic lock failure during reject', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), delete: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
      }]));
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(rejectProposal(100, 1)).rejects.toThrow('状態が変更されたため');
    });

    it('sends notification on successful reject', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), delete: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'accepted_a',
      }]));
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{ id: 100 }]));
      tx.delete.mockImplementationOnce(() => createDeleteQuery());
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await rejectProposal(100, 2);
      expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        pharmacyId: 1, // other party
        type: 'proposal_status_changed',
      }));
    });

    it('logs warning when notification fails', async () => {
      mocks.createNotification.mockResolvedValueOnce(null);
      const tx = { select: vi.fn(), update: vi.fn(), delete: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'proposed',
      }]));
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{ id: 100 }]));
      tx.delete.mockImplementationOnce(() => createDeleteQuery());
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await rejectProposal(100, 1);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Proposal notification could not be persisted',
        expect.any(Object),
      );
    });
  });

  // ── completeProposal ──────────────────────────────────

  describe('completeProposal', () => {
    it('throws when proposal not found', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(completeProposal(999, 1)).rejects.toThrow('マッチングが見つかりません');
    });

    it('throws when proposal status is not confirmed', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1, pharmacyBId: 2, status: 'proposed', totalValueA: '10000', totalValueB: '10000',
      }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(completeProposal(100, 1)).rejects.toThrow('まだ確定されていません');
    });

    it('throws when pharmacy is not party to proposal', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
      tx.select.mockImplementationOnce(() => createSelectQuery([{
        pharmacyAId: 1, pharmacyBId: 2, status: 'confirmed', totalValueA: '10000', totalValueB: '10000',
      }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(completeProposal(100, 3)).rejects.toThrow('アクセスする権限がありません');
    });

    it('throws when proposal items are empty', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
      tx.select
        // proposal
        .mockImplementationOnce(() => createSelectQuery([{
          pharmacyAId: 1, pharmacyBId: 2, status: 'confirmed', totalValueA: '10000', totalValueB: '10000',
        }]))
        // proposal items - empty
        .mockImplementationOnce(() => {
          const q = { from: vi.fn(), where: vi.fn() };
          q.from.mockReturnValue(q);
          q.where.mockResolvedValue([]);
          return q;
        });
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{
        pharmacyAId: 1, pharmacyBId: 2, totalValueA: '10000', totalValueB: '10000',
      }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(completeProposal(100, 1)).rejects.toThrow('提案アイテムが存在しません');
    });

    it('throws when stock is unavailable during completion', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
      tx.select
        // proposal
        .mockImplementationOnce(() => createSelectQuery([{
          pharmacyAId: 1, pharmacyBId: 2, status: 'confirmed', totalValueA: '10000', totalValueB: '10000',
        }]))
        // proposal items
        .mockImplementationOnce(() => {
          const q = { from: vi.fn(), where: vi.fn() };
          q.from.mockReturnValue(q);
          q.where.mockResolvedValue([
            { deadStockItemId: 11, fromPharmacyId: 1, quantity: 5 },
          ]);
          return q;
        })
        // stock rows
        .mockImplementationOnce(() => {
          const q = { from: vi.fn(), where: vi.fn() };
          q.from.mockReturnValue(q);
          q.where.mockResolvedValue([
            { id: 11, pharmacyId: 1, quantity: 10, isAvailable: false }, // not available
          ]);
          return q;
        });
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{
        pharmacyAId: 1, pharmacyBId: 2, totalValueA: '10000', totalValueB: '10000',
      }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(completeProposal(100, 1)).rejects.toThrow('在庫状態が変更されているため');
    });

    it('throws when stock quantity is insufficient', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
      tx.select
        .mockImplementationOnce(() => createSelectQuery([{
          pharmacyAId: 1, pharmacyBId: 2, status: 'confirmed', totalValueA: '10000', totalValueB: '10000',
        }]))
        .mockImplementationOnce(() => {
          const q = { from: vi.fn(), where: vi.fn() };
          q.from.mockReturnValue(q);
          q.where.mockResolvedValue([
            { deadStockItemId: 11, fromPharmacyId: 1, quantity: 100 }, // requesting 100
          ]);
          return q;
        })
        .mockImplementationOnce(() => {
          const q = { from: vi.fn(), where: vi.fn() };
          q.from.mockReturnValue(q);
          q.where.mockResolvedValue([
            { id: 11, pharmacyId: 1, quantity: 5, isAvailable: true }, // only 5 available
          ]);
          return q;
        });
      tx.update.mockImplementationOnce(() => createUpdateReturningQuery([{
        pharmacyAId: 1, pharmacyBId: 2, totalValueA: '10000', totalValueB: '10000',
      }]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(completeProposal(100, 1)).rejects.toThrow('在庫数量が不足している');
    });

    it('throws when stock update returns empty (concurrent modification)', async () => {
      const tx = { select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
      tx.select
        .mockImplementationOnce(() => createSelectQuery([{
          pharmacyAId: 1, pharmacyBId: 2, status: 'confirmed', totalValueA: '10000', totalValueB: '10000',
        }]))
        .mockImplementationOnce(() => {
          const q = { from: vi.fn(), where: vi.fn() };
          q.from.mockReturnValue(q);
          q.where.mockResolvedValue([
            { deadStockItemId: 11, fromPharmacyId: 1, quantity: 5 },
          ]);
          return q;
        })
        .mockImplementationOnce(() => {
          const q = { from: vi.fn(), where: vi.fn() };
          q.from.mockReturnValue(q);
          q.where.mockResolvedValue([
            { id: 11, pharmacyId: 1, quantity: 10, isAvailable: true },
          ]);
          return q;
        });
      // First update: claim proposal
      tx.update
        .mockImplementationOnce(() => createUpdateReturningQuery([{
          pharmacyAId: 1, pharmacyBId: 2, totalValueA: '10000', totalValueB: '10000',
        }]))
        // Second update: stock update - fails (concurrent modification)
        .mockImplementationOnce(() => createUpdateReturningQuery([]));
      mocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown | Promise<unknown>) => cb(tx));

      await expect(completeProposal(100, 1)).rejects.toThrow('在庫状態が変更されているため');
    });
  });
});
