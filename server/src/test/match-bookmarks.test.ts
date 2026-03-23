import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
  rejectAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
}));

import matchBookmarksRouter from '../routes/match-bookmarks';
import { requireLogin } from '../middleware/auth';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/match-bookmarks', requireLogin as express.RequestHandler, matchBookmarksRouter);
  return app;
}

// ── チェーンビルダー ──────────────────────────────────

/** select().from().where().limit() → result */
function makeSelectChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    from: vi.fn(),
    where: vi.fn(),
    leftJoin: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockResolvedValue(result);
  return chain;
}

/** select().from().where().limit() → result (via limit) */
function makeSelectLimitChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);
  return chain;
}

/** insert().values().returning() → result */
function makeInsertChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    values: vi.fn(),
    returning: vi.fn(),
  };
  chain.values.mockReturnValue(chain);
  chain.returning.mockResolvedValue(result);
  return chain;
}

/** update().set().where().returning() → result */
function makeUpdateChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.returning.mockResolvedValue(result);
  return chain;
}

/** delete().where() → void */
function makeDeleteChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
  };
  chain.where.mockResolvedValue(undefined);
  return chain;
}

// ── テスト ──────────────────────────────────

describe('match-bookmarks routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── POST / ──────────────────────────────────

  describe('POST /', () => {
    it('creates a bookmark and returns 201', async () => {
      const app = createApp();
      const created = { id: 1, pharmacyId: 1, candidatePharmacyId: 2, drugCode: 'ABC123', memo: null, createdAt: new Date().toISOString() };

      // 1st select: duplicate check → not found
      mocks.db.select.mockReturnValueOnce(makeSelectLimitChain([]));
      // insert
      mocks.db.insert.mockReturnValue(makeInsertChain([created]));

      const res = await request(app)
        .post('/api/match-bookmarks')
        .send({ candidatePharmacyId: 2, drugCode: 'ABC123' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(1);
      expect(res.body.drugCode).toBe('ABC123');
    });

    it('returns 409 when bookmark already exists', async () => {
      const app = createApp();
      const existing = [{ id: 5 }];

      // 1st select: duplicate check → found
      mocks.db.select.mockReturnValueOnce(makeSelectLimitChain(existing));

      const res = await request(app)
        .post('/api/match-bookmarks')
        .send({ candidatePharmacyId: 2, drugCode: 'ABC123' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('ブックマーク済み');
    });

    it('returns 400 when candidatePharmacyId is missing', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/match-bookmarks')
        .send({ drugCode: 'ABC123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('candidatePharmacyId');
    });

    it('returns 400 when drugCode is missing', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/match-bookmarks')
        .send({ candidatePharmacyId: 2 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('drugCode');
    });

    it('returns 400 when memo is not a string', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/match-bookmarks')
        .send({ candidatePharmacyId: 2, drugCode: 'ABC123', memo: 123 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('memo');
    });

    it('returns 500 on db error', async () => {
      const app = createApp();

      mocks.db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app)
        .post('/api/match-bookmarks')
        .send({ candidatePharmacyId: 2, drugCode: 'ABC123' });

      expect(res.status).toBe(500);
    });
  });

  // ── GET / ──────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with bookmark list', async () => {
      const app = createApp();
      const items = [
        { id: 1, pharmacyId: 1, candidatePharmacyId: 2, candidatePharmacyName: '調剤薬局B', drugCode: 'ABC123', memo: 'メモ', createdAt: new Date().toISOString() },
      ];

      mocks.db.select.mockReturnValue(makeSelectChain(items));

      const res = await request(app).get('/api/match-bookmarks');

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].drugCode).toBe('ABC123');
      expect(res.body.page).toBe(1);
    });

    it('accepts page and limit query params', async () => {
      const app = createApp();

      mocks.db.select.mockReturnValue(makeSelectChain([]));

      const res = await request(app).get('/api/match-bookmarks?page=2&limit=10');

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(2);
      expect(res.body.limit).toBe(10);
    });

    it('returns 500 on db error', async () => {
      const app = createApp();

      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockRejectedValue(new Error('DB error')),
                }),
              }),
            }),
          }),
        }),
      });

      const res = await request(app).get('/api/match-bookmarks');

      expect(res.status).toBe(500);
    });
  });

  // ── PATCH /:id ──────────────────────────────────

  describe('PATCH /:id', () => {
    it('updates memo and returns 200', async () => {
      const app = createApp();
      const bookmark = { id: 1, pharmacyId: 1, candidatePharmacyId: 2, drugCode: 'ABC', memo: '新しいメモ', createdAt: new Date().toISOString() };

      // ownership check
      mocks.db.select.mockReturnValueOnce(makeSelectLimitChain([{ id: 1, pharmacyId: 1 }]));
      // update
      mocks.db.update.mockReturnValue(makeUpdateChain([bookmark]));

      const res = await request(app)
        .patch('/api/match-bookmarks/1')
        .send({ memo: '新しいメモ' });

      expect(res.status).toBe(200);
      expect(res.body.memo).toBe('新しいメモ');
    });

    it('returns 403 when bookmark belongs to another pharmacy', async () => {
      const app = createApp();

      // ownership check: pharmacyId = 99 (different from req.user.id = 1)
      mocks.db.select.mockReturnValueOnce(makeSelectLimitChain([{ id: 1, pharmacyId: 99 }]));

      const res = await request(app)
        .patch('/api/match-bookmarks/1')
        .send({ memo: '無効なメモ' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('権限');
    });

    it('returns 404 when bookmark not found', async () => {
      const app = createApp();

      mocks.db.select.mockReturnValueOnce(makeSelectLimitChain([]));

      const res = await request(app)
        .patch('/api/match-bookmarks/999')
        .send({ memo: 'メモ' });

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid id', async () => {
      const app = createApp();

      const res = await request(app)
        .patch('/api/match-bookmarks/abc')
        .send({ memo: 'メモ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('不正なID');
    });

    it('returns 400 when memo is not a string', async () => {
      const app = createApp();

      const res = await request(app)
        .patch('/api/match-bookmarks/1')
        .send({ memo: 123 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('memo');
    });
  });

  // ── DELETE /:id ──────────────────────────────────

  describe('DELETE /:id', () => {
    it('deletes bookmark and returns 200', async () => {
      const app = createApp();

      // ownership check
      mocks.db.select.mockReturnValueOnce(makeSelectLimitChain([{ id: 1, pharmacyId: 1 }]));
      // delete
      mocks.db.delete.mockReturnValue(makeDeleteChain());

      const res = await request(app).delete('/api/match-bookmarks/1');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 403 when bookmark belongs to another pharmacy', async () => {
      const app = createApp();

      // ownership check: pharmacyId = 99 (different from req.user.id = 1)
      mocks.db.select.mockReturnValueOnce(makeSelectLimitChain([{ id: 1, pharmacyId: 99 }]));

      const res = await request(app).delete('/api/match-bookmarks/1');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('権限');
    });

    it('returns 404 when bookmark not found', async () => {
      const app = createApp();

      mocks.db.select.mockReturnValueOnce(makeSelectLimitChain([]));

      const res = await request(app).delete('/api/match-bookmarks/999');

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid id', async () => {
      const app = createApp();

      const res = await request(app).delete('/api/match-bookmarks/abc');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('不正なID');
    });

    it('returns 500 on db error', async () => {
      const app = createApp();

      mocks.db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app).delete('/api/match-bookmarks/1');

      expect(res.status).toBe(500);
    });
  });
});
