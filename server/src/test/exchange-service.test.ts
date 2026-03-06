import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSelectQuery, createUpdateReturningQuery } from './helpers/mock-builders';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
  or: vi.fn(() => ({})),
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

import { completeProposal, createProposal } from '../services/exchange-service';

describe('exchange-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects createProposal when requester has blocked the target pharmacy', async () => {
    const tx = {
      select: vi.fn(),
      update: vi.fn(),
      insert: vi.fn(),
      delete: vi.fn(),
      execute: vi.fn(),
    };

    tx.select
      .mockImplementationOnce(() => createSelectQuery([{
        id: 2,
        isActive: true,
      }]))
      .mockImplementationOnce(() => createSelectQuery([{
        id: 10,
      }]));

    mocks.db.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<number>) => callback(tx));

    const candidate = {
      pharmacyId: 2,
      itemsFromA: [{ deadStockItemId: 1, quantity: 1 }],
      itemsFromB: [{ deadStockItemId: 2, quantity: 1 }],
    };

    await expect(createProposal(1, candidate)).rejects.toThrow('ブロック中の薬局には提案できません');
    expect(mocks.or).toHaveBeenCalledTimes(1);
    expect(tx.execute).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('fails safely when confirmed proposal cannot be atomically claimed', async () => {
    const tx = {
      select: vi.fn(),
      update: vi.fn(),
      insert: vi.fn(),
      delete: vi.fn(),
    };

    tx.select.mockImplementationOnce(() => createSelectQuery([{
      pharmacyAId: 1,
      pharmacyBId: 2,
      status: 'confirmed',
      totalValueA: '10000',
      totalValueB: '10000',
    }]));
    tx.update.mockImplementationOnce(() => createUpdateReturningQuery([]));

    mocks.db.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<void>) => callback(tx));

    await expect(completeProposal(100, 1)).rejects.toThrow('状態が変更されたため、操作を完了できません。再読み込みしてください');
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });
});
