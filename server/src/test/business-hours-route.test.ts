import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
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

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import businessHoursRouter from '../routes/business-hours';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/business-hours', businessHoursRouter);
  return app;
}

function createSelectQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createOrderByQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockResolvedValue(result);
  return query;
}

function makeValidHours() {
  return Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    openTime: '09:00',
    closeTime: '18:00',
    isClosed: false,
    is24Hours: false,
  }));
}

describe('business-hours routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns own business hours', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createOrderByQuery([
        { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true, is24Hours: false },
      ]));

      const res = await request(app).get('/api/business-hours');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].dayOfWeek).toBe(0);
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app).get('/api/business-hours');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('営業時間の取得');
    });
  });

  describe('GET /settings', () => {
    it('returns business hour settings', async () => {
      const app = createApp();
      // fetchBusinessHourSettings does 3 parallel queries
      mocks.db.select
        .mockReturnValueOnce(createOrderByQuery([{ dayOfWeek: 0, openTime: '09:00', closeTime: '18:00', isClosed: false, is24Hours: false }]))
        .mockReturnValueOnce(createOrderByQuery([]))
        .mockReturnValueOnce(createSelectQuery([{ version: 1 }]));

      const res = await request(app).get('/api/business-hours/settings');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('hours');
      expect(res.body).toHaveProperty('version');
    });
  });

  describe('PUT /', () => {
    it('returns 400 for non-array hours', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours: 'not-array', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('配列');
    });

    it('returns 400 for wrong number of days', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours: [{ dayOfWeek: 0 }], version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('7日分');
    });

    it('returns 400 for invalid version', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours: makeValidHours(), version: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('バージョン');
    });

    it('returns 400 when isClosed and is24Hours are both true', async () => {
      const app = createApp();
      const hours = makeValidHours();
      hours[0].isClosed = true;
      hours[0].is24Hours = true;

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('同時に設定できません');
    });

    it('returns 400 for same open and close time', async () => {
      const app = createApp();
      const hours = makeValidHours();
      hours[1].openTime = '10:00';
      hours[1].closeTime = '10:00';

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('同じです');
    });

    it('updates business hours successfully', async () => {
      const app = createApp();
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ version: 2 }]),
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return fn(txMock);
      });

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours: makeValidHours(), version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('更新しました');
      expect(res.body.version).toBe(2);
    });

    it('returns 409 on optimistic lock conflict', async () => {
      const app = createApp();
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };
        return fn(txMock);
      });
      // fetchBusinessHourSettings for 409 response
      mocks.db.select
        .mockReturnValueOnce(createOrderByQuery([]))
        .mockReturnValueOnce(createOrderByQuery([]))
        .mockReturnValueOnce(createSelectQuery([{ version: 3 }]));

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours: makeValidHours(), version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('他のデバイス');
    });
  });

  describe('GET /:pharmacyId', () => {
    it('returns business hours for another pharmacy', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createOrderByQuery([
        { dayOfWeek: 0, openTime: '10:00', closeTime: '19:00', isClosed: false, is24Hours: false },
      ]));

      const res = await request(app).get('/api/business-hours/5');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('returns 400 for invalid pharmacy id', async () => {
      const app = createApp();

      const res = await request(app).get('/api/business-hours/abc');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('不正なID');
    });

    it('returns 400 for zero id', async () => {
      const app = createApp();

      const res = await request(app).get('/api/business-hours/0');

      expect(res.status).toBe(400);
    });
  });
});
