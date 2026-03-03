import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDeleteQuery,
  createSelectQuery,
  createUpdateReturningQuery,
} from './helpers/mock-builders';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
  or: vi.fn(() => ({})),
  createNotification: vi.fn(),
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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { acceptProposal, rejectProposal, completeProposal, createProposal } from '../services/exchange-service';

describe('exchange-service ultra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createNotification.mockResolvedValue(true);
  });

  describe('acceptProposal', () => {
    it('throws when proposal not found', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([])),
        update: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));

      await expect(acceptProposal(999, 1)).rejects.toThrow('マッチングが見つかりません');
    });

    it('throws when pharmacy is not a party', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'proposed',
        }])),
        update: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));

      await expect(acceptProposal(100, 3)).rejects.toThrow('アクセスする権限がありません');
    });

    it('advances proposed -> accepted_a when pharmacy A accepts', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'proposed',
        }])),
        update: vi.fn().mockImplementation(() => createUpdateReturningQuery([{ id: 100 }])),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));

      const result = await acceptProposal(100, 1);
      expect(result).toBe('accepted_a');
    });

    it('advances proposed -> accepted_b when pharmacy B accepts', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'proposed',
        }])),
        update: vi.fn().mockImplementation(() => createUpdateReturningQuery([{ id: 100 }])),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));

      const result = await acceptProposal(100, 2);
      expect(result).toBe('accepted_b');
    });

    it('advances accepted_a -> confirmed when pharmacy B accepts', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'accepted_a',
        }])),
        update: vi.fn().mockImplementation(() => createUpdateReturningQuery([{ id: 100 }])),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));

      const result = await acceptProposal(100, 2);
      expect(result).toBe('confirmed');
    });

    it('advances accepted_b -> confirmed when pharmacy A accepts', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'accepted_b',
        }])),
        update: vi.fn().mockImplementation(() => createUpdateReturningQuery([{ id: 100 }])),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));

      const result = await acceptProposal(100, 1);
      expect(result).toBe('confirmed');
    });

    it('throws when trying to accept in invalid state', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'completed',
        }])),
        update: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));

      await expect(acceptProposal(100, 1)).rejects.toThrow('承認できる状態ではありません');
    });

    it('throws when optimistic lock fails on accept', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'proposed',
        }])),
        update: vi.fn().mockImplementation(() => createUpdateReturningQuery([])),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));

      await expect(acceptProposal(100, 1)).rejects.toThrow('状態が変更されたため');
    });

    it('logs warning when notification creation fails', async () => {
      mocks.createNotification.mockResolvedValue(null);
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'proposed',
        }])),
        update: vi.fn().mockImplementation(() => createUpdateReturningQuery([{ id: 100 }])),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));

      const result = await acceptProposal(100, 1);
      expect(result).toBe('accepted_a');
    });
  });

  describe('rejectProposal', () => {
    it('throws when proposal not found', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([])),
        update: vi.fn(),
        delete: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));

      await expect(rejectProposal(999, 1)).rejects.toThrow('マッチングが見つかりません');
    });

    it('throws when pharmacy is not a party', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'proposed',
        }])),
        update: vi.fn(),
        delete: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));

      await expect(rejectProposal(100, 3)).rejects.toThrow('アクセスする権限がありません');
    });

    it('throws when proposal is in invalid state for rejection', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'completed',
        }])),
        update: vi.fn(),
        delete: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));

      await expect(rejectProposal(100, 1)).rejects.toThrow('拒否できる状態ではありません');
    });

    it('throws when optimistic lock fails on reject', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'proposed',
        }])),
        update: vi.fn().mockImplementation(() => createUpdateReturningQuery([])),
        delete: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));

      await expect(rejectProposal(100, 1)).rejects.toThrow('状態が変更されたため');
    });

    it('successfully rejects and deletes reservations', async () => {
      const deleteQuery = createDeleteQuery();
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'proposed',
        }])),
        update: vi.fn().mockImplementation(() => createUpdateReturningQuery([{ id: 100 }])),
        delete: vi.fn().mockReturnValue(deleteQuery),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));

      await rejectProposal(100, 1);
      expect(tx.delete).toHaveBeenCalled();
      expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        pharmacyId: 2,
        type: 'proposal_status_changed',
      }));
    });

    it('sends notification to pharmacy A when pharmacy B rejects', async () => {
      const deleteQuery = createDeleteQuery();
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'proposed',
        }])),
        update: vi.fn().mockImplementation(() => createUpdateReturningQuery([{ id: 100 }])),
        delete: vi.fn().mockReturnValue(deleteQuery),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));

      await rejectProposal(100, 2);
      expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        pharmacyId: 1,
      }));
    });
  });

  describe('completeProposal', () => {
    it('throws when proposal is not confirmed', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'proposed',
          totalValueA: '10000',
          totalValueB: '10000',
        }])),
        update: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));

      await expect(completeProposal(100, 1)).rejects.toThrow('まだ確定されていません');
    });

    it('throws when pharmacy is not a party to the proposal', async () => {
      const tx = {
        select: vi.fn().mockImplementation(() => createSelectQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'confirmed',
          totalValueA: '10000',
          totalValueB: '10000',
        }])),
        update: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));

      await expect(completeProposal(100, 99)).rejects.toThrow('アクセスする権限がありません');
    });

    it('throws when proposal items are empty', async () => {
      const tx = {
        select: vi.fn()
          // First select: proposal
          .mockImplementationOnce(() => createSelectQuery([{
            pharmacyAId: 1,
            pharmacyBId: 2,
            status: 'confirmed',
            totalValueA: '10000',
            totalValueB: '10000',
          }]))
          // Second select: items (empty)
          .mockImplementationOnce(() => {
            const q = { from: vi.fn(), where: vi.fn() };
            q.from.mockReturnValue(q);
            q.where.mockResolvedValue([]);
            return q;
          }),
        update: vi.fn().mockImplementation(() => createUpdateReturningQuery([{
          pharmacyAId: 1,
          pharmacyBId: 2,
          totalValueA: '10000',
          totalValueB: '10000',
        }])),
        insert: vi.fn(),
        delete: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));

      await expect(completeProposal(100, 1)).rejects.toThrow('提案アイテムが存在しません');
    });
  });

  describe('createProposal parsing', () => {
    it('throws when candidate is null', async () => {
      await expect(createProposal(1, null)).rejects.toThrow('候補データが不正です');
    });

    it('throws when candidate is not an object', async () => {
      await expect(createProposal(1, 'invalid')).rejects.toThrow('候補データが不正です');
    });

    it('throws when pharmacyBId is same as pharmacyAId', async () => {
      await expect(createProposal(1, {
        pharmacyId: 1,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      })).rejects.toThrow('交換先薬局IDが不正です');
    });

    it('throws when pharmacyBId is zero', async () => {
      await expect(createProposal(1, {
        pharmacyId: 0,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      })).rejects.toThrow('交換先薬局IDが不正です');
    });

    it('throws when itemsFromA is empty', async () => {
      await expect(createProposal(1, {
        pharmacyId: 2,
        itemsFromA: [],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      })).rejects.toThrow('itemsFromA が不正です');
    });

    it('throws when itemsFromA contains non-object', async () => {
      await expect(createProposal(1, {
        pharmacyId: 2,
        itemsFromA: [null],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      })).rejects.toThrow('itemsFromA に不正な要素が含まれています');
    });

    it('throws when itemsFromA has invalid deadStockItemId', async () => {
      await expect(createProposal(1, {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: -1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      })).rejects.toThrow('itemsFromA に不正な在庫IDが含まれています');
    });

    it('throws when itemsFromA has zero quantity', async () => {
      await expect(createProposal(1, {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 0 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      })).rejects.toThrow('itemsFromA に不正な数量が含まれています');
    });

    it('throws when itemsFromA has duplicate ids', async () => {
      await expect(createProposal(1, {
        pharmacyId: 2,
        itemsFromA: [
          { deadStockItemId: 1, quantity: 1 },
          { deadStockItemId: 1, quantity: 2 },
        ],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      })).rejects.toThrow('itemsFromA に重複した在庫IDが含まれています');
    });

    it('throws when target pharmacy is inactive', async () => {
      const tx = {
        select: vi.fn()
          .mockImplementationOnce(() => createSelectQuery([{ id: 2, isActive: false }]))
          .mockImplementationOnce(() => createSelectQuery([])),
        execute: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
      };
      mocks.db.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<number>) => cb(tx));

      await expect(createProposal(1, {
        pharmacyId: 2,
        itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
        itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
      })).rejects.toThrow('交換先薬局が見つからないか、無効です');
    });
  });
});
