import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDrugMasterStats: vi.fn(),
  getDrugDetail: vi.fn(),
  updateDrugMasterItem: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  db: {
    select: vi.fn(),
  },
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/drug-master-service', () => ({
  getDrugMasterStats: mocks.getDrugMasterStats,
  getDrugDetail: mocks.getDrugDetail,
  updateDrugMasterItem: mocks.updateDrugMasterItem,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  like: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  isNotNull: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import drugMasterRouter from '../routes/drug-master';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/drug-master', drugMasterRouter);
  return app;
}

function createPaginatedQuery(rows: unknown[], total: number) {
  let callCount = 0;
  return () => {
    callCount++;
    const query = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      offset: vi.fn(),
    };
    query.from.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    if (callCount === 1) {
      // count query: select().from().where() resolves directly
      query.where.mockResolvedValue([{ value: total }]);
    } else {
      // data query: select().from().where().orderBy().limit().offset() resolves
      query.where.mockReturnValue(query);
      query.offset.mockResolvedValue(rows);
    }
    return query;
  };
}

describe('drug-master-crud routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /stats', () => {
    it('returns stats', async () => {
      const app = createApp();
      mocks.getDrugMasterStats.mockResolvedValue({ total: 100, listed: 80, delisted: 20 });

      const res = await request(app).get('/api/admin/drug-master/stats');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(100);
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.getDrugMasterStats.mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/api/admin/drug-master/stats');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('統計情報');
    });
  });

  describe('GET /', () => {
    it('returns paginated list', async () => {
      const app = createApp();
      const selectImpl = createPaginatedQuery(
        [{ id: 1, yjCode: '1111', drugName: '薬A' }],
        1,
      );
      mocks.db.select.mockImplementation(selectImpl);

      const res = await request(app).get('/api/admin/drug-master');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('DB error')),
        }),
      }));

      const res = await request(app).get('/api/admin/drug-master');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('医薬品マスター');
    });
  });

  describe('GET /detail/:yjCode', () => {
    it('returns drug detail', async () => {
      const app = createApp();
      mocks.getDrugDetail.mockResolvedValue({
        yjCode: '1111111F1111',
        drugName: '薬A',
      });

      const res = await request(app).get('/api/admin/drug-master/detail/1111111F1111');

      expect(res.status).toBe(200);
      expect(res.body.yjCode).toBe('1111111F1111');
    });

    it('returns 404 when drug not found', async () => {
      const app = createApp();
      mocks.getDrugDetail.mockResolvedValue(null);

      const res = await request(app).get('/api/admin/drug-master/detail/NONEXIST');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('医薬品が見つかりません');
    });

    it('returns 400 for empty yjCode', async () => {
      const app = createApp();

      const res = await request(app).get('/api/admin/drug-master/detail/' + 'x'.repeat(21));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('無効なYJコード');
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.getDrugDetail.mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/api/admin/drug-master/detail/1111111F1111');

      expect(res.status).toBe(500);
    });
  });

  describe('PUT /detail/:yjCode', () => {
    it('updates drug item', async () => {
      const app = createApp();
      mocks.updateDrugMasterItem.mockResolvedValue({
        yjCode: '1111111F1111',
        drugName: '薬B',
      });

      const res = await request(app)
        .put('/api/admin/drug-master/detail/1111111F1111')
        .send({ drugName: '薬B' });

      expect(res.status).toBe(200);
      expect(res.body.drugName).toBe('薬B');
      expect(mocks.writeLog).toHaveBeenCalled();
    });

    it('returns 400 when no update fields provided', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/admin/drug-master/detail/1111111F1111')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('更新するフィールド');
    });

    it('returns 404 when drug not found for update', async () => {
      const app = createApp();
      mocks.updateDrugMasterItem.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/admin/drug-master/detail/1111111F1111')
        .send({ drugName: '新名前' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('医薬品が見つかりません');
    });

    it('returns 400 for long yjCode', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/admin/drug-master/detail/' + 'x'.repeat(21))
        .send({ drugName: '薬' });

      expect(res.status).toBe(400);
    });

    it('handles various update fields', async () => {
      const app = createApp();
      mocks.updateDrugMasterItem.mockResolvedValue({
        yjCode: '1111111F1111',
        drugName: '薬B',
      });

      const res = await request(app)
        .put('/api/admin/drug-master/detail/1111111F1111')
        .send({
          drugName: '薬B',
          genericName: 'ジェネリック',
          specification: '100mg',
          unit: '錠',
          yakkaPrice: 10.5,
          manufacturer: 'メーカー',
          isListed: true,
          transitionDeadline: '2026-12-31',
        });

      expect(res.status).toBe(200);
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.updateDrugMasterItem.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .put('/api/admin/drug-master/detail/1111111F1111')
        .send({ drugName: '薬' });

      expect(res.status).toBe(500);
    });
  });
});
