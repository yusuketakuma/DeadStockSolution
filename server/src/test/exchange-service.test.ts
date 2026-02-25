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
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import { completeProposal } from '../services/exchange-service';

function createSelectQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createUpdateReturningQuery(result: unknown) {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.returning.mockResolvedValue(result);
  return query;
}

describe('exchange-service completeProposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

