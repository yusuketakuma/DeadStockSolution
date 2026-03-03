import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  generateToken: vi.fn(),
  deriveSessionVersion: vi.fn(),
  invalidateAuthUserCache: vi.fn(),
  geocodeAddress: vi.fn(),
  detectChangedReverificationFields: vi.fn(),
  triggerReverification: vi.fn(),
  ReverificationTriggerError: class extends Error { constructor(msg: string) { super(msg); } },
  sendReverificationTriggerErrorResponse: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  clearCsrfCookie: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
  invalidateAuthUserCache: mocks.invalidateAuthUserCache,
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/auth-service', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
  generateToken: mocks.generateToken,
  deriveSessionVersion: mocks.deriveSessionVersion,
}));

vi.mock('../services/geocode-service', () => ({
  geocodeAddress: mocks.geocodeAddress,
}));

vi.mock('../services/pharmacy-verification-service', () => ({
  detectChangedReverificationFields: mocks.detectChangedReverificationFields,
  triggerReverification: mocks.triggerReverification,
  ReverificationTriggerError: mocks.ReverificationTriggerError,
  sendReverificationTriggerErrorResponse: mocks.sendReverificationTriggerErrorResponse,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../middleware/csrf', () => ({
  clearCsrfCookie: mocks.clearCsrfCookie,
}));

vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
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
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import accountRouter from '../routes/account';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/account', accountRouter);
  return app;
}

function createLimitQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createUpdateQuery(result: unknown[] = [{ id: 1, version: 2, email: 'test@example.com', isAdmin: false, isActive: true, passwordHash: 'hash' }]) {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.returning.mockResolvedValue(result);
  return query;
}

describe('account routes — additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectChangedReverificationFields.mockReturnValue([]);
    mocks.generateToken.mockReturnValue('new-token');
    mocks.deriveSessionVersion.mockReturnValue('sv1');
  });

  describe('GET /', () => {
    it('returns account info', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{
        id: 1,
        email: 'test@example.com',
        name: 'テスト薬局',
        postalCode: '1000001',
        address: '千代田1-1',
        phone: '03-1234-5678',
        fax: '03-1234-5679',
        licenseNumber: 'PHARM-001',
        prefecture: '東京都',
        isAdmin: false,
        isTestAccount: false,
        matchingAutoNotifyEnabled: true,
        version: 1,
        createdAt: '2026-01-01',
      }]));

      const res = await request(app).get('/api/account');

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('test@example.com');
    });

    it('returns 404 when account not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([]));

      const res = await request(app).get('/api/account');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('アカウントが見つかりません');
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

      const res = await request(app).get('/api/account');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('アカウント情報の取得に失敗');
    });
  });

  describe('PUT /', () => {
    it('returns 400 for missing version', async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/account')
        .send({ name: 'テスト' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('バージョン情報');
    });

    it('returns 400 for invalid email', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{
        id: 1,
        email: 'test@example.com',
        name: 'テスト',
        postalCode: '1000001',
        address: '千代田1-1',
        phone: '03-1234',
        fax: '03-1234',
        licenseNumber: 'L-001',
        prefecture: '東京都',
        isTestAccount: false,
        testAccountPassword: null,
        verificationRequestId: null,
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ email: 'invalid', version: 1 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid name', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{
        id: 1,
        email: 'test@example.com',
        name: 'テスト',
        postalCode: '1000001',
        address: '千代田1-1',
        phone: '03-1234',
        fax: '03-1234',
        licenseNumber: 'L-001',
        prefecture: '東京都',
        isTestAccount: false,
        testAccountPassword: null,
        verificationRequestId: null,
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ name: '', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('薬局名');
    });

    it('returns 400 for invalid postal code', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{
        id: 1, email: 'test@example.com', name: 'テスト', postalCode: '1000001',
        address: '千代田', phone: '03-1234', fax: '03-1234', licenseNumber: 'L-001',
        prefecture: '東京都', isTestAccount: false, testAccountPassword: null, verificationRequestId: null,
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ postalCode: '123', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('郵便番号');
    });

    it('returns 400 when new password is too short', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{
        id: 1, email: 'test@example.com', name: 'テスト', postalCode: '1000001',
        address: '千代田', phone: '03-1234', fax: '03-1234', licenseNumber: 'L-001',
        prefecture: '東京都', isTestAccount: false, testAccountPassword: null, verificationRequestId: null,
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ newPassword: 'short', currentPassword: 'current', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('パスワード');
    });

    it('returns 400 when current password is missing for password change', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{
        id: 1, email: 'test@example.com', name: 'テスト', postalCode: '1000001',
        address: '千代田', phone: '03-1234', fax: '03-1234', licenseNumber: 'L-001',
        prefecture: '東京都', isTestAccount: false, testAccountPassword: null, verificationRequestId: null,
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ newPassword: 'NewPassword123', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('現在のパスワードを入力');
    });

    it('returns 409 on optimistic lock conflict', async () => {
      const app = createApp();
      const accountRow = {
        id: 1, email: 'test@example.com', name: 'テスト', postalCode: '1000001',
        address: '千代田', phone: '03-1234', fax: '03-1234', licenseNumber: 'L-001',
        prefecture: '東京都', isTestAccount: false, testAccountPassword: null, verificationRequestId: null,
      };
      // First select for account fetch
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([accountRow]))
        .mockReturnValueOnce(createLimitQuery([{ ...accountRow, version: 3 }]));

      // Update returns empty (conflict)
      mocks.db.update.mockReturnValue(createUpdateQuery([]));

      const res = await request(app)
        .put('/api/account')
        .send({ name: '新名前', version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('他のデバイス');
    });

    it('updates account name successfully', async () => {
      const app = createApp();
      const accountRow = {
        id: 1, email: 'test@example.com', name: 'テスト', postalCode: '1000001',
        address: '千代田', phone: '03-1234', fax: '03-1234', licenseNumber: 'L-001',
        prefecture: '東京都', isTestAccount: false, testAccountPassword: null, verificationRequestId: null,
      };
      mocks.db.select.mockReturnValue(createLimitQuery([accountRow]));
      mocks.db.update.mockReturnValue(createUpdateQuery([{
        id: 1, version: 2, email: 'test@example.com', isAdmin: false, isActive: true, passwordHash: 'hash',
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ name: '新薬局', version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('更新しました');
    });
  });

  describe('DELETE /', () => {
    it('returns 400 when currentPassword is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .delete('/api/account')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('現在のパスワードが必要');
    });

    it('returns 404 when account not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([]));

      const res = await request(app)
        .delete('/api/account')
        .send({ currentPassword: 'password123' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('アカウントが見つかりません');
    });

    it('returns 400 when current password is wrong', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{ passwordHash: 'hashed' }]));
      mocks.verifyPassword.mockResolvedValue(false);

      const res = await request(app)
        .delete('/api/account')
        .send({ currentPassword: 'wrong' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('パスワードが正しくありません');
    });

    it('deactivates account successfully', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{ passwordHash: 'hashed' }]));
      mocks.verifyPassword.mockResolvedValue(true);
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const res = await request(app)
        .delete('/api/account')
        .send({ currentPassword: 'correct' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('無効化しました');
    });
  });
});
