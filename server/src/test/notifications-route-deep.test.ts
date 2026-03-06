/**
 * notifications-route-deep.test.ts
 * notifications.ts の未カバーブランチを追加テスト
 * - parseMatchDiff (valid/invalid JSON)
 * - matchUpdateNotice (own pharmacy vs other pharmacy)
 * - proposalActionNotice (accepted_a/accepted_b/confirmed)
 * - compareNoticeOrder / timestampSortValue
 * - resolveNotificationType / resolveNotificationActionPath
 * - notificationToNotice (unsupported type)
 * - GET /unread-count, PATCH /read-all, PATCH /:id/read
 * - error branches in match read / message read
 * - cursor fallback logic
 */
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
  getDashboardUnreadCount: vi.fn(async () => 3),
  invalidateDashboardUnreadCache: vi.fn(),
  markAsRead: vi.fn(async () => true),
  markAllDashboardAsRead: vi.fn(async () => 5),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../services/notification-service', () => ({
  getDashboardUnreadCount: mocks.getDashboardUnreadCount,
  invalidateDashboardUnreadCache: mocks.invalidateDashboardUnreadCache,
  markAsRead: mocks.markAsRead,
  markAllDashboardAsRead: mocks.markAllDashboardAsRead,
}));

import notificationsRouter from '../routes/notifications';
import { createAuthenticatedApp } from './helpers/mock-builders';

/**
 * Build a chainable+thenable query mock: .from().where().orderBy().limit()
 * The query itself is thenable (like Drizzle ORM), resolving to `result`.
 * Calling .limit() also resolves to `result`.
 */
function createSelectQuery(result: unknown) {
  const query: Record<string, unknown> = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: (onfulfilled?: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  (query.from as ReturnType<typeof vi.fn>).mockReturnValue(query);
  (query.where as ReturnType<typeof vi.fn>).mockReturnValue(query);
  (query.orderBy as ReturnType<typeof vi.fn>).mockReturnValue(query);
  (query.limit as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  return query;
}

/**
 * Build a chainable+thenable query mock that rejects.
 */
function createFailingSelectQuery(error: Error) {
  const query: Record<string, unknown> = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: (onfulfilled?: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) =>
      Promise.reject(error).then(onfulfilled, onrejected),
  };
  (query.from as ReturnType<typeof vi.fn>).mockReturnValue(query);
  (query.where as ReturnType<typeof vi.fn>).mockReturnValue(query);
  (query.orderBy as ReturnType<typeof vi.fn>).mockReturnValue(query);
  (query.limit as ReturnType<typeof vi.fn>).mockRejectedValue(error);
  return query;
}

function createApp() {
  return createAuthenticatedApp('/api/notifications', notificationsRouter);
}

/**
 * Set up db.select mock to always return empty arrays.
 * Useful as a default fallback.
 */
function mockSelectAlwaysEmpty() {
  mocks.db.select.mockImplementation(() => createSelectQuery([]));
}

describe('notifications route deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    // Default: select always returns empty. Individual tests can override with mockImplementationOnce.
    mockSelectAlwaysEmpty();
  });

  // ── GET /unread-count ──

  describe('GET /api/notifications/unread-count', () => {
    it('returns unread count', async () => {
      const app = createApp();
      const res = await request(app).get('/api/notifications/unread-count');
      expect(res.status).toBe(200);
      expect(res.body.unreadCount).toBe(3);
    });

    it('returns 500 when getDashboardUnreadCount throws', async () => {
      mocks.getDashboardUnreadCount.mockRejectedValueOnce(new Error('db err'));
      const app = createApp();
      const res = await request(app).get('/api/notifications/unread-count');
      expect(res.status).toBe(500);
    });
  });

  // ── PATCH /read-all ──

  describe('PATCH /api/notifications/read-all', () => {
    it('marks all as read', async () => {
      const app = createApp();
      const res = await request(app).patch('/api/notifications/read-all');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(5);
      expect(res.body.message).toContain('5件を既読');
    });

    it('returns 500 on error', async () => {
      mocks.markAllDashboardAsRead.mockRejectedValueOnce(new Error('fail'));
      const app = createApp();
      const res = await request(app).patch('/api/notifications/read-all');
      expect(res.status).toBe(500);
    });
  });

  // ── PATCH /:id/read ──

  describe('PATCH /api/notifications/:id/read', () => {
    it('marks notification as read', async () => {
      const app = createApp();
      const res = await request(app).patch('/api/notifications/10/read');
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('既読にしました');
    });

    it('returns 400 for invalid id', async () => {
      const app = createApp();
      const res = await request(app).patch('/api/notifications/abc/read');
      expect(res.status).toBe(400);
    });

    it('returns 404 when markAsRead returns false', async () => {
      mocks.markAsRead.mockResolvedValueOnce(false);
      const app = createApp();
      const res = await request(app).patch('/api/notifications/999/read');
      expect(res.status).toBe(404);
    });

    it('returns 500 on error', async () => {
      mocks.markAsRead.mockRejectedValueOnce(new Error('fail'));
      const app = createApp();
      const res = await request(app).patch('/api/notifications/10/read');
      expect(res.status).toBe(500);
    });
  });

  // ── GET / with match_notifications table error ──

  describe('GET /api/notifications - match_notifications table missing', () => {
    it('gracefully handles missing match_notifications table', async () => {
      const app = createApp();
      const missingTableError = Object.assign(new Error('relation does not exist'), { code: '42P01' });

      // The matchRows query (5th call) uses an IIFE with try/catch.
      // We use mockImplementationOnce in order; later calls fall through to the default.
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 5) {
          // matchRows IIFE: reject with table-missing error
          return createFailingSelectQuery(missingTableError);
        }
        return createSelectQuery([]);
      });

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.notices).toEqual([]);
    });
  });

  // ── GET / with confirmed proposal ──

  describe('GET /api/notifications - confirmed proposals', () => {
    it('renders confirmed proposal notice', async () => {
      const app = createApp();
      const confirmedProposal = {
        id: 200,
        pharmacyAId: 1,
        pharmacyBId: 2,
        status: 'confirmed',
        proposedAt: '2026-02-20T00:00:00.000Z',
      };

      // proposalsA is the 1st select call
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return createSelectQuery([confirmedProposal]);
        return createSelectQuery([]);
      });

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      const confirmNotice = res.body.notices.find((n: { type: string }) => n.type === 'status_update');
      expect(confirmNotice).toBeDefined();
      expect(confirmNotice.title).toContain('確定しました');
      expect(confirmNotice.actionPath).toBe('/proposals/200');
    });
  });

  // ── GET / with accepted_a proposal (pharmacy B sees pending-my-approval) ──

  describe('GET /api/notifications - accepted_a proposal for B side', () => {
    it('renders pending-my-approval notice for pharmacy B when status=accepted_a', async () => {
      const app = createApp();
      const proposal = {
        id: 300,
        pharmacyAId: 2,
        pharmacyBId: 1,  // currentUser=1 is B
        status: 'accepted_a',
        proposedAt: '2026-02-20T00:00:00.000Z',
      };

      // proposalsB is the 2nd select call
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 2) return createSelectQuery([proposal]);
        return createSelectQuery([]);
      });

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.notices).toHaveLength(1);
      expect(res.body.notices[0].type).toBe('inbound_request');
      // accepted_a with !isA → title is "相手承認済みの仮マッチングがあります"
      expect(res.body.notices[0].title).toContain('相手承認済み');
    });
  });

  // ── GET / with accepted_b proposal (pharmacy A sees pending-my-approval) ──

  describe('GET /api/notifications - accepted_b proposal for A side', () => {
    it('renders pending-my-approval notice for pharmacy A when status=accepted_b', async () => {
      const app = createApp();
      const proposal = {
        id: 301,
        pharmacyAId: 1,  // currentUser=1 is A
        pharmacyBId: 2,
        status: 'accepted_b',
        proposedAt: '2026-02-20T00:00:00.000Z',
      };

      // proposalsA is the 1st select call
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return createSelectQuery([proposal]);
        return createSelectQuery([]);
      });

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.notices).toHaveLength(1);
      expect(res.body.notices[0].type).toBe('inbound_request');
    });
  });

  // ── GET / with match update notifications ──

  describe('GET /api/notifications - match update', () => {
    it('renders match update notice with trigger pharmacy name', async () => {
      const app = createApp();
      const matchRow = {
        id: 50,
        triggerPharmacyId: 2,
        triggerUploadType: 'dead_stock' as const,
        candidateCountBefore: 5,
        candidateCountAfter: 8,
        diffJson: JSON.stringify({ addedPharmacyIds: [3, 4, 5], removedPharmacyIds: [] }),
        isRead: false,
        createdAt: '2026-02-25T00:00:00.000Z',
      };

      // matchRows is the 5th select call in first Promise.all.
      // messageIds is empty → no db.select for messageReads.
      // triggerPharmacyIds = [2] → db.select for triggerPharmacy is 7th call.
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 5) return createSelectQuery([matchRow]);
        if (callCount === 7) return createSelectQuery([{ id: 2, name: '相手薬局' }]);
        return createSelectQuery([]);
      });

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.notices).toHaveLength(1);
      expect(res.body.notices[0].title).toContain('相手薬局');
      expect(res.body.notices[0].body).toContain('追加 3');
    });

    it('renders match update for self pharmacy with used_medication', async () => {
      const app = createApp();
      const matchRow = {
        id: 51,
        triggerPharmacyId: 1,  // same as currentUser → "自薬局"
        triggerUploadType: 'used_medication' as const,
        candidateCountBefore: 3,
        candidateCountAfter: 2,
        diffJson: '{}',
        isRead: true,
        createdAt: '2026-02-25T00:00:00.000Z',
      };

      // matchRows is the 5th call; triggerPharmacy is the 7th call (no messageReads call since messages are empty)
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 5) return createSelectQuery([matchRow]);
        if (callCount === 7) return createSelectQuery([{ id: 1, name: '自分薬局' }]);
        return createSelectQuery([]);
      });

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.notices).toHaveLength(1);
      expect(res.body.notices[0].title).toContain('自薬局');
      expect(res.body.notices[0].title).toContain('使用量');
    });
  });

  // ── GET / with new_comment notification type ──

  describe('GET /api/notifications - new_comment notification', () => {
    it('renders new_comment notification', async () => {
      const app = createApp();
      const notification = {
        id: 70,
        pharmacyId: 1,
        type: 'new_comment',
        title: 'コメントが届きました',
        message: '提案にコメントがあります',
        referenceType: 'comment',
        referenceId: 500,
        isRead: false,
        readAt: null,
        createdAt: '2026-03-01T00:00:00.000Z',
      };

      // notificationRows is the 6th call
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 6) return createSelectQuery([notification]);
        return createSelectQuery([]);
      });

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.notices).toHaveLength(1);
      expect(res.body.notices[0].type).toBe('new_comment');
      expect(res.body.notices[0].actionPath).toBe('/proposals/500');
    });
  });

  // ── GET / with unsupported notification type (skipped) ──

  describe('GET /api/notifications - unsupported type', () => {
    it('skips notifications with unsupported type', async () => {
      const app = createApp();
      const notification = {
        id: 80,
        pharmacyId: 1,
        type: 'unknown_type',
        title: 'Unknown',
        message: 'msg',
        referenceType: null,
        referenceId: null,
        isRead: false,
        readAt: null,
        createdAt: '2026-03-01T00:00:00.000Z',
      };

      // notificationRows is the 6th call
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        if (callCount === 6) return createSelectQuery([notification]);
        return createSelectQuery([]);
      });

      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.notices).toHaveLength(0);
    });
  });

  // ── matches read error ──

  describe('POST /api/notifications/matches/:id/read - error', () => {
    it('returns 500 on unexpected error', async () => {
      // Override select to always return a failing query
      mocks.db.select.mockImplementation(() =>
        createFailingSelectQuery(new Error('db fail')),
      );
      const app = createApp();
      const res = await request(app).post('/api/notifications/matches/10/read');
      expect(res.status).toBe(500);
    });
  });

  // ── messages read error ──

  describe('POST /api/notifications/messages/:id/read - error', () => {
    it('returns 500 on unexpected error', async () => {
      mocks.db.select.mockImplementation(() =>
        createFailingSelectQuery(new Error('db fail')),
      );
      const app = createApp();
      const res = await request(app).post('/api/notifications/messages/10/read');
      expect(res.status).toBe(500);
    });
  });

  // ── messages read for pharmacy-targeted message ──

  describe('POST /api/notifications/messages/:id/read - pharmacy targeted', () => {
    it('allows read when targetPharmacyId matches current user', async () => {
      mocks.db.select.mockImplementation(() =>
        createSelectQuery([{ id: 15, targetType: 'pharmacy', targetPharmacyId: 1 }]),
      );
      const app = createApp();
      const res = await request(app).post('/api/notifications/messages/15/read');
      expect(res.status).toBe(200);
    });
  });
});
