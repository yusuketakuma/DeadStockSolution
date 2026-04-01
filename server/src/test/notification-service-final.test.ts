/**
 * notification-service-final.test.ts
 * Covers edge cases in notification-service.ts:
 * - getDashboardUnreadCount: aggregates notifications + admin messages
 * - markAllDashboardAsRead: transaction with notifications + admin messages
 */
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
    info: vi.fn(),
    debug: vi.fn(),
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
  getDashboardUnreadCount,
  markAllDashboardAsRead,
} from '../services/notification-service';

describe('notification-service-final', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getDashboardUnreadCount — aggregates notifications + admin', () => {
    it('sums notifications and admin messages unread counts', async () => {
      const notifWhere = vi.fn().mockResolvedValue([{ value: 5 }]);
      const notifFrom = vi.fn().mockReturnValue({ where: notifWhere });

      const adminWhere = vi.fn().mockResolvedValue([{ count: 2 }]);
      const adminLeftJoin = vi.fn().mockReturnValue({ where: adminWhere });
      const adminFrom = vi.fn().mockReturnValue({ leftJoin: adminLeftJoin });

      const matchWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
      const matchFrom = vi.fn().mockReturnValue({ where: matchWhere });

      mocks.db.select
        .mockReturnValueOnce({ from: matchFrom })
        .mockReturnValueOnce({ from: notifFrom })
        .mockReturnValueOnce({ from: adminFrom });

      const result = await getDashboardUnreadCount(99);

      // 5 notifications + 2 admin = 7
      expect(result).toBe(7);
    });

    it('returns 0 when both counts are 0', async () => {
      const notifWhere = vi.fn().mockResolvedValue([{ value: 0 }]);
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

      const result = await getDashboardUnreadCount(100);
      expect(result).toBe(0);
    });
  });

  describe('markAllDashboardAsRead — transaction with notifications, match notifications, and admin messages', () => {
    function createTx(...execResults: unknown[]) {
      const execute = vi.fn();
      for (const result of execResults) {
        execute.mockResolvedValueOnce(result);
      }
      const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
      const update = vi.fn().mockReturnValue({ set: updateSet });
      return { execute, update };
    }

    it('marks notifications and admin messages as read in transaction', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
          const tx = createTx(
            { rows: [{ count: 3 }] }, // markNotificationsAsRead
            { rows: [{ exists: true }] }, // match_notifications table exists
            { rows: [{ count: 0 }] }, // mark match_notifications as read
            { rows: [{ count: 2 }] }, // markAdminMessagesAsRead
          );
          return callback(tx);
        },
      );

      const result = await markAllDashboardAsRead(1);
      expect(result).toBe(5); // 3 notifications + 2 admin
    });

    it('returns 0 when nothing to mark as read', async () => {
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
  });
});
