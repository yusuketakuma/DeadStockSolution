/**
 * notification-service-final.test.ts
 * Covers uncovered lines in notification-service.ts:
 * - getDashboardUnreadCount: isUndefinedTableError true (42P01 code) -> logs warn and returns [{ count: 0 }]
 * - toBoolean: number branch (value !== 0 = true, value === 0 = false)
 * - toBoolean: string branch 'true', '1' (truthy variants)
 * - setCachedDashboardUnreadCount: guarded by DASHBOARD_UNREAD_CACHE_ENABLED = false in test env
 *   -> these branches cannot be covered without env manipulation
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

  describe('getDashboardUnreadCount — 42P01 (undefined table) error handling', () => {
    it('handles 42P01 error from match_notifications and returns fallback 0', async () => {
      // isUndefinedTableError path: code === '42P01' -> logs warn, returns [{ count: 0 }]
      const undefinedTableError = Object.assign(new Error('relation "match_notifications" does not exist'), {
        code: '42P01',
      });

      const matchWhere = vi.fn().mockRejectedValue(undefinedTableError);
      const matchFrom = vi.fn().mockReturnValue({ where: matchWhere });

      const notifWhere = vi.fn().mockResolvedValue([{ value: 5 }]);
      const notifFrom = vi.fn().mockReturnValue({ where: notifWhere });

      const adminWhere = vi.fn().mockResolvedValue([{ count: 2 }]);
      const adminLeftJoin = vi.fn().mockReturnValue({ where: adminWhere });
      const adminFrom = vi.fn().mockReturnValue({ leftJoin: adminLeftJoin });

      mocks.db.select
        .mockReturnValueOnce({ from: matchFrom })
        .mockReturnValueOnce({ from: notifFrom })
        .mockReturnValueOnce({ from: adminFrom });

      const result = await getDashboardUnreadCount(99);

      // 5 notifications + 2 admin + 0 (fallback for match) = 7
      expect(result).toBe(7);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('match_notifications'),
        expect.any(Object),
      );
    });

    it('handles 42P01 error where err.message is not an Error instance', async () => {
      // Test with a plain object that has code: '42P01' but is not an Error
      const undefinedTableError = Object.assign(new Error('table not found'), {
        code: '42P01',
      });

      const matchWhere = vi.fn().mockRejectedValue(undefinedTableError);
      const matchFrom = vi.fn().mockReturnValue({ where: matchWhere });

      const notifWhere = vi.fn().mockResolvedValue([{ value: 0 }]);
      const notifFrom = vi.fn().mockReturnValue({ where: notifWhere });

      const adminWhere = vi.fn().mockResolvedValue([]);
      const adminLeftJoin = vi.fn().mockReturnValue({ where: adminWhere });
      const adminFrom = vi.fn().mockReturnValue({ leftJoin: adminLeftJoin });

      mocks.db.select
        .mockReturnValueOnce({ from: matchFrom })
        .mockReturnValueOnce({ from: notifFrom })
        .mockReturnValueOnce({ from: adminFrom });

      const result = await getDashboardUnreadCount(100);
      // 0 + 0 + 0 = 0
      expect(result).toBe(0);
    });
  });

  describe('markAllDashboardAsRead — toBoolean number branch', () => {
    function createTx(...execResults: unknown[]) {
      const execute = vi.fn();
      for (const result of execResults) {
        execute.mockResolvedValueOnce(result);
      }
      return { execute };
    }

    it('handles toBoolean for number 1 (truthy)', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
          const tx = createTx(
            { rows: [{ count: 0 }] },
            { rows: [{ exists: 1 }] }, // number 1 -> truthy
            { rows: [{ count: 1 }] },
            { rows: [{ count: 0 }] },
          );
          return callback(tx);
        },
      );

      const result = await markAllDashboardAsRead(1);
      expect(result).toBe(1); // 0 notifications + 1 match + 0 admin
    });

    it('handles toBoolean for number 0 (falsy)', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
          const tx = createTx(
            { rows: [{ count: 0 }] },
            { rows: [{ exists: 0 }] }, // number 0 -> falsy
            { rows: [{ count: 0 }] },
          );
          return callback(tx);
        },
      );

      const result = await markAllDashboardAsRead(1);
      expect(result).toBe(0);
    });

    it('handles toBoolean for string "1" (truthy)', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
          const tx = createTx(
            { rows: [{ count: 0 }] },
            { rows: [{ exists: '1' }] }, // string '1' -> truthy
            { rows: [{ count: 3 }] },
            { rows: [{ count: 0 }] },
          );
          return callback(tx);
        },
      );

      const result = await markAllDashboardAsRead(1);
      expect(result).toBe(3); // 0 + 3 + 0
    });

    it('handles toBoolean for string "true" (truthy)', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
          const tx = createTx(
            { rows: [{ count: 2 }] },
            { rows: [{ exists: 'true' }] }, // string 'true' -> truthy
            { rows: [{ count: 1 }] },
            { rows: [{ count: 4 }] },
          );
          return callback(tx);
        },
      );

      const result = await markAllDashboardAsRead(1);
      expect(result).toBe(7); // 2 + 1 + 4
    });

    it('handles toBoolean for boolean true (truthy) — exact type check', async () => {
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
          const tx = createTx(
            { rows: [{ count: 0 }] },
            { rows: [{ exists: true }] }, // boolean true -> truthy
            { rows: [{ count: 2 }] },
            { rows: [{ count: 1 }] },
          );
          return callback(tx);
        },
      );

      const result = await markAllDashboardAsRead(2);
      expect(result).toBe(3); // 0 + 2 + 1
    });
  });
});
