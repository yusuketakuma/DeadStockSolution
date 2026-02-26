import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  desc: vi.fn((col: unknown) => ({ _desc: col })),
  count: vi.fn(() => ({ _count: true })),
  sql: vi.fn(() => ({})),
}));

import {
  createNotification,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from '../services/notification-service';

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
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockResolvedValue(result);
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

describe('notification-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      const chain = createUpdateChain([{ id: 1 }, { id: 2 }]);
      mocks.db.update.mockReturnValue(chain);

      const result = await markAllAsRead(10);

      expect(result).toBe(2);
    });
  });
});
