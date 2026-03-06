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

vi.mock('../config/database', () => ({ db: mocks.db }));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import businessHoursRouter from '../routes/business-hours';
import { createAuthenticatedApp } from './helpers/mock-builders';

function createApp() {
  return createAuthenticatedApp('/api/business-hours', businessHoursRouter);
}

function createSelectQuery(result: unknown) {
  const query = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn() };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createOrderByQuery(result: unknown) {
  const query = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn() };
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

describe('business-hours routes — deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /settings — error handling', () => {
    it('returns 500 on fetchBusinessHourSettings error', async () => {
      const app = createApp();
      // simulate error in one of the parallel queries while the others resolve
      mocks.db.select
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockRejectedValue(new Error('DB error')),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ version: 1 }]),
            }),
          }),
        });

      const res = await request(app).get('/api/business-hours/settings');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('営業時間設定の取得に失敗');
    });
  });

  describe('PUT / — special hours validation', () => {
    it('returns 400 for non-array specialHours', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours: makeValidHours(), specialHours: 'not-array', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('特例営業時間は配列');
    });

    it('returns 400 when specialHours exceeds 120 items', async () => {
      const app = createApp();
      const tooMany = Array.from({ length: 121 }, () => ({}));

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours: makeValidHours(), specialHours: tooMany, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('120件以内');
    });

    it('returns 400 for non-object item in specialHours', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours: makeValidHours(), specialHours: ['bad'], version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('フォーマットが不正');
    });

    it('returns 400 for invalid specialType', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'invalid_type',
            startDate: '2026-01-01', endDate: '2026-01-01',
            isClosed: true, is24Hours: false,
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('種別が不正');
    });

    it('returns 400 for invalid startDate format', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'holiday_closed',
            startDate: '2026/01/01', endDate: '2026-01-01',
            isClosed: true, is24Hours: false,
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('開始日が不正');
    });

    it('returns 400 for invalid endDate format', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'holiday_closed',
            startDate: '2026-01-01', endDate: 'bad-date',
            isClosed: true, is24Hours: false,
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('終了日が不正');
    });

    it('returns 400 when startDate > endDate', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'holiday_closed',
            startDate: '2026-02-01', endDate: '2026-01-01',
            isClosed: true, is24Hours: false,
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('順序が不正');
    });

    it('returns 400 for non-boolean isClosed in special hours', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'holiday_closed',
            startDate: '2026-01-01', endDate: '2026-01-01',
            isClosed: 'yes', is24Hours: false,
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('フラグが不正');
    });

    it('returns 400 when isClosed and is24Hours both true in special hours', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'special_open',
            startDate: '2026-01-01', endDate: '2026-01-01',
            isClosed: true, is24Hours: true,
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('休業日と24時間営業は同時に指定できません');
    });

    it('returns 400 for holiday type that is not closed', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'holiday_closed',
            startDate: '2026-01-01', endDate: '2026-01-01',
            isClosed: false, is24Hours: false,
            openTime: '09:00', closeTime: '18:00',
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('休業系の特例営業時間は休業設定のみ');
    });

    it('returns 400 for special_open with invalid openTime', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'special_open',
            startDate: '2026-01-01', endDate: '2026-01-01',
            isClosed: false, is24Hours: false,
            openTime: 'bad', closeTime: '18:00',
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('開店時間が不正');
    });

    it('returns 400 for special_open with invalid closeTime', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'special_open',
            startDate: '2026-01-01', endDate: '2026-01-01',
            isClosed: false, is24Hours: false,
            openTime: '09:00', closeTime: 'bad',
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('閉店時間が不正');
    });

    it('returns 400 for special_open with same open and close time', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'special_open',
            startDate: '2026-01-01', endDate: '2026-01-01',
            isClosed: false, is24Hours: false,
            openTime: '10:00', closeTime: '10:00',
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('同じです');
    });

    it('returns 400 for non-string note', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'holiday_closed',
            startDate: '2026-01-01', endDate: '2026-01-01',
            isClosed: true, is24Hours: false,
            note: 123,
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('メモが不正');
    });

    it('returns 400 for too long note', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'holiday_closed',
            startDate: '2026-01-01', endDate: '2026-01-01',
            isClosed: true, is24Hours: false,
            note: 'a'.repeat(201),
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('200文字以内');
    });
  });

  describe('PUT / — weekly hours validation edge cases', () => {
    it('returns 400 for null item in hours', async () => {
      const app = createApp();
      const hours = makeValidHours();
      hours[2] = null as unknown as typeof hours[0];

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('フォーマットが不正');
    });

    it('returns 400 for invalid dayOfWeek', async () => {
      const app = createApp();
      const hours = makeValidHours();
      hours[3].dayOfWeek = 7;

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('曜日の値が不正');
    });

    it('returns 400 for non-boolean isClosed', async () => {
      const app = createApp();
      const hours = makeValidHours();
      (hours[0] as Record<string, unknown>).isClosed = 'yes';

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('営業フラグが不正');
    });

    it('handles isClosed day (null times)', async () => {
      const app = createApp();
      const hours = makeValidHours();
      hours[0] = { dayOfWeek: 0, openTime: '09:00', closeTime: '18:00', isClosed: true, is24Hours: false };

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
        .send({ hours, version: 1 });

      expect(res.status).toBe(200);
    });

    it('handles is24Hours day (null times)', async () => {
      const app = createApp();
      const hours = makeValidHours();
      hours[1] = { dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false, is24Hours: true };

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
        .send({ hours, version: 1 });

      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid openTime format', async () => {
      const app = createApp();
      const hours = makeValidHours();
      hours[2].openTime = '9:00';

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('開店時間が不正');
    });

    it('returns 400 for invalid closeTime format', async () => {
      const app = createApp();
      const hours = makeValidHours();
      hours[3].closeTime = '25:00';

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('閉店時間が不正');
    });

    it('returns 400 for duplicate days', async () => {
      const app = createApp();
      const hours = makeValidHours();
      hours[6].dayOfWeek = 0; // duplicate with hours[0]

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('曜日が重複');
    });
  });

  describe('PUT / — with special hours in transaction', () => {
    it('saves special hours with valid special_open entry', async () => {
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
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'special_open',
            startDate: '2026-03-15',
            endDate: '2026-03-15',
            isClosed: false,
            is24Hours: false,
            openTime: '10:00',
            closeTime: '15:00',
            note: '特別営業日',
          }],
          version: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('更新しました');
    });

    it('saves special hours with 24h special_open entry', async () => {
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
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'special_open',
            startDate: '2026-03-15',
            endDate: '2026-03-15',
            isClosed: false,
            is24Hours: true,
          }],
          version: 1,
        });

      expect(res.status).toBe(200);
    });

    it('saves empty special hours array (provided but empty)', async () => {
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
        .send({
          hours: makeValidHours(),
          specialHours: [],
          version: 1,
        });

      expect(res.status).toBe(200);
    });
  });

  describe('PUT / — 500 on transaction error', () => {
    it('returns 500 when transaction throws', async () => {
      const app = createApp();
      mocks.db.transaction.mockRejectedValue(new Error('Transaction failed'));

      const res = await request(app)
        .put('/api/business-hours')
        .send({ hours: makeValidHours(), version: 1 });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('営業時間の更新に失敗');
    });
  });

  describe('GET /:pharmacyId — error handling', () => {
    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app).get('/api/business-hours/5');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('営業時間の取得に失敗');
    });

    it('returns 400 for negative pharmacy id', async () => {
      const app = createApp();

      const res = await request(app).get('/api/business-hours/-1');

      expect(res.status).toBe(400);
    });
  });

  describe('special hours — invalid date (non-existent)', () => {
    it('returns 400 for non-existent date like Feb 30', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/business-hours')
        .send({
          hours: makeValidHours(),
          specialHours: [{
            specialType: 'holiday_closed',
            startDate: '2026-02-30', endDate: '2026-02-30',
            isClosed: true, is24Hours: false,
          }],
          version: 1,
        });

      expect(res.status).toBe(400);
    });
  });
});
