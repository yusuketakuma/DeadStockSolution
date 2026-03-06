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

vi.mock('../config/database', () => ({ db: mocks.db }));

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

const BASE_PHARMACY = {
  id: 10, email: 'pharmacy@example.com', name: 'テスト薬局', postalCode: '1000001',
  address: '千代田1-1', phone: '03-1234-5678', fax: '03-1234-5679', licenseNumber: 'L-001',
  prefecture: '東京都', isTestAccount: false, testAccountPassword: null, verificationRequestId: null,
};

describe('admin-pharmacies-detail routes — deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectChangedReverificationFields.mockReturnValue([]);
  });

  describe('GET /pharmacies/:id — error handling', () => {
    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app).get('/api/admin/pharmacies/1');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('薬局情報の取得に失敗');
    });
  });

  describe('GET /pharmacies/:id/business-hours/settings — error handling', () => {
    it('returns 400 for invalid id', async () => {
      const app = createApp();

      const res = await request(app).get('/api/admin/pharmacies/abc/business-hours/settings');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('不正なID');
    });

    it('returns 500 on general error', async () => {
      const app = createApp();
      mocks.fetchBusinessHourSettings.mockRejectedValue(new Error('General error'));

      const res = await request(app).get('/api/admin/pharmacies/1/business-hours/settings');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('営業時間設定の取得に失敗');
    });
  });

  describe('PUT /pharmacies/:id — email conflict', () => {
    it('returns 409 when email is already taken by another pharmacy', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([BASE_PHARMACY]))
        .mockReturnValueOnce(createLimitQuery([{ id: 999 }]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ email: 'taken@example.com', version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('メールアドレスは既に登録');
    });

    it('allows updating email to same pharmacy (no conflict)', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([BASE_PHARMACY]))
        .mockReturnValueOnce(createLimitQuery([{ id: 10 }]));
      mocks.db.update.mockReturnValue(createUpdateQuery([{ id: 10, version: 2 }]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ email: 'pharmacy@example.com', version: 1 });

      expect(res.status).toBe(200);
    });
  });

  describe('PUT /pharmacies/:id — licenseNumber conflict', () => {
    it('returns 409 when licenseNumber is taken by another pharmacy', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([BASE_PHARMACY]))
        .mockReturnValueOnce(createLimitQuery([{ id: 999 }]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ licenseNumber: 'TAKEN-001', version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('薬局開設許可番号は既に登録');
    });
  });

  describe('PUT /pharmacies/:id — field validations', () => {
    it('returns 400 for invalid name (empty)', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ name: '', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('薬局名');
    });

    it('returns 400 for invalid postalCode', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ postalCode: '123', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('郵便番号');
    });

    it('returns 400 for non-string postalCode', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ postalCode: 1234567, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('郵便番号');
    });

    it('returns 400 for invalid address', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ address: '', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('住所');
    });

    it('returns 400 for invalid phone', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ phone: '', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('電話番号');
    });

    it('returns 400 for invalid fax', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ fax: '', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('FAX');
    });

    it('returns 400 for invalid licenseNumber', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ licenseNumber: '', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('薬局開設許可番号');
    });

    it('returns 400 for invalid prefecture', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ prefecture: '', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('都道府県');
    });

    it('returns 400 for invalid isActive type', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ isActive: 'yes', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('有効状態フラグ');
    });

    it('returns 400 for invalid isTestAccount type', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ isTestAccount: 'yes', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('テストアカウントフラグ');
    });

    it('returns 400 for non-string testAccountPassword', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ testAccountPassword: 123, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('表示用パスワードが不正');
    });

    it('returns 400 for too long testAccountPassword', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ testAccountPassword: 'a'.repeat(101), version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('100文字以内');
    });

    it('sets testAccountPassword to null when empty string', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));
      mocks.db.update.mockReturnValue(createUpdateQuery([{ id: 10, version: 2 }]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ testAccountPassword: '', version: 1 });

      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid email format', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ email: 'invalid-email', version: 1 });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /pharmacies/:id — geocode on address/prefecture change', () => {
    it('geocodes when address changes', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));
      mocks.geocodeAddress.mockResolvedValue({ lat: 35.0, lng: 139.0 });
      mocks.db.update.mockReturnValue(createUpdateQuery([{ id: 10, version: 2 }]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ address: '新宿1-1-1', version: 1 });

      expect(res.status).toBe(200);
      expect(mocks.geocodeAddress).toHaveBeenCalled();
    });

    it('returns 400 when geocode fails', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));
      mocks.geocodeAddress.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ address: '不明な住所', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('位置情報を特定できません');
    });
  });

  describe('PUT /pharmacies/:id — optimistic lock conflict', () => {
    it('returns 409 on version conflict', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([BASE_PHARMACY]))
        .mockReturnValueOnce(createLimitQuery([{ ...BASE_PHARMACY, version: 5 }]));
      mocks.db.update.mockReturnValue(createUpdateQuery([]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ name: '新名前', version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('他のデバイス');
    });

    it('returns 404 when pharmacy deleted during optimistic lock check', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([BASE_PHARMACY]))
        .mockReturnValueOnce(createLimitQuery([]));
      mocks.db.update.mockReturnValue(createUpdateQuery([]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ name: '新名前', version: 1 });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /pharmacies/:id — reverification trigger', () => {
    it('triggers reverification when relevant fields change', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));
      mocks.detectChangedReverificationFields.mockReturnValue(['name']);
      mocks.db.update.mockReturnValue(createUpdateQuery([{ id: 10, version: 2 }]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ name: '変更薬局', version: 1 });

      expect(res.status).toBe(200);
      expect(mocks.triggerReverification).toHaveBeenCalled();
    });

    it('handles ReverificationTriggerError', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));
      mocks.detectChangedReverificationFields.mockReturnValue(['name']);
      mocks.db.update.mockReturnValue(createUpdateQuery([{ id: 10, version: 2 }]));
      mocks.triggerReverification.mockRejectedValue(new mocks.ReverificationTriggerError('fail'));
      mocks.sendReverificationTriggerErrorResponse.mockImplementation((res: { status: (code: number) => { json: (body: unknown) => void } }) => {
        res.status(500).json({ error: '再審査依頼の登録に失敗しました' });
      });

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ name: '変更薬局', version: 1 });

      expect(res.status).toBe(500);
      expect(mocks.sendReverificationTriggerErrorResponse).toHaveBeenCalled();
    });

    it('returns 500 on general update error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ name: '新名前', version: 1 });

      expect(res.status).toBe(500);
    });
  });

  describe('PUT /pharmacies/:id — test account logic', () => {
    it('clears testAccountPassword when isTestAccount is set to false', async () => {
      const app = createApp();
      const testPharmacy = { ...BASE_PHARMACY, isTestAccount: true, testAccountPassword: 'pass123' };
      mocks.db.select.mockReturnValue(createLimitQuery([testPharmacy]));
      mocks.db.update.mockReturnValue(createUpdateQuery([{ id: 10, version: 2 }]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ isTestAccount: false, version: 1 });

      expect(res.status).toBe(200);
    });

    it('updates test account with display password', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_PHARMACY]));
      mocks.db.update.mockReturnValue(createUpdateQuery([{ id: 10, version: 2 }]));

      const res = await request(app)
        .put('/api/admin/pharmacies/10')
        .send({ isTestAccount: true, testAccountPassword: 'pass123', version: 1 });

      expect(res.status).toBe(200);
    });
  });

  describe('PUT /pharmacies/:id/toggle-active — error handling', () => {
    it('returns 400 for invalid id', async () => {
      const app = createApp();

      const res = await request(app).put('/api/admin/pharmacies/abc/toggle-active');

      expect(res.status).toBe(400);
    });

    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app).put('/api/admin/pharmacies/1/toggle-active');

      expect(res.status).toBe(500);
    });

    it('toggles inactive pharmacy to active', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{ isActive: false }]));
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const res = await request(app).put('/api/admin/pharmacies/1/toggle-active');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('有効');
    });
  });

  describe('POST /pharmacies/:id/verify — edge cases', () => {
    it('returns 400 for invalid id', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/admin/pharmacies/abc/verify')
        .send({ approved: true });

      expect(res.status).toBe(400);
    });

    it('returns 500 on verification callback error', async () => {
      const app = createApp();
      mocks.processVerificationCallback.mockRejectedValue(new Error('Callback failed'));

      const res = await request(app)
        .post('/api/admin/pharmacies/1/verify')
        .send({ approved: true });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('審査処理に失敗');
    });

    it('approves with custom reason', async () => {
      const app = createApp();
      mocks.processVerificationCallback.mockResolvedValue({
        verificationStatus: 'verified',
        pharmacyId: 1,
      });

      const res = await request(app)
        .post('/api/admin/pharmacies/1/verify')
        .send({ approved: true, reason: 'カスタム理由' });

      expect(res.status).toBe(200);
    });
  });

  describe('PUT /pharmacies/:id/business-hours — transaction flow', () => {
    it('returns 404 when pharmacy not found for business hours update', async () => {
      const app = createApp();
      mocks.validateBusinessHours.mockReturnValue({ valid: [] });
      mocks.validateSpecialBusinessHours.mockReturnValue({ valid: [], provided: false });
      mocks.db.select.mockReturnValue(createLimitQuery([]));

      const res = await request(app)
        .put('/api/admin/pharmacies/999/business-hours')
        .send({ hours: [], version: 1 });

      expect(res.status).toBe(404);
    });

    it('handles conflict during business hours transaction', async () => {
      const app = createApp();
      mocks.validateBusinessHours.mockReturnValue({ valid: [{ dayOfWeek: 0, openTime: '09:00', closeTime: '18:00', isClosed: false, is24Hours: false }] });
      mocks.validateSpecialBusinessHours.mockReturnValue({ valid: [], provided: false });
      mocks.db.select.mockReturnValue(createLimitQuery([{ id: 1 }]));
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
      mocks.fetchBusinessHourSettings.mockResolvedValue({ hours: [], specialHours: [], version: 5 });

      const res = await request(app)
        .put('/api/admin/pharmacies/1/business-hours')
        .send({ hours: [], version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('他のデバイス');
    });

    it('updates business hours with special hours', async () => {
      const app = createApp();
      mocks.validateBusinessHours.mockReturnValue({
        valid: [{ dayOfWeek: 0, openTime: '09:00', closeTime: '18:00', isClosed: false, is24Hours: false }],
      });
      mocks.validateSpecialBusinessHours.mockReturnValue({
        valid: [{ specialType: 'holiday_closed', startDate: '2026-01-01', endDate: '2026-01-01', openTime: null, closeTime: null, isClosed: true, is24Hours: false, note: null }],
        provided: true,
      });
      mocks.db.select.mockReturnValue(createLimitQuery([{ id: 1 }]));
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ version: 3 }]),
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
        .put('/api/admin/pharmacies/1/business-hours')
        .send({ hours: [], specialHours: [], version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('営業時間を更新');
    });

    it('returns 500 on business hours update error', async () => {
      const app = createApp();
      mocks.validateBusinessHours.mockReturnValue({ valid: [] });
      mocks.validateSpecialBusinessHours.mockReturnValue({ valid: [], provided: false });
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app)
        .put('/api/admin/pharmacies/1/business-hours')
        .send({ hours: [], version: 1 });

      expect(res.status).toBe(500);
    });
  });
});
