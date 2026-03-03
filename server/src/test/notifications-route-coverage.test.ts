import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
  getDashboardUnreadCount: vi.fn(),
  invalidateDashboardUnreadCache: vi.fn(),
  markAsRead: vi.fn(),
  markAllDashboardAsRead: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/notification-service', () => ({
  getDashboardUnreadCount: mocks.getDashboardUnreadCount,
  invalidateDashboardUnreadCache: mocks.invalidateDashboardUnreadCache,
  markAsRead: mocks.markAsRead,
  markAllDashboardAsRead: mocks.markAllDashboardAsRead,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import notificationsRouter from '../routes/notifications';

function createSelectQuery(result: unknown) {
  const resolved = Promise.resolve(result);
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    // Make the query itself thenable so it resolves when awaited without .limit()
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRouter);
  return app;
}

describe('notifications routes — additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockImplementation(() => createSelectQuery([]));
    mocks.db.update.mockImplementation(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    }));
    mocks.db.insert.mockImplementation(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      })),
    }));
  });

  describe('GET /unread-count', () => {
    it('returns unread count', async () => {
      const app = createApp();
      mocks.getDashboardUnreadCount.mockResolvedValue(5);

      const res = await request(app).get('/api/notifications/unread-count');

      expect(res.status).toBe(200);
      expect(res.body.unreadCount).toBe(5);
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.getDashboardUnreadCount.mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/api/notifications/unread-count');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('未読件数');
    });
  });

  describe('PATCH /read-all', () => {
    it('marks all as read', async () => {
      const app = createApp();
      mocks.markAllDashboardAsRead.mockResolvedValue(3);

      const res = await request(app).patch('/api/notifications/read-all');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(3);
      expect(res.body.message).toContain('3件');
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.markAllDashboardAsRead.mockRejectedValue(new Error('DB error'));

      const res = await request(app).patch('/api/notifications/read-all');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('一括既読');
    });
  });

  describe('PATCH /:id/read', () => {
    it('marks notification as read', async () => {
      const app = createApp();
      mocks.markAsRead.mockResolvedValue(true);

      const res = await request(app).patch('/api/notifications/5/read');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('既読');
    });

    it('returns 404 when notification not found', async () => {
      const app = createApp();
      mocks.markAsRead.mockResolvedValue(false);

      const res = await request(app).patch('/api/notifications/999/read');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('通知が見つかりません');
    });

    it('returns 400 for invalid id', async () => {
      const app = createApp();

      const res = await request(app).patch('/api/notifications/abc/read');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('不正なID');
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.markAsRead.mockRejectedValue(new Error('DB error'));

      const res = await request(app).patch('/api/notifications/5/read');

      expect(res.status).toBe(500);
    });
  });

  describe('GET / — edge cases', () => {
    it('returns empty notifications when all sources are empty', async () => {
      const app = createApp();

      // 6 select queries return empty arrays
      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]));

      const res = await request(app).get('/api/notifications');

      expect(res.status).toBe(200);
      expect(res.body.notices).toHaveLength(0);
      expect(res.body.summary.total).toBe(0);
    });

    it('handles admin messages with read status', async () => {
      const app = createApp();
      const adminMessage = {
        id: 10,
        title: '重要なお知らせ',
        body: 'テスト',
        actionPath: '/admin',
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      // proposals A, proposals B, messages all, messages pharmacy, match rows, notifications
      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([adminMessage]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        // messageReads, triggerPharmacyRows
        .mockImplementationOnce(() => createSelectQuery([]));

      const res = await request(app).get('/api/notifications');

      expect(res.status).toBe(200);
      expect(res.body.notices).toHaveLength(1);
      expect(res.body.notices[0].type).toBe('admin_message');
      expect(res.body.summary.unreadMessages).toBe(1);
    });

    it('returns 500 on query error', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new Error('DB error')),
            }),
          }),
        }),
      }));

      const res = await request(app).get('/api/notifications');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('通知の取得');
    });

    it('handles notification with new_comment type', async () => {
      const app = createApp();
      const commentNotification = {
        id: 20,
        pharmacyId: 1,
        type: 'new_comment',
        title: '新しいコメント',
        message: 'コメント内容',
        referenceType: 'comment',
        referenceId: 50,
        isRead: false,
        readAt: null,
        createdAt: '2026-01-02T00:00:00.000Z',
      };

      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([commentNotification]));

      const res = await request(app).get('/api/notifications');

      expect(res.status).toBe(200);
      expect(res.body.notices).toHaveLength(1);
      expect(res.body.notices[0].type).toBe('new_comment');
      expect(res.body.notices[0].actionPath).toBe('/proposals/50');
    });

    it('handles confirmed proposal notice', async () => {
      const app = createApp();
      const proposal = {
        id: 30,
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'confirmed',
        proposedAt: '2026-01-01T00:00:00.000Z',
      };

      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([proposal]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]));

      const res = await request(app).get('/api/notifications');

      expect(res.status).toBe(200);
      expect(res.body.notices.length).toBeGreaterThanOrEqual(1);
      const confirmed = res.body.notices.find((n: { type: string }) => n.type === 'status_update');
      expect(confirmed).toBeTruthy();
    });
  });

  describe('POST /messages/:id/read — edge cases', () => {
    it('handles pharmacy-targeted message for current user', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => createSelectQuery([
        { id: 15, targetType: 'pharmacy', targetPharmacyId: 1 },
      ]));

      const res = await request(app).post('/api/notifications/messages/15/read');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('既読');
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      }));

      const res = await request(app).post('/api/notifications/messages/15/read');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /matches/:id/read — edge cases', () => {
    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      }));

      const res = await request(app).post('/api/notifications/matches/10/read');

      expect(res.status).toBe(500);
    });
  });
});
