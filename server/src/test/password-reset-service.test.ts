import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/auth-service', () => ({
  hashPassword: vi.fn(async () => 'hashed-password'),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  gt: vi.fn((a: unknown, b: unknown) => ({ _gt: [a, b] })),
  lt: vi.fn((a: unknown, b: unknown) => ({ _lt: [a, b] })),
  isNull: vi.fn((arg: unknown) => ({ _isNull: arg })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  })),
}));

import { createPasswordResetToken, resetPasswordWithToken } from '../services/password-reset-service';
import { hashPassword } from '../services/auth-service';
import { sql } from 'drizzle-orm';
import { createSelectLimitChain } from './helpers/mock-builders';
import { setupVitestMocks } from './helpers/setup';

function createTxMock() {
  const { select, selectFrom, selectWhere, selectLimit } = createSelectLimitChain([]);
  const execute = vi.fn();
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const txDelete = vi.fn().mockReturnValue({ where: deleteWhere });
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  return {
    tx: {
      select,
      execute,
      delete: txDelete,
      insert,
    },
    spies: {
      select,
      selectFrom,
      selectWhere,
      selectLimit,
      execute,
      txDelete,
      deleteWhere,
      insert,
      insertValues,
    },
  };
}

function createResetTxMock(candidateRows: Array<{ pharmacyId: number }>, consumedRows: Array<{ pharmacyId: number }>) {
  const { select, selectFrom, selectWhere, selectLimit } = createSelectLimitChain(candidateRows);

  const consumeReturning = vi.fn().mockResolvedValue(consumedRows);
  const consumeWhere = vi.fn().mockReturnValue({ returning: consumeReturning });
  const consumeSet = vi.fn().mockReturnValue({ where: consumeWhere });

  const invalidateWhere = vi.fn().mockResolvedValue(undefined);
  const invalidateSet = vi.fn().mockReturnValue({ where: invalidateWhere });

  const updatePharmacyWhere = vi.fn().mockResolvedValue(undefined);
  const updatePharmacySet = vi.fn().mockReturnValue({ where: updatePharmacyWhere });

  const update = vi.fn()
    .mockReturnValueOnce({ set: consumeSet })
    .mockReturnValueOnce({ set: invalidateSet })
    .mockReturnValueOnce({ set: updatePharmacySet });

  const execute = vi.fn().mockResolvedValue({ rows: [] });

  return {
    tx: {
      select,
      update,
      execute,
    },
    spies: {
      select,
      selectFrom,
      selectWhere,
      selectLimit,
      update,
      execute,
      consumeWhere,
      invalidateWhere,
      updatePharmacyWhere,
    },
  };
}

describe('password-reset-service', () => {
  setupVitestMocks('reset');

  beforeEach(() => {
    vi.mocked(sql).mockClear();
  });

  it('returns null when account does not exist', async () => {
    const { tx, spies } = createTxMock();
    spies.selectLimit.mockResolvedValueOnce([]);
    mocks.db.transaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await createPasswordResetToken('missing@example.com');

    expect(result).toBeNull();
    expect(spies.select).toHaveBeenCalledTimes(1);
    expect(spies.execute).not.toHaveBeenCalled();
    expect(spies.txDelete).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('enforces per-user active token limit inside transaction', async () => {
    const { tx, spies } = createTxMock();
    spies.selectLimit.mockResolvedValueOnce([{ id: 7, name: 'テスト薬局', isActive: true }]);
    spies.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] });
    mocks.db.transaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await createPasswordResetToken('test@example.com');

    expect(result).toBeNull();
    expect(spies.execute).toHaveBeenCalledTimes(2);
    expect(spies.txDelete).toHaveBeenCalledTimes(1);
    expect(spies.insert).not.toHaveBeenCalled();

    expect(spies.txDelete.mock.invocationCallOrder[0]).toBeLessThan(spies.execute.mock.invocationCallOrder[1]);

    const sqlCalls = vi.mocked(sql).mock.calls;
    const lockCall = sqlCalls.find(call => {
      const query = Array.from((call?.[0] as TemplateStringsArray) ?? []).join('');
      return query.includes('pg_advisory_xact_lock');
    });
    expect(lockCall).toBeDefined();

    const countCall = sqlCalls.find(call => {
      const query = Array.from((call?.[0] as TemplateStringsArray) ?? []).join('');
      return query.includes('used_at IS NULL') && query.includes('expires_at >');
    });
    expect(countCall).toBeDefined();
  });

  it('issues token when under cap and returns pharmacy metadata', async () => {
    const { tx, spies } = createTxMock();
    spies.selectLimit.mockResolvedValueOnce([{ id: 10, name: 'デモ薬局A', isActive: true }]);
    spies.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] });
    mocks.db.transaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await createPasswordResetToken('demo-a@example.com');

    expect(result).toEqual({
      token: expect.any(String),
      pharmacyName: 'デモ薬局A',
    });
    expect(result?.token.length).toBe(64);
    expect(spies.insert).toHaveBeenCalledTimes(1);
    expect(spies.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      pharmacyId: 10,
      token: expect.any(String),
    }));
  });

  it('acquires advisory lock before consuming token rows during reset', async () => {
    const { tx, spies } = createResetTxMock([{ pharmacyId: 42 }], [{ pharmacyId: 42 }]);
    mocks.db.transaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await resetPasswordWithToken('token-1', 'new-password');

    expect(result).toEqual({ success: true, pharmacyId: 42 });
    expect(spies.execute).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledTimes(3);
    expect(vi.mocked(hashPassword)).toHaveBeenCalledWith('new-password');

    expect(spies.execute.mock.invocationCallOrder[0]).toBeLessThan(spies.update.mock.invocationCallOrder[0]);
    expect(spies.consumeWhere).toHaveBeenCalledTimes(1);
    expect(spies.invalidateWhere).toHaveBeenCalledTimes(1);
    expect(spies.updatePharmacyWhere).toHaveBeenCalledTimes(1);
  });

  it('returns failure without lock when token is not consumable', async () => {
    const { tx, spies } = createResetTxMock([], []);
    mocks.db.transaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await resetPasswordWithToken('missing-token', 'new-password');

    expect(result).toEqual({ success: false, pharmacyId: 0 });
    expect(spies.execute).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(vi.mocked(hashPassword)).not.toHaveBeenCalled();
  });
});
