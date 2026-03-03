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
  invalidateAuthUserCache: vi.fn(),
  geocodeAddress: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  fetchBusinessHourSettings: vi.fn(),
  validateBusinessHours: vi.fn(),
  validateSpecialBusinessHours: vi.fn(),
  processVerificationCallback: vi.fn(),
  detectChangedReverificationFields: vi.fn(),
  triggerReverification: vi.fn(),
  ReverificationTriggerError: class extends Error { constructor(msg: string) { super(msg); } },
  sendReverificationTriggerErrorResponse: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
  invalidateAuthUserCache: mocks.invalidateAuthUserCache,
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/geocode-service', () => ({
  geocodeAddress: mocks.geocodeAddress,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../routes/business-hours', () => ({
  fetchBusinessHourSettings: mocks.fetchBusinessHourSettings,
  validateBusinessHours: mocks.validateBusinessHours,
  validateSpecialBusinessHours: mocks.validateSpecialBusinessHours,
}));

vi.mock('../services/pharmacy-verification-callback-service', () => ({
  processVerificationCallback: mocks.processVerificationCallback,
}));

vi.mock('../services/pharmacy-verification-service', () => ({
  detectChangedReverificationFields: mocks.detectChangedReverificationFields,
  triggerReverification: mocks.triggerReverification,
  ReverificationTriggerError: mocks.ReverificationTriggerError,
  sendReverificationTriggerErrorResponse: mocks.sendReverificationTriggerErrorResponse,
}));

vi.mock('../utils/validators', () => ({
  emailSchema: {
    safeParse: vi.fn((val: string) => {
      if (val.includes('@')) return { success: true, data: val };
      return { success: false, error: { issues: [{ message: 'メールアドレスが不正です' }] } };
    }),
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import adminRouter from '../routes/admin';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

function createLimitQuery(result: unknown) {
  const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createUpdateQuery(result: unknown[] = [{ id: 1, version: 2 }]) {
  const query = { set: vi.fn(), where: vi.fn(), returning: vi.fn() };
  query.set.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.returning.mockResolvedValue(result);
  return query;
}

describe('admin-pharmacies-detail routes — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectChangedReverificationFields.mockReturnValue([]);
  });

  describe('GET /pharmacies/:id', () => {
    it('returns pharmacy detail', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{
        id: 1, name: 'テスト薬局', email: 'test@example.com', passwordHash: 'secret',
      }]));

      const res = await request(app).get('/api/admin/pharmacies/1');

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('テスト薬局');
      // passwordHash should be excluded
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('returns 404 when pharmacy not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([]));

      const res = await request(app).get('/api/admin/pharmacies/999');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('薬局が見つかりません');
    });

    it('returns 400 for invalid id', async () => {
      const app = createApp();

      const res = await request(app).get('/api/admin/pharmacies/abc');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('不正なID');
    });
  });

  describe('PUT /pharmacies/:id/toggle-active', () => {
    it('toggles pharmacy active status', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{ isActive: true }]));
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const res = await request(app).put('/api/admin/pharmacies/1/toggle-active');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('無効');
    });

    it('returns 404 when pharmacy not found for toggle', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([]));

      const res = await request(app).put('/api/admin/pharmacies/999/toggle-active');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /pharmacies/:id/verify', () => {
    it('approves pharmacy verification', async () => {
      const app = createApp();
      mocks.processVerificationCallback.mockResolvedValue({
        verificationStatus: 'verified',
        pharmacyId: 1,
      });

      const res = await request(app)
        .post('/api/admin/pharmacies/1/verify')
        .send({ approved: true });

      expect(res.status).toBe(200);
      expect(res.body.verificationStatus).toBe('verified');
    });

    it('rejects pharmacy verification', async () => {
      const app = createApp();
      mocks.processVerificationCallback.mockResolvedValue({
        verificationStatus: 'rejected',
        pharmacyId: 1,
      });

      const res = await request(app)
        .post('/api/admin/pharmacies/1/verify')
        .send({ approved: false, reason: '情報不一致' });

      expect(res.status).toBe(200);
      expect(res.body.verificationStatus).toBe('rejected');
    });

    it('returns 400 when approved is not boolean', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/admin/pharmacies/1/verify')
        .send({ approved: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('approved');
    });
  });

  describe('PUT /pharmacies/:id', () => {
    it('returns 400 for invalid version', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/admin/pharmacies/1')
        .send({ name: 'テスト', version: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('バージョン情報');
    });

    it('returns 404 when pharmacy not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([]));

      const res = await request(app)
        .put('/api/admin/pharmacies/999')
        .send({ name: 'テスト', version: 1 });

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid email type', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{
        id: 1, email: 'test@example.com', name: 'テスト', postalCode: '1000001',
        address: '千代田', phone: '03-1234', fax: '03-1234', licenseNumber: 'L-001',
        prefecture: '東京都', isTestAccount: false, testAccountPassword: null, verificationRequestId: null,
      }]));

      const res = await request(app)
        .put('/api/admin/pharmacies/1')
        .send({ email: 123, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('メールアドレスが不正');
    });

    it('updates pharmacy name', async () => {
      const app = createApp();
      const existing = {
        id: 1, email: 'test@example.com', name: 'テスト', postalCode: '1000001',
        address: '千代田', phone: '03-1234', fax: '03-1234', licenseNumber: 'L-001',
        prefecture: '東京都', isTestAccount: false, testAccountPassword: null, verificationRequestId: null,
      };
      mocks.db.select.mockReturnValue(createLimitQuery([existing]));
      mocks.db.update.mockReturnValue(createUpdateQuery([{ id: 1, version: 2 }]));

      const res = await request(app)
        .put('/api/admin/pharmacies/1')
        .send({ name: '新薬局', version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('更新しました');
    });

    it('returns 400 for test account without display password', async () => {
      const app = createApp();
      const existing = {
        id: 1, email: 'test@example.com', name: 'テスト', postalCode: '1000001',
        address: '千代田', phone: '03-1234', fax: '03-1234', licenseNumber: 'L-001',
        prefecture: '東京都', isTestAccount: false, testAccountPassword: null, verificationRequestId: null,
      };
      mocks.db.select.mockReturnValue(createLimitQuery([existing]));

      const res = await request(app)
        .put('/api/admin/pharmacies/1')
        .send({ isTestAccount: true, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('テストアカウント');
    });
  });

  describe('GET /pharmacies/:id/business-hours/settings', () => {
    it('returns business hours settings', async () => {
      const app = createApp();
      mocks.fetchBusinessHourSettings.mockResolvedValue({
        hours: [], specialHours: [], version: 1,
      });

      const res = await request(app).get('/api/admin/pharmacies/1/business-hours/settings');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('hours');
    });

    it('returns 404 when pharmacy not found', async () => {
      const app = createApp();
      mocks.fetchBusinessHourSettings.mockRejectedValue(new Error('薬局が見つかりません'));

      const res = await request(app).get('/api/admin/pharmacies/999/business-hours/settings');

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /pharmacies/:id/business-hours', () => {
    it('returns 400 for invalid business hours', async () => {
      const app = createApp();
      mocks.validateBusinessHours.mockReturnValue({ error: '7日分の営業時間を指定してください' });

      const res = await request(app)
        .put('/api/admin/pharmacies/1/business-hours')
        .send({ hours: [], version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('7日分');
    });

    it('returns 400 for invalid special hours', async () => {
      const app = createApp();
      mocks.validateBusinessHours.mockReturnValue({ valid: [] });
      mocks.validateSpecialBusinessHours.mockReturnValue({ error: '特例営業時間のフォーマットが不正です' });

      const res = await request(app)
        .put('/api/admin/pharmacies/1/business-hours')
        .send({ hours: [], specialHours: 'bad', version: 1 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid version', async () => {
      const app = createApp();
      mocks.validateBusinessHours.mockReturnValue({ valid: [] });
      mocks.validateSpecialBusinessHours.mockReturnValue({ valid: [], provided: false });

      const res = await request(app)
        .put('/api/admin/pharmacies/1/business-hours')
        .send({ hours: [], version: 'bad' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('バージョン');
    });
  });
});
