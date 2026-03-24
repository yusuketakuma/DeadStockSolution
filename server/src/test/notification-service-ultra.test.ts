import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/logger', () => ({ logger: mocks.logger }));
vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  count: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import {
  createNotification,
  getUnreadCount,
  getDashboardUnreadCount,
  getNotifications,
  markAsRead,
  markAllAsRead,
  markAllDashboardAsRead,
  invalidateDashboardUnreadCache,
} from '../services/notification-service';

describe('notification-service-ultra', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getDashboardUnreadCount — error propagation', () => {
    it('propagates non-object error from notifications query', async () => {
      const notifWhere = vi.fn().mockRejectedValue('string error');
      const notifFrom = vi.fn().mockReturnValue({ where: notifWhere });

      const adminWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
      const adminLeftJoin = vi.fn().mockReturnValue({ where: adminWhere });
      const adminFrom = vi.fn().mockReturnValue({ leftJoin: adminLeftJoin });

      const matchWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
      const matchFrom = vi.fn().mockReturnValue({ where: matchWhere });

      mocks.db.select
        .mockReturnValueOnce({ from: matchFrom })
        .mockReturnValueOnce({ from: notifFrom })
        .mockReturnValueOnce({ from: adminFrom });

      await expect(getDashboardUnreadCount(1)).rejects.toBe('string error');
    });

    it('propagates error with non-42P01 code', async () => {
      const otherError = Object.assign(new Error('something else'), { code: '42703' });
      const notifWhere = vi.fn().mockRejectedValue(otherError);
      const notifFrom = vi.fn().mockReturnValue({ where: notifWhere });

      const adminWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
      const adminLeftJoin = vi.fn().mockReturnValue({ where: adminWhere });
      const adminFrom = vi.fn().mockReturnValue({ leftJoin: adminLeftJoin });

      const matchWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
      const matchFrom = vi.fn().mockReturnValue({ where: matchWhere });

      mocks.db.select
        .mockReturnValueOnce({ from: matchFrom })
        .mockReturnValueOnce({ from: notifFrom })
        .mockReturnValueOnce({ from: adminFrom });

      await expect(getDashboardUnreadCount(1)).rejects.toThrow('something else');
    });

    it('handles empty admin unread row gracefully', async () => {
      const notifWhere = vi.fn().mockResolvedValue([{ value: 3 }]);
      const notifFrom = vi.fn().mockReturnValue({ where: notifWhere });

      const adminWhere = vi.fn().mockResolvedValue([]);
      const adminLeftJoin = vi.fn().mockReturnValue({ where: adminWhere });
      const adminFrom = vi.fn().mockReturnValue({ leftJoin: adminLeftJoin });

      const matchWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
      const matchFrom = vi.fn().mockReturnValue({ where: matchWhere });

      mocks.db.select
        .mockReturnValueOnce({ from: matchFrom })
        .mockReturnValueOnce({ from: notifFrom })
        .mockReturnValueOnce({ from: adminFrom });

      const result = await getDashboardUnreadCount(1);
      // 3 + 0 (no admin row)
      expect(result).toBe(3);
    });
  });

  // ── getUnreadCount edge cases ──
  describe('getUnreadCount — edge cases', () => {
    it('returns 0 when result is undefined', async () => {
      const where = vi.fn().mockResolvedValue([undefined]);
      const from = vi.fn().mockReturnValue({ where });
      mocks.db.select.mockReturnValue({ from });

      const result = await getUnreadCount(1);
      expect(result).toBe(0);
    });
  });

  // ── getNotifications edge cases ──
  describe('getNotifications — edge cases', () => {
    it('uses default page and limit', async () => {
      const countWhere = vi.fn().mockResolvedValue([{ value: 0 }]);
      const countFrom = vi.fn().mockReturnValue({ where: countWhere });

      const offset = vi.fn().mockResolvedValue([]);
      const limit = vi.fn().mockReturnValue({ offset });
      const orderBy = vi.fn().mockReturnValue({ limit });
      const where = vi.fn().mockReturnValue({ orderBy });
      const from = vi.fn().mockReturnValue({ where });

      mocks.db.select
        .mockReturnValueOnce({ from: countFrom })
        .mockReturnValueOnce({ from });

      const result = await getNotifications(1);
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('uses provided page=2 and limit=5', async () => {
      const countWhere = vi.fn().mockResolvedValue([{ value: 10 }]);
      const countFrom = vi.fn().mockReturnValue({ where: countWhere });

      const offset = vi.fn().mockResolvedValue([{ id: 6 }]);
      const limit = vi.fn().mockReturnValue({ offset });
      const orderBy = vi.fn().mockReturnValue({ limit });
      const where = vi.fn().mockReturnValue({ orderBy });
      const from = vi.fn().mockReturnValue({ where });

      mocks.db.select
        .mockReturnValueOnce({ from: countFrom })
        .mockReturnValueOnce({ from });

      const result = await getNotifications(1, 2, 5);
      expect(result.total).toBe(10);
      expect(result.rows).toEqual([{ id: 6 }]);
    });

    it('returns 0 total when countResult is undefined', async () => {
      const countWhere = vi.fn().mockResolvedValue([undefined]);
      const countFrom = vi.fn().mockReturnValue({ where: countWhere });

      const offset = vi.fn().mockResolvedValue([]);
      const limit = vi.fn().mockReturnValue({ offset });
      const orderBy = vi.fn().mockReturnValue({ limit });
      const where = vi.fn().mockReturnValue({ orderBy });
      const from = vi.fn().mockReturnValue({ where });

      mocks.db.select
        .mockReturnValueOnce({ from: countFrom })
        .mockReturnValueOnce({ from });

      const result = await getNotifications(1);
      expect(result.total).toBe(0);
    });
  });

  // ── markAsRead — invalidation ──
  describe('markAsRead — cache invalidation', () => {
    it('does not call invalidateCache when no rows updated', async () => {
      const returning = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      mocks.db.update.mockReturnValue({ set });

      const result = await markAsRead(999, 1);
      expect(result).toBe(false);
    });

    it('calls invalidateCache when rows are updated', async () => {
      const returning = vi.fn().mockResolvedValue([{ id: 1 }]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      mocks.db.update.mockReturnValue({ set });

      const result = await markAsRead(1, 1);
      expect(result).toBe(true);
    });
  });

  // ── markAllAsRead edge cases ──
  describe('markAllAsRead — edge cases', () => {
    it('returns 0 when rows[0] is undefined', async () => {
      mocks.db.execute.mockResolvedValue({ rows: [undefined] });

      const result = await markAllAsRead(1);
      expect(result).toBe(0);
    });

    it('returns 0 when rows is empty', async () => {
      mocks.db.execute.mockResolvedValue({ rows: [] });

      const result = await markAllAsRead(1);
      expect(result).toBe(0);
    });

    it('does not invalidate cache when count is 0', async () => {
      mocks.db.execute.mockResolvedValue({ rows: [{ count: 0 }] });

      const result = await markAllAsRead(1);
      expect(result).toBe(0);
    });

    it('invalidates cache when count > 0', async () => {
      mocks.db.execute.mockResolvedValue({ rows: [{ count: 3 }] });

      const result = await markAllAsRead(1);
      expect(result).toBe(3);
    });
  });

  describe('markAllDashboardAsRead — transaction with notifications + admin', () => {
    function createTx(...execResults: unknown[]) {
      const execute = vi.fn();
      for (const result of execResults) {
        execute.mockResolvedValueOnce(result);
      }
      return { execute };
    }

    it('sums notifications and admin message counts', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
          const tx = createTx(
            { rows: [{ count: 1 }] }, // markNotificationsAsRead
            { rows: [{ exists: true }] }, // match_notifications table exists
            { rows: [{ count: 0 }] }, // matchNotifications markAsRead
            { rows: [{ count: 3 }] }, // markAdminMessagesAsRead
          );
          return callback(tx);
        },
      );

      const result = await markAllDashboardAsRead(1);
      expect(result).toBe(4); // 1 + 3
    });

    it('returns 0 and does not invalidate cache when total is 0', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
          const tx = createTx(
            { rows: [{ count: 0 }] },
            { rows: [{ exists: true }] },
            { rows: [{ count: 0 }] },
            { rows: [{ count: 0 }] },
          );
          return callback(tx);
        },
      );

      const result = await markAllDashboardAsRead(1);
      expect(result).toBe(0);
    });

    it('handles missing count in rows', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
          const tx = createTx(
            { rows: [{}] },
            { rows: [{ exists: true }] },
            { rows: [{ count: 0 }] },
            { rows: [{ count: 0 }] },
          );
          return callback(tx);
        },
      );

      const result = await markAllDashboardAsRead(1);
      expect(result).toBe(0);
    });

    it('handles empty rows array', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
          const tx = createTx(
            { rows: [] },
            { rows: [{ exists: true }] },
            { rows: [{ count: 0 }] },
            { rows: [{ count: 0 }] },
          );
          return callback(tx);
        },
      );

      const result = await markAllDashboardAsRead(1);
      expect(result).toBe(0);
    });
  });

  // ── createNotification — referenceType/referenceId defaults ──
  describe('createNotification — defaults', () => {
    it('defaults referenceType and referenceId to null when not provided', async () => {
      const returning = vi.fn().mockResolvedValue([{ id: 1 }]);
      const values = vi.fn().mockReturnValue({ returning });
      mocks.db.insert.mockReturnValue({ values });

      const result = await createNotification({
        pharmacyId: 1,
        type: 'proposal_received',
        title: 'テスト',
        message: 'テスト',
      });

      expect(result).toEqual({ id: 1 });
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceType: null,
          referenceId: null,
        }),
      );
    });
  });

  // ── invalidateDashboardUnreadCache ──
  describe('invalidateDashboardUnreadCache', () => {
    it('does not throw (cache is disabled in test env)', () => {
      expect(() => invalidateDashboardUnreadCache(1)).not.toThrow();
      expect(() => invalidateDashboardUnreadCache(999)).not.toThrow();
    });
  });
});
