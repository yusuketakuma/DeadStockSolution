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

describe('notification-service-deep', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── createNotification ──

  describe('createNotification', () => {
    it('creates a notification and returns its id', async () => {
      const returning = vi.fn().mockResolvedValue([{ id: 42 }]);
      const values = vi.fn().mockReturnValue({ returning });
      mocks.db.insert.mockReturnValue({ values });

      const result = await createNotification({
        pharmacyId: 1,
        type: 'proposal_received',
        title: 'テスト通知',
        message: 'マッチングが見つかりました',
      });

      expect(result).toEqual({ id: 42 });
    });

    it('creates notification with referenceType and referenceId', async () => {
      const returning = vi.fn().mockResolvedValue([{ id: 43 }]);
      const values = vi.fn().mockReturnValue({ returning });
      mocks.db.insert.mockReturnValue({ values });

      const result = await createNotification({
        pharmacyId: 2,
        type: 'proposal_status_changed',
        title: '提案通知',
        message: '新しい提案があります',
        referenceType: 'proposal',
        referenceId: 10,
      });

      expect(result).toEqual({ id: 43 });
    });

    it('returns null when insert returns empty array', async () => {
      const returning = vi.fn().mockResolvedValue([]);
      const values = vi.fn().mockReturnValue({ returning });
      mocks.db.insert.mockReturnValue({ values });

      const result = await createNotification({
        pharmacyId: 1,
        type: 'new_comment',
        title: 'テスト',
        message: 'テスト',
      });

      expect(result).toBeNull();
    });

    it('returns null and logs error when insert throws', async () => {
      const values = vi.fn().mockReturnValue({
        returning: vi.fn().mockRejectedValue(new Error('insert failed')),
      });
      mocks.db.insert.mockReturnValue({ values });

      const result = await createNotification({
        pharmacyId: 1,
        type: 'new_comment',
        title: 'テスト',
        message: 'テスト',
      });

      expect(result).toBeNull();
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Failed to create notification',
        expect.objectContaining({ error: 'insert failed' }),
      );
    });
  });

  // ── getUnreadCount ──

  describe('getUnreadCount', () => {
    it('returns unread count', async () => {
      const where = vi.fn().mockResolvedValue([{ value: 5 }]);
      const from = vi.fn().mockReturnValue({ where });
      mocks.db.select.mockReturnValue({ from });

      const result = await getUnreadCount(1);

      expect(result).toBe(5);
    });

    it('returns 0 when no result', async () => {
      const where = vi.fn().mockResolvedValue([]);
      const from = vi.fn().mockReturnValue({ where });
      mocks.db.select.mockReturnValue({ from });

      const result = await getUnreadCount(1);

      expect(result).toBe(0);
    });
  });

  // ── getDashboardUnreadCount ──

  describe('getDashboardUnreadCount', () => {
    function setupDashboardMocks(
      notifCount: number,
      adminCount: number,
      matchResult: { count: number } | Error,
    ) {
      // The function call order is:
      // 1. matchUnreadPromise = db.select(...).from(matchNotifications).where(...) -- created BEFORE Promise.all
      // 2. getUnreadCount -> db.select({ value: count() }).from(notifications).where(...)
      // 3. db.select({ count: rowCount }).from(adminMessages).leftJoin(...).where(...)

      let matchFrom: ReturnType<typeof vi.fn>;
      if (matchResult instanceof Error) {
        const matchWhere = vi.fn().mockRejectedValue(matchResult);
        matchFrom = vi.fn().mockReturnValue({ where: matchWhere });
      } else {
        const matchWhere = vi.fn().mockResolvedValue([matchResult]);
        matchFrom = vi.fn().mockReturnValue({ where: matchWhere });
      }

      const notifWhere = vi.fn().mockResolvedValue([{ value: notifCount }]);
      const notifFrom = vi.fn().mockReturnValue({ where: notifWhere });

      const adminWhere = vi.fn().mockResolvedValue([{ count: adminCount }]);
      const adminLeftJoin = vi.fn().mockReturnValue({ where: adminWhere });
      const adminFrom = vi.fn().mockReturnValue({ leftJoin: adminLeftJoin });

      mocks.db.select
        .mockReturnValueOnce({ from: matchFrom })    // 1st: matchUnreadPromise
        .mockReturnValueOnce({ from: notifFrom })     // 2nd: getUnreadCount
        .mockReturnValueOnce({ from: adminFrom });     // 3rd: admin messages
    }

    it('aggregates notifications, admin messages, and match notifications', async () => {
      setupDashboardMocks(3, 2, { count: 1 });

      const result = await getDashboardUnreadCount(1);

      expect(result).toBe(6);
    });

    it('returns 0 for match_notifications when table does not exist (42P01)', async () => {
      const tableError = Object.assign(new Error('table not found'), { code: '42P01' });
      setupDashboardMocks(2, 0, tableError);

      const result = await getDashboardUnreadCount(1);

      expect(result).toBe(2);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('match_notifications'),
        expect.any(Object),
      );
    });

    it('propagates non-42P01 errors from match_notifications', async () => {
      const connError = new Error('connection error');
      setupDashboardMocks(0, 0, connError);

      await expect(getDashboardUnreadCount(1)).rejects.toThrow('connection error');
    });
  });

  // ── getNotifications ──

  describe('getNotifications', () => {
    it('returns paginated notifications with total count', async () => {
      const notifications = [
        { id: 1, pharmacyId: 1, type: 'proposal_received', title: 'Test', message: 'msg', isRead: false, readAt: null, createdAt: '2026-01-01' },
      ];

      // Count query
      const countWhere = vi.fn().mockResolvedValue([{ value: 1 }]);
      const countFrom = vi.fn().mockReturnValue({ where: countWhere });

      // Rows query
      const offset = vi.fn().mockResolvedValue(notifications);
      const limit = vi.fn().mockReturnValue({ offset });
      const orderBy = vi.fn().mockReturnValue({ limit });
      const where = vi.fn().mockReturnValue({ orderBy });
      const from = vi.fn().mockReturnValue({ where });

      mocks.db.select
        .mockReturnValueOnce({ from: countFrom })
        .mockReturnValueOnce({ from });

      const result = await getNotifications(1, 1, 20);

      expect(result.rows).toEqual(notifications);
      expect(result.total).toBe(1);
    });

    it('returns empty rows when no notifications', async () => {
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
  });

  // ── markAsRead ──

  describe('markAsRead', () => {
    it('returns true when notification is updated', async () => {
      const returning = vi.fn().mockResolvedValue([{ id: 1 }]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      mocks.db.update.mockReturnValue({ set });

      const result = await markAsRead(1, 1);

      expect(result).toBe(true);
    });

    it('returns false when notification is not found', async () => {
      const returning = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      mocks.db.update.mockReturnValue({ set });

      const result = await markAsRead(999, 1);

      expect(result).toBe(false);
    });
  });

  // ── markAllAsRead ──

  describe('markAllAsRead', () => {
    it('returns count of updated notifications', async () => {
      mocks.db.execute.mockResolvedValue({
        rows: [{ count: 5 }],
      });

      const result = await markAllAsRead(1);

      expect(result).toBe(5);
    });

    it('returns 0 when no unread notifications', async () => {
      mocks.db.execute.mockResolvedValue({
        rows: [{ count: 0 }],
      });

      const result = await markAllAsRead(1);

      expect(result).toBe(0);
    });
  });

  // ── markAllDashboardAsRead ──

  describe('markAllDashboardAsRead', () => {
    it('marks all dashboard notifications as read across tables', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: typeof mocks.db.execute }) => Promise<unknown>) => {
          const txExecute = vi.fn()
            // markNotificationsAsRead
            .mockResolvedValueOnce({ rows: [{ count: 3 }] })
            // check match_notifications table exists
            .mockResolvedValueOnce({ rows: [{ exists: true }] })
            // update match_notifications
            .mockResolvedValueOnce({ rows: [{ count: 2 }] })
            // insert admin_message_reads
            .mockResolvedValueOnce({ rows: [{ count: 1 }] });

          return callback({ execute: txExecute });
        },
      );

      const result = await markAllDashboardAsRead(1);

      expect(result).toBe(6); // 3 + 2 + 1
    });

    it('skips match_notifications update when table does not exist', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: typeof mocks.db.execute }) => Promise<unknown>) => {
          const txExecute = vi.fn()
            .mockResolvedValueOnce({ rows: [{ count: 2 }] })   // notifications
            .mockResolvedValueOnce({ rows: [{ exists: false }] }) // table check
            .mockResolvedValueOnce({ rows: [{ count: 0 }] });   // admin reads

          return callback({ execute: txExecute });
        },
      );

      const result = await markAllDashboardAsRead(1);

      expect(result).toBe(2); // 2 + 0 (no match update) + 0
    });

    it('handles toBoolean for string "t" from postgres', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: typeof mocks.db.execute }) => Promise<unknown>) => {
          const txExecute = vi.fn()
            .mockResolvedValueOnce({ rows: [{ count: 0 }] })
            .mockResolvedValueOnce({ rows: [{ exists: 't' }] })  // postgres boolean as string
            .mockResolvedValueOnce({ rows: [{ count: 1 }] })
            .mockResolvedValueOnce({ rows: [{ count: 0 }] });

          return callback({ execute: txExecute });
        },
      );

      const result = await markAllDashboardAsRead(1);

      expect(result).toBe(1); // 0 + 1 + 0
    });

    it('handles toBoolean for numeric 1', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: typeof mocks.db.execute }) => Promise<unknown>) => {
          const txExecute = vi.fn()
            .mockResolvedValueOnce({ rows: [{ count: 0 }] })
            .mockResolvedValueOnce({ rows: [{ exists: 1 }] })  // numeric boolean
            .mockResolvedValueOnce({ rows: [{ count: 2 }] })
            .mockResolvedValueOnce({ rows: [{ count: 0 }] });

          return callback({ execute: txExecute });
        },
      );

      const result = await markAllDashboardAsRead(1);

      expect(result).toBe(2);
    });

    it('handles toBoolean for numeric 0', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: typeof mocks.db.execute }) => Promise<unknown>) => {
          const txExecute = vi.fn()
            .mockResolvedValueOnce({ rows: [{ count: 0 }] })
            .mockResolvedValueOnce({ rows: [{ exists: 0 }] })  // numeric 0 = false
            // no match_notifications update
            .mockResolvedValueOnce({ rows: [{ count: 0 }] });

          return callback({ execute: txExecute });
        },
      );

      const result = await markAllDashboardAsRead(1);

      expect(result).toBe(0);
    });

    it('handles toBoolean for string "1"', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: typeof mocks.db.execute }) => Promise<unknown>) => {
          const txExecute = vi.fn()
            .mockResolvedValueOnce({ rows: [{ count: 0 }] })
            .mockResolvedValueOnce({ rows: [{ exists: '1' }] })
            .mockResolvedValueOnce({ rows: [{ count: 1 }] })
            .mockResolvedValueOnce({ rows: [{ count: 0 }] });

          return callback({ execute: txExecute });
        },
      );

      const result = await markAllDashboardAsRead(1);

      expect(result).toBe(1);
    });

    it('handles toBoolean for string "true"', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: typeof mocks.db.execute }) => Promise<unknown>) => {
          const txExecute = vi.fn()
            .mockResolvedValueOnce({ rows: [{ count: 0 }] })
            .mockResolvedValueOnce({ rows: [{ exists: 'true' }] })
            .mockResolvedValueOnce({ rows: [{ count: 0 }] })
            .mockResolvedValueOnce({ rows: [{ count: 0 }] });

          return callback({ execute: txExecute });
        },
      );

      const result = await markAllDashboardAsRead(1);

      expect(result).toBe(0);
    });

    it('returns 0 when no updates across any table', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: typeof mocks.db.execute }) => Promise<unknown>) => {
          const txExecute = vi.fn()
            .mockResolvedValueOnce({ rows: [{ count: 0 }] })
            .mockResolvedValueOnce({ rows: [{ exists: false }] })
            .mockResolvedValueOnce({ rows: [{ count: 0 }] });

          return callback({ execute: txExecute });
        },
      );

      const result = await markAllDashboardAsRead(1);

      expect(result).toBe(0);
    });
  });

  // ── invalidateDashboardUnreadCache ──

  describe('invalidateDashboardUnreadCache', () => {
    it('does not throw when called (cache is disabled in test env)', () => {
      expect(() => invalidateDashboardUnreadCache(1)).not.toThrow();
    });
  });
});
