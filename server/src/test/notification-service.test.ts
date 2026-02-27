import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  or: vi.fn((...args: unknown[]) => ({ _or: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  isNull: vi.fn((arg: unknown) => ({ _isNull: arg })),
  desc: vi.fn((col: unknown) => ({ _desc: col })),
  count: vi.fn(() => ({ _count: true })),
  sql: vi.fn(() => ({})),
}));

import {
  createNotification,
  getDashboardUnreadCount,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  markAllDashboardAsRead,
} from '../services/notification-service';
import { sql } from 'drizzle-orm';

function createInsertChain(result: unknown) {
  const chain = {
    values: vi.fn(),
    returning: vi.fn(),
  };
  chain.values.mockReturnValue(chain);
  chain.returning.mockResolvedValue(result);
  return chain;
}

function createSelectChain(result: unknown) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    orderBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);
  chain.orderBy.mockResolvedValue(result);
  return chain;
}

// count() クエリ用（where で終わるチェーン）
function createSelectCountChain(result: unknown) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    leftJoin: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockResolvedValue(result);
  return chain;
}

function createSelectCountRejectChain(error: unknown) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    leftJoin: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockRejectedValue(error);
  return chain;
}

function createUpdateChain(result: unknown) {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.returning.mockResolvedValue(result);
  return chain;
}

function createUpdateWithoutReturningChain() {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockResolvedValue(undefined);
  return chain;
}

function createExecuteResult(rows: unknown[]) {
  return { rows };
}

function createTxWithExecuteRows(...rowsList: unknown[][]) {
  const execute = vi.fn();
  for (const rows of rowsList) {
    execute.mockResolvedValueOnce(createExecuteResult(rows));
  }
  return { execute };
}

describe('notification-service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('createNotification', () => {
    it('inserts a notification record', async () => {
      const chain = createInsertChain([{ id: 1 }]);
      mocks.db.insert.mockReturnValue(chain);

      const result = await createNotification({
        pharmacyId: 10,
        type: 'proposal_received',
        title: 'テスト通知',
        message: '提案が届きました',
        referenceType: 'proposal',
        referenceId: 42,
      });

      expect(mocks.db.insert).toHaveBeenCalledTimes(1);
      expect(chain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          pharmacyId: 10,
          type: 'proposal_received',
          title: 'テスト通知',
        }),
      );
      expect(result).toEqual({ id: 1 });
    });

    it('does not throw on failure (best effort)', async () => {
      const chain = createInsertChain([]);
      chain.returning.mockRejectedValue(new Error('DB error'));
      mocks.db.insert.mockReturnValue(chain);

      const result = await createNotification({
        pharmacyId: 10,
        type: 'proposal_received',
        title: 'テスト',
        message: 'テスト',
      });

      expect(result).toBeNull();
    });
  });

  describe('getUnreadCount', () => {
    it('returns the unread count for a pharmacy', async () => {
      const chain = createSelectCountChain([{ value: 5 }]);
      mocks.db.select.mockReturnValue(chain);

      const result = await getUnreadCount(10);

      expect(result).toBe(5);
    });
  });

  describe('markAsRead', () => {
    it('marks a single notification as read', async () => {
      const chain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValue(chain);

      const result = await markAsRead(1, 10);

      expect(result).toBe(true);
      expect(chain.set).toHaveBeenCalledWith(
        expect.objectContaining({ isRead: true }),
      );
    });

    it('returns false when no rows updated', async () => {
      const chain = createUpdateChain([]);
      mocks.db.update.mockReturnValue(chain);

      const result = await markAsRead(999, 10);

      expect(result).toBe(false);
    });
  });

  describe('markAllAsRead', () => {
    it('marks all unread notifications as read', async () => {
      mocks.db.execute.mockResolvedValue(createExecuteResult([{ count: 2 }]));

      const result = await markAllAsRead(10);

      expect(result).toBe(2);
      expect(mocks.db.execute).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when no unread rows are updated', async () => {
      mocks.db.execute.mockResolvedValue(createExecuteResult([{ count: 0 }]));

      const result = await markAllAsRead(10);

      expect(result).toBe(0);
      expect(mocks.db.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDashboardUnreadCount', () => {
    it('aggregates unread counts across notification sources', async () => {
      mocks.db.select
        .mockImplementationOnce(() => createSelectCountChain([{ count: 1 }]))
        .mockImplementationOnce(() => createSelectCountChain([{ value: 5 }]))
        .mockImplementationOnce(() => createSelectCountChain([{ count: 2 }]));

      const result = await getDashboardUnreadCount(10);

      expect(result).toBe(8);
      expect(mocks.db.select).toHaveBeenCalledTimes(3);
    });

    it('falls back to 0 when match_notifications table is missing', async () => {
      const missingTableError = Object.assign(new Error('relation "match_notifications" does not exist'), {
        code: '42P01',
      });

      mocks.db.select
        .mockImplementationOnce(() => createSelectCountRejectChain(missingTableError))
        .mockImplementationOnce(() => createSelectCountChain([{ value: 4 }]))
        .mockImplementationOnce(() => createSelectCountChain([{ count: 3 }]));

      const result = await getDashboardUnreadCount(10);

      expect(result).toBe(7);
      expect(mocks.db.select).toHaveBeenCalledTimes(3);
    });
  });

  describe('markAllDashboardAsRead', () => {
    it('updates all notification buckets in a single transaction', async () => {
      const tx = createTxWithExecuteRows(
        [{ count: 2 }],
        [{ exists: true }],
        [{ count: 1 }],
        [{ count: 3 }],
      );
      mocks.db.transaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<number>) => callback(tx));

      const result = await markAllDashboardAsRead(10);

      expect(result).toBe(6);
      expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
      expect(tx.execute).toHaveBeenCalledTimes(4);

      const sqlMock = vi.mocked(sql);
      const adminInsertTemplate = sqlMock.mock.calls[3]?.[0];
      const adminInsertQuery = Array.from(adminInsertTemplate as TemplateStringsArray).join('');
      expect(adminInsertQuery).toContain('ON CONFLICT (message_id, pharmacy_id) DO NOTHING');
    });

    it('skips match notification update when table is missing', async () => {
      const tx = createTxWithExecuteRows(
        [{ count: 2 }],
        [{ exists: false }],
        [{ count: 3 }],
      );
      mocks.db.transaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<number>) => callback(tx));

      const result = await markAllDashboardAsRead(10);

      expect(result).toBe(5);
      expect(tx.execute).toHaveBeenCalledTimes(3);

      const sqlMock = vi.mocked(sql);
      const existsTemplate = sqlMock.mock.calls[1]?.[0];
      const existsQuery = Array.from(existsTemplate as TemplateStringsArray).join('');
      expect(existsQuery).toContain("to_regclass('public.match_notifications')");
    });

    it('propagates transaction errors', async () => {
      const tx = createTxWithExecuteRows([{ count: 1 }], [{ count: 1 }]);
      tx.execute.mockRejectedValueOnce(new Error('db failed'));
      mocks.db.transaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<number>) => callback(tx));

      await expect(markAllDashboardAsRead(10)).rejects.toThrow('db failed');
    });
  });
});
