import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  createNotification: vi.fn(),
}));

function mockExchangeCommentUnreadDependencies() {
  vi.doMock('../middleware/auth', () => ({
    requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
      req.user = { id: 1, email: 'test@example.com', isAdmin: false };
      next();
    },
    rejectAdmin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, res: Response, next: () => void) => {
      if (req.user?.isAdmin) {
        res.status(403).json({ error: '管理者アカウントではこの機能を利用できません。一般ユーザーアカウントでログインしてください' });
        return;
      }
      next();
    },
  }));
  vi.doMock('../config/database', () => ({ db: mocks.db }));
  vi.doMock('../services/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  vi.doMock('../services/notification-service', () => ({
    createNotification: mocks.createNotification,
  }));
  vi.doMock('drizzle-orm', () => {
    const sqlFn = Object.assign(
      (..._args: unknown[]) => ({}),
      { raw: (..._args: unknown[]) => ({}) },
    );
    return {
      eq: vi.fn(() => ({})),
      ne: vi.fn(() => ({})),
      and: vi.fn(() => ({})),
      or: vi.fn(() => ({})),
      asc: vi.fn(() => ({})),
      desc: vi.fn(() => ({})),
      sql: sqlFn,
    };
  });
  vi.doMock('../utils/db-utils', () => ({
    rowCount: {},
  }));
  vi.doMock('../db/schema', () => ({
    exchangeProposals: { id: 'id', pharmacyAId: 'pharmacyAId', pharmacyBId: 'pharmacyBId' },
    pharmacies: { id: 'id', name: 'name' },
    proposalComments: {
      id: 'id', proposalId: 'proposalId', authorPharmacyId: 'authorPharmacyId',
      body: 'body', isDeleted: 'isDeleted', createdAt: 'createdAt', updatedAt: 'updatedAt',
      readByRecipient: 'readByRecipient',
    },
  }));
}

let exchangeCommentsRouter: express.Router;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mockExchangeCommentUnreadDependencies();
  ({ default: exchangeCommentsRouter } = await import('../routes/exchange-comments'));
});

function chainableSelect(result: unknown) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'offset']) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  q.limit = vi.fn().mockReturnValue(Promise.resolve(result));
  return q;
}

function chainableSelectWhere(result: unknown) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  q.from = vi.fn().mockReturnValue(q);
  q.where = vi.fn().mockReturnValue(Promise.resolve(result));
  return q;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request & { user?: { id: number; email: string; isAdmin: boolean } }, _res: Response, next: NextFunction) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  });
  app.use('/api/exchanges', exchangeCommentsRouter);
  return app;
}

function createAdminApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request & { user?: { id: number; email: string; isAdmin: boolean } }, _res: Response, next: NextFunction) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  });
  app.use('/api/exchanges', exchangeCommentsRouter);
  return app;
}

describe('exchange-comments unread routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /proposals/:id/comments/unread-count', () => {
    it('returns unread count for logged-in user', async () => {
      const app = createApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };

      // First select: proposal lookup
      mocks.db.select.mockReturnValueOnce(chainableSelect([proposal]));
      // Second select: unread count
      mocks.db.select.mockReturnValueOnce(chainableSelectWhere([{ count: 3 }]));

      const res = await request(app)
        .get('/api/exchanges/proposals/1/comments/unread-count');

      expect(res.status).toBe(200);
      expect(res.body.unreadCount).toBe(3);
    });

    it('returns 0 when no unread comments', async () => {
      const app = createApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };

      mocks.db.select.mockReturnValueOnce(chainableSelect([proposal]));
      mocks.db.select.mockReturnValueOnce(chainableSelectWhere([{ count: 0 }]));

      const res = await request(app)
        .get('/api/exchanges/proposals/1/comments/unread-count');

      expect(res.status).toBe(200);
      expect(res.body.unreadCount).toBe(0);
    });

    it('returns 404 when proposal not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([]));

      const res = await request(app)
        .get('/api/exchanges/proposals/999/comments/unread-count');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('マッチングが見つかりません');
    });

    it('returns 400 for invalid proposal id', async () => {
      const app = createApp();

      const res = await request(app)
        .get('/api/exchanges/proposals/abc/comments/unread-count');

      expect(res.status).toBe(400);
    });

    it('returns 403 when admin accesses unread-count', async () => {
      const app = createAdminApp();

      const res = await request(app)
        .get('/api/exchanges/proposals/1/comments/unread-count');

      expect(res.status).toBe(403);
    });

    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app)
        .get('/api/exchanges/proposals/1/comments/unread-count');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('未読コメント数の取得に失敗');
    });
  });

  describe('PATCH /proposals/:id/comments/mark-read', () => {
    it('marks unread comments as read and returns count', async () => {
      const app = createApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };

      mocks.db.select.mockReturnValueOnce(chainableSelect([proposal]));
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 10 }, { id: 11 }]),
          }),
        }),
      });

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/mark-read');

      expect(res.status).toBe(200);
      expect(res.body.markedCount).toBe(2);
    });

    it('returns 0 when no comments to mark', async () => {
      const app = createApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };

      mocks.db.select.mockReturnValueOnce(chainableSelect([proposal]));
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/mark-read');

      expect(res.status).toBe(200);
      expect(res.body.markedCount).toBe(0);
    });

    it('returns 404 when proposal not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([]));

      const res = await request(app)
        .patch('/api/exchanges/proposals/999/comments/mark-read');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('マッチングが見つかりません');
    });

    it('returns 400 for invalid proposal id', async () => {
      const app = createApp();

      const res = await request(app)
        .patch('/api/exchanges/proposals/abc/comments/mark-read');

      expect(res.status).toBe(400);
    });

    it('returns 403 when admin calls mark-read', async () => {
      const app = createAdminApp();

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/mark-read');

      expect(res.status).toBe(403);
    });

    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/mark-read');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('既読マークの更新に失敗');
    });
  });
});
