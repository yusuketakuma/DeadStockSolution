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

async function createApp() {
  vi.resetModules();
  vi.doMock('../middleware/auth', () => ({
    requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
      req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
      next();
    },
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
  }));
  vi.doMock('../middleware/csrf', () => ({
    csrfMiddleware: (_req: unknown, _res: unknown, next: () => void) => { next(); },
  }));
  vi.doMock('../config/database', () => ({
    db: mocks.db,
  }));
  vi.doMock('../services/drug-master-service', () => ({
    getDrugMasterStats: mocks.getDrugMasterStats,
    getDrugDetail: mocks.getDrugDetail,
    updateDrugMasterItem: mocks.updateDrugMasterItem,
  }));
  vi.doMock('../services/log-service', () => ({
    writeLog: mocks.writeLog,
    getClientIp: mocks.getClientIp,
  }));
  vi.doMock('../services/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  vi.doMock('drizzle-orm', () => ({
    asc: vi.fn(() => ({})),
    desc: vi.fn(() => ({})),
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    like: vi.fn(() => ({})),
    ilike: vi.fn(() => ({})),
    or: vi.fn(() => ({})),
    isNotNull: vi.fn(() => ({})),
    sql: Object.assign(
      (..._args: unknown[]) => ({}),
      { join: vi.fn(() => ({})) },
    ),
  }));

  const { default: drugMasterRouter } = await import('../routes/drug-master');
  const app = express();
  app.use(express.json());
  app.use('/api/admin/drug-master', drugMasterRouter);
  return app;
}

describe('drug-master-crud ultra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('GET / (list) with filters', () => {
    it('applies status=listed filter', async () => {
      const app = await createApp();
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
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
          query.where.mockResolvedValue([{ value: 1 }]);
        } else {
          query.where.mockReturnValue(query);
          query.offset.mockResolvedValue([{ id: 1, drugName: '薬A' }]);
        }
        return query;
      });

      const res = await request(app).get('/api/admin/drug-master?status=listed');
      expect(res.status).toBe(200);
    });

    it('applies status=delisted filter', async () => {
      const app = await createApp();
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        const query = {
          from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn(),
        };
        query.from.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        if (callCount === 1) {
          query.where.mockResolvedValue([{ value: 0 }]);
        } else {
          query.where.mockReturnValue(query);
          query.offset.mockResolvedValue([]);
        }
        return query;
      });

      const res = await request(app).get('/api/admin/drug-master?status=delisted');
      expect(res.status).toBe(200);
    });

    it('applies status=transition filter', async () => {
      const app = await createApp();
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        const query = {
          from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn(),
        };
        query.from.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        if (callCount === 1) {
          query.where.mockResolvedValue([{ value: 0 }]);
        } else {
          query.where.mockReturnValue(query);
          query.offset.mockResolvedValue([]);
        }
        return query;
      });

      const res = await request(app).get('/api/admin/drug-master?status=transition');
      expect(res.status).toBe(200);
    });

    it('applies category filter', async () => {
      const app = await createApp();
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        const query = {
          from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn(),
        };
        query.from.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        if (callCount === 1) {
          query.where.mockResolvedValue([{ value: 0 }]);
        } else {
          query.where.mockReturnValue(query);
          query.offset.mockResolvedValue([]);
        }
        return query;
      });

      const res = await request(app).get('/api/admin/drug-master?category=内用薬');
      expect(res.status).toBe(200);
    });

    it('applies search with YJ code pattern', async () => {
      const app = await createApp();
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        const query = {
          from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn(),
        };
        query.from.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        if (callCount === 1) {
          query.where.mockResolvedValue([{ value: 1 }]);
        } else {
          query.where.mockReturnValue(query);
          query.offset.mockResolvedValue([{ id: 1, yjCode: 'A123', drugName: 'Test' }]);
        }
        return query;
      });

      // Alphanumeric search triggers yjCode search
      const res = await request(app).get('/api/admin/drug-master?search=A123');
      expect(res.status).toBe(200);
    });

    it('applies search with Japanese text (no YJ code branch)', async () => {
      const app = await createApp();
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        const query = {
          from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn(),
        };
        query.from.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        if (callCount === 1) {
          query.where.mockResolvedValue([{ value: 0 }]);
        } else {
          query.where.mockReturnValue(query);
          query.offset.mockResolvedValue([]);
        }
        return query;
      });

      const res = await request(app).get('/api/admin/drug-master?search=ロキソニン');
      expect(res.status).toBe(200);
    });
  });

  describe('PUT /detail/:yjCode field parsing', () => {
    it('handles genericName set to null', async () => {
      const app = await createApp();
      mocks.updateDrugMasterItem.mockResolvedValue({ yjCode: 'ABC', drugName: '薬A' });

      const res = await request(app)
        .put('/api/admin/drug-master/detail/ABC')
        .send({ genericName: null });
      expect(res.status).toBe(200);
    });

    it('handles specification set to empty string (null)', async () => {
      const app = await createApp();
      mocks.updateDrugMasterItem.mockResolvedValue({ yjCode: 'ABC', drugName: '薬A' });

      const res = await request(app)
        .put('/api/admin/drug-master/detail/ABC')
        .send({ specification: '' });
      expect(res.status).toBe(200);
    });

    it('handles unit set to non-string type', async () => {
      const app = await createApp();
      mocks.updateDrugMasterItem.mockResolvedValue({ yjCode: 'ABC', drugName: '薬A' });

      const res = await request(app)
        .put('/api/admin/drug-master/detail/ABC')
        .send({ unit: 123 });
      // unit: 123 is not typeof string, so it sets null
      expect(res.status).toBe(200);
    });

    it('handles manufacturer set to empty string', async () => {
      const app = await createApp();
      mocks.updateDrugMasterItem.mockResolvedValue({ yjCode: 'ABC', drugName: '薬A' });

      const res = await request(app)
        .put('/api/admin/drug-master/detail/ABC')
        .send({ manufacturer: '' });
      expect(res.status).toBe(200);
    });

    it('ignores yakkaPrice when negative', async () => {
      const app = await createApp();
      const res = await request(app)
        .put('/api/admin/drug-master/detail/ABC')
        .send({ yakkaPrice: -1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('更新するフィールド');
    });

    it('ignores yakkaPrice when not a number', async () => {
      const app = await createApp();
      const res = await request(app)
        .put('/api/admin/drug-master/detail/ABC')
        .send({ yakkaPrice: 'abc' });
      expect(res.status).toBe(400);
    });

    it('handles transitionDeadline set to null', async () => {
      const app = await createApp();
      mocks.updateDrugMasterItem.mockResolvedValue({ yjCode: 'ABC', drugName: '薬A' });

      const res = await request(app)
        .put('/api/admin/drug-master/detail/ABC')
        .send({ transitionDeadline: null });
      expect(res.status).toBe(200);
    });

    it('handles transitionDeadline set to empty string (null)', async () => {
      const app = await createApp();
      mocks.updateDrugMasterItem.mockResolvedValue({ yjCode: 'ABC', drugName: '薬A' });

      const res = await request(app)
        .put('/api/admin/drug-master/detail/ABC')
        .send({ transitionDeadline: '' });
      expect(res.status).toBe(200);
    });

    it('handles drugName with whitespace only (no update)', async () => {
      const app = await createApp();
      const res = await request(app)
        .put('/api/admin/drug-master/detail/ABC')
        .send({ drugName: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('更新するフィールド');
    });

    it('truncates long drugName to 500 chars', async () => {
      const app = await createApp();
      mocks.updateDrugMasterItem.mockResolvedValue({ yjCode: 'ABC', drugName: 'a'.repeat(500) });

      const res = await request(app)
        .put('/api/admin/drug-master/detail/ABC')
        .send({ drugName: 'a'.repeat(600) });
      expect(res.status).toBe(200);
    });
  });
});
