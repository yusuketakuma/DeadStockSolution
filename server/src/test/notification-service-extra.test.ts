/**
 * notification-service-extra.test.ts
 * Covers uncovered lines in notification-service.ts:
 * - getNotifications: lines 175-188 (count + paginated select, returns rows and total)
 * - getDashboardUnreadCount: line 136 (throw err when NOT isUndefinedTableError)
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
  getNotifications,
  getDashboardUnreadCount,
} from '../services/notification-service';

describe('notification-service-extra', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getNotifications (lines 175-188)', () => {
    it('returns rows and total from two select queries', async () => {
      const fakeRows = [
        {
          id: 1,
          pharmacyId: 10,
          type: 'match' as const,
          title: 'Test',
          message: 'Test message',
          isRead: false,
          referenceType: null,
          referenceId: null,
          createdAt: '2026-01-01T00:00:00Z',
          readAt: null,
        },
      ];

      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // count query: select({ value: count() }).from().where()
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ value: 5 }]),
            }),
          };
        }
        // rows query: select().from().where().orderBy().limit().offset()
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockResolvedValue(fakeRows),
                }),
              }),
            }),
          }),
        };
      });

      const result = await getNotifications(10, 1, 20);
      expect(result.total).toBe(5);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe(1);
    });

    it('returns page offset rows correctly', async () => {
      // page=2, limit=10 → offset=10
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ value: 25 }]),
            }),
          };
        }
        const offsetFn = vi.fn().mockResolvedValue([]);
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: offsetFn,
                }),
              }),
            }),
          }),
        };
      });

      const result = await getNotifications(10, 2, 10);
      expect(result.total).toBe(25);
      expect(result.rows).toHaveLength(0);
    });

    it('handles empty countResult gracefully (undefined → 0)', async () => {
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]), // empty → countResult undefined
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        };
      });

      const result = await getNotifications(99, 1, 20);
      expect(result.total).toBe(0);
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('getDashboardUnreadCount — propagates DB errors', () => {
    it('re-throws errors from notifications unread count query', async () => {
      const networkError = new Error('Connection timeout');

      const notifWhere = vi.fn().mockRejectedValue(networkError);
      const notifFrom = vi.fn().mockReturnValue({ where: notifWhere });

      const adminWhere = vi.fn().mockResolvedValue([{ count: 1 }]);
      const adminLeftJoin = vi.fn().mockReturnValue({ where: adminWhere });
      const adminFrom = vi.fn().mockReturnValue({ leftJoin: adminLeftJoin });

      mocks.db.select
        .mockReturnValueOnce({ from: notifFrom })
        .mockReturnValueOnce({ from: adminFrom });

      await expect(getDashboardUnreadCount(55)).rejects.toThrow('Connection timeout');
    });
  });
});
