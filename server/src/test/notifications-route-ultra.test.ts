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

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/notification-service', () => ({
  getDashboardUnreadCount: mocks.getDashboardUnreadCount,
  invalidateDashboardUnreadCache: mocks.invalidateDashboardUnreadCache,
  markAsRead: mocks.markAsRead,
  markAllDashboardAsRead: mocks.markAllDashboardAsRead,
}));

import notificationsRouter from '../routes/notifications';

function createSelectQuery(result: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    leftJoin: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  // Support direct await on where (for messageReads which has no limit/orderBy)
  const promisified = Object.assign(query, {
    then: (onfulfilled?: (v: unknown) => unknown, onrejected?: (r: unknown) => unknown) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  });
  return promisified;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRouter);
  return app;
}

describe('notifications-route-ultra', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    mocks.getDashboardUnreadCount.mockResolvedValue(0);
    mocks.markAsRead.mockResolvedValue(true);
    mocks.markAllDashboardAsRead.mockResolvedValue(0);
  });

  // ── GET /unread-count ──
  describe('GET /unread-count', () => {
    it('returns the unread count', async () => {
      mocks.getDashboardUnreadCount.mockResolvedValue(5);
      const app = createApp();
      const res = await request(app).get('/api/notifications/unread-count');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unreadCount: 5 });
    });

    it('returns 500 on error', async () => {
      mocks.getDashboardUnreadCount.mockRejectedValue(new Error('DB error'));
      const app = createApp();
      const res = await request(app).get('/api/notifications/unread-count');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('未読件数');
    });
  });

  // ── PATCH /read-all ──
  describe('PATCH /read-all', () => {
    it('marks all notifications as read', async () => {
      mocks.markAllDashboardAsRead.mockResolvedValue(3);
      const app = createApp();
      const res = await request(app).patch('/api/notifications/read-all');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: '3件を既読にしました', count: 3 });
    });

    it('returns 500 on error', async () => {
      mocks.markAllDashboardAsRead.mockRejectedValue(new Error('DB error'));
      const app = createApp();
      const res = await request(app).patch('/api/notifications/read-all');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('一括既読');
    });
  });

  // ── PATCH /:id/read ──
  describe('PATCH /:id/read', () => {
    it('marks a notification as read', async () => {
      mocks.markAsRead.mockResolvedValue(true);
      const app = createApp();
      const res = await request(app).patch('/api/notifications/1/read');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: '既読にしました' });
    });

    it('returns 400 for invalid id', async () => {
      const app = createApp();
      const res = await request(app).patch('/api/notifications/abc/read');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('不正なID');
    });

    it('returns 404 when notification not found', async () => {
      mocks.markAsRead.mockResolvedValue(false);
      const app = createApp();
      const res = await request(app).patch('/api/notifications/999/read');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('通知が見つかりません');
    });

    it('returns 500 on error', async () => {
      mocks.markAsRead.mockRejectedValue(new Error('DB error'));
      const app = createApp();
      const res = await request(app).patch('/api/notifications/1/read');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('既読更新');
    });
  });

  // ── GET / (error path) ──
  describe('GET / error handling', () => {
    it('returns 500 when database query fails', async () => {
      mocks.db.select.mockImplementation(() => {
        throw new Error('DB connection failed');
      });
      const app = createApp();
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('通知の取得に失敗しました');
    });
  });

  // ── GET / with match_notifications table missing ──
  describe('GET / with match_notifications error', () => {
    it('handles 42P01 error (undefined table) gracefully', async () => {
      const app = createApp();
      const tableError = Object.assign(new Error('relation "match_notifications" does not exist'), {
        code: '42P01',
      });

      // proposalsA, proposalsB: empty
      // messagesAll, messagesPharmacy: empty
      // matchRows (IIFE that catches 42P01): throws
      // notificationRows: empty
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 5) {
          // This is the matchRows query wrapped in async IIFE
          const query = createSelectQuery([]);
          query.limit.mockRejectedValue(tableError);
          return query;
        }
        return createSelectQuery([]);
      });

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.notices).toEqual([]);
    });
  });

  // ── POST /messages/:id/read error ──
  describe('POST /messages/:id/read error handling', () => {
    it('returns 500 when message read operation fails', async () => {
      mocks.db.select.mockImplementation(() => createSelectQuery([{ id: 1, targetType: 'all', targetPharmacyId: null }]));
      mocks.db.insert.mockImplementation(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn().mockRejectedValue(new Error('insert error')),
        })),
      }));
      const app = createApp();
      const res = await request(app).post('/api/notifications/messages/1/read');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('既読処理に失敗しました');
    });
  });

  // ── POST /matches/:id/read error ──
  describe('POST /matches/:id/read error handling', () => {
    it('returns 500 when match notification read fails', async () => {
      mocks.db.select.mockImplementation(() => createSelectQuery([{ id: 1, pharmacyId: 1 }]));
      mocks.db.update.mockImplementation(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockRejectedValue(new Error('update error')),
        })),
      }));
      const app = createApp();
      const res = await request(app).post('/api/notifications/matches/1/read');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('既読処理に失敗しました');
    });
  });

  // ── GET / with admin messages and match notifications ──
  describe('GET / with mixed content', () => {
    it('includes admin messages with read status', async () => {
      const app = createApp();

      // proposalsA=empty, proposalsB=empty
      // messagesAll=[message], messagesPharmacy=empty
      // matchRows=empty
      // notificationRows=empty
      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([{
          id: 100,
          title: '管理者からのお知らせ',
          body: 'テスト',
          actionPath: '/admin',
          createdAt: '2026-03-01T00:00:00.000Z',
        }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        // messageReads query (for message read status)
        .mockImplementationOnce(() => createSelectQuery([]))
        // triggerPharmacy names query
        .mockImplementationOnce(() => createSelectQuery([]));

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      const adminNotice = res.body.notices.find((n: { type: string }) => n.type === 'admin_message');
      expect(adminNotice).toBeDefined();
      expect(adminNotice.title).toContain('管理者');
      expect(adminNotice.unread).toBe(true);
    });

    it('includes match update notifications with pharmacy name', async () => {
      const app = createApp();

      // 6 queries in first Promise.all + 1 triggerPharmacy (messageIds is empty so that resolves inline)
      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([]))  // proposalsA
        .mockImplementationOnce(() => createSelectQuery([]))  // proposalsB
        .mockImplementationOnce(() => createSelectQuery([]))  // messagesAll
        .mockImplementationOnce(() => createSelectQuery([]))  // messagesPharmacy
        .mockImplementationOnce(() => createSelectQuery([{    // matchRows
          id: 200,
          triggerPharmacyId: 2,
          triggerUploadType: 'dead_stock',
          candidateCountBefore: 5,
          candidateCountAfter: 10,
          diffJson: JSON.stringify({ addedPharmacyIds: [3, 4], removedPharmacyIds: [5] }),
          isRead: false,
          createdAt: '2026-03-01T00:00:00.000Z',
        }]))
        .mockImplementationOnce(() => createSelectQuery([]))  // notificationRows
        // second Promise.all: messageIds.length=0 -> Promise.resolve, triggerPharmacyIds.length=1 -> db.select
        .mockImplementationOnce(() => createSelectQuery([{ id: 2, name: 'テスト薬局' }]));

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      const matchNotice = res.body.notices.find((n: { type: string }) => n.type === 'match_update');
      expect(matchNotice).toBeDefined();
      expect(matchNotice.title).toContain('テスト薬局');
      expect(matchNotice.body).toContain('追加 2');
      expect(matchNotice.body).toContain('除外 1');
    });

    it('displays 自薬局 when trigger pharmacy is the current user', async () => {
      const app = createApp();

      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([{
          id: 300,
          triggerPharmacyId: 1,
          triggerUploadType: 'used_medication',
          candidateCountBefore: 0,
          candidateCountAfter: 3,
          diffJson: '{}',
          isRead: true,
          createdAt: '2026-03-01T00:00:00.000Z',
        }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]));

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      const matchNotice = res.body.notices.find((n: { type: string }) => n.type === 'match_update');
      expect(matchNotice.title).toContain('自薬局');
    });
  });

  // ── GET / with various notification types ──
  describe('GET / notification type resolution', () => {
    it('maps new_comment type correctly', async () => {
      const app = createApp();

      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([{
          id: 400,
          pharmacyId: 1,
          type: 'new_comment',
          title: 'コメント',
          message: 'テストコメント',
          referenceType: 'comment',
          referenceId: 50,
          isRead: false,
          readAt: null,
          createdAt: '2026-03-01T00:00:00.000Z',
        }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]));

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      const commentNotice = res.body.notices.find((n: { type: string }) => n.type === 'new_comment');
      expect(commentNotice).toBeDefined();
      expect(commentNotice.actionPath).toBe('/proposals/50');
    });

    it('skips unsupported notification types', async () => {
      const app = createApp();

      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([{
          id: 500,
          pharmacyId: 1,
          type: 'unknown_type',
          title: 'Unknown',
          message: 'Unknown',
          referenceType: null,
          referenceId: null,
          isRead: false,
          readAt: null,
          createdAt: '2026-03-01T00:00:00.000Z',
        }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]));

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.notices).toHaveLength(0);
    });
  });

  // ── GET / proposal notice variations ──
  describe('GET / proposal notice variations', () => {
    it('shows outbound notice for pharmacy A when status is proposed', async () => {
      const app = createApp();

      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([{
          id: 600,
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'proposed',
          proposedAt: '2026-03-01T00:00:00.000Z',
        }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]));

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      const outbound = res.body.notices.find((n: { type: string }) => n.type === 'outbound_request');
      expect(outbound).toBeDefined();
      expect(outbound.title).toContain('送信済み');
    });

    it('shows confirmed notice for confirmed proposals', async () => {
      const app = createApp();

      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([{
          id: 700,
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'confirmed',
          proposedAt: '2026-03-01T00:00:00.000Z',
        }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]));

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      const confirmed = res.body.notices.find((n: { type: string }) => n.type === 'status_update');
      expect(confirmed).toBeDefined();
      expect(confirmed.title).toContain('確定');
    });

    it('shows inbound notice for accepted_a when pharmacy B', async () => {
      const app = createApp();

      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([{
          id: 800,
          pharmacyAId: 2,
          pharmacyBId: 1,
          status: 'accepted_a',
          proposedAt: '2026-03-01T00:00:00.000Z',
        }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]));

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      const inbound = res.body.notices.find((n: { type: string }) => n.type === 'inbound_request');
      expect(inbound).toBeDefined();
      expect(inbound.title).toContain('相手承認済み');
    });

    it('shows inbound notice for accepted_b when pharmacy A (isA)', async () => {
      const app = createApp();

      mocks.db.select
        .mockImplementationOnce(() => createSelectQuery([{
          id: 850,
          pharmacyAId: 1,
          pharmacyBId: 2,
          status: 'accepted_b',
          proposedAt: '2026-03-01T00:00:00.000Z',
        }]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]))
        .mockImplementationOnce(() => createSelectQuery([]));

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      const inbound = res.body.notices.find((n: { type: string }) => n.type === 'inbound_request');
      expect(inbound).toBeDefined();
      expect(inbound.title).toContain('相手承認済み');
    });
  });
});
