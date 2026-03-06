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

vi.mock('../config/database', () => ({ db: mocks.db }));

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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
  const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createUpdateQuery(result: unknown[] = [{ id: 1, version: 2, email: 'test@example.com', isAdmin: false, isActive: true, passwordHash: 'hash' }]) {
  const query = { set: vi.fn(), where: vi.fn(), returning: vi.fn() };
  query.set.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.returning.mockResolvedValue(result);
  return query;
}

const BASE_ACCOUNT = {
  id: 1, email: 'test@example.com', name: 'テスト', postalCode: '1000001',
  address: '千代田1-1', phone: '03-1234-5678', fax: '03-1234-5679', licenseNumber: 'L-001',
  prefecture: '東京都', isTestAccount: false, testAccountPassword: null, verificationRequestId: null,
};

const TEST_ACCOUNT = {
  ...BASE_ACCOUNT,
  isTestAccount: true,
  testAccountPassword: 'testpass',
};

describe('account routes — deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectChangedReverificationFields.mockReturnValue([]);
    mocks.generateToken.mockReturnValue('new-token');
    mocks.deriveSessionVersion.mockReturnValue('sv1');
  });

  describe('PUT / — password change flow', () => {
    it('changes password successfully', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([BASE_ACCOUNT]))
        .mockReturnValueOnce(createLimitQuery([{ passwordHash: 'old-hash' }]));
      mocks.verifyPassword.mockResolvedValue(true);
      mocks.hashPassword.mockResolvedValue('new-hash');
      mocks.db.update.mockReturnValue(createUpdateQuery([{
        id: 1, version: 2, email: 'test@example.com', isAdmin: false, isActive: true, passwordHash: 'new-hash',
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ newPassword: 'NewPassword123', currentPassword: 'OldPassword123', version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('更新しました');
      expect(mocks.hashPassword).toHaveBeenCalledWith('NewPassword123');
    });

    it('returns 400 when current password is wrong during password change', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([BASE_ACCOUNT]))
        .mockReturnValueOnce(createLimitQuery([{ passwordHash: 'old-hash' }]));
      mocks.verifyPassword.mockResolvedValue(false);

      const res = await request(app)
        .put('/api/account')
        .send({ newPassword: 'NewPassword123', currentPassword: 'WrongPassword', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('パスワードが正しくありません');
    });

    it('returns 404 when account not found during password change', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([BASE_ACCOUNT]))
        .mockReturnValueOnce(createLimitQuery([]));

      const res = await request(app)
        .put('/api/account')
        .send({ newPassword: 'NewPassword123', currentPassword: 'OldPassword', version: 1 });

      expect(res.status).toBe(404);
    });

    it('updates testAccountPassword when changing password on test account', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([TEST_ACCOUNT]))
        .mockReturnValueOnce(createLimitQuery([{ passwordHash: 'old-hash' }]));
      mocks.verifyPassword.mockResolvedValue(true);
      mocks.hashPassword.mockResolvedValue('new-hash');
      mocks.db.update.mockReturnValue(createUpdateQuery([{
        id: 1, version: 2, email: 'test@example.com', isAdmin: false, isActive: true, passwordHash: 'new-hash',
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ newPassword: 'NewPassword123', currentPassword: 'OldPassword123', version: 1 });

      expect(res.status).toBe(200);
    });
  });

  describe('PUT / — email update with conflict', () => {
    it('returns 409 when email is already taken by another user', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([BASE_ACCOUNT]))
        .mockReturnValueOnce(createLimitQuery([{ id: 999 }]));

      const res = await request(app)
        .put('/api/account')
        .send({ email: 'taken@example.com', version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('既に登録されています');
    });

    it('allows same user email (no conflict)', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([BASE_ACCOUNT]))
        .mockReturnValueOnce(createLimitQuery([{ id: 1 }]));
      mocks.db.update.mockReturnValue(createUpdateQuery([{
        id: 1, version: 2, email: 'test@example.com', isAdmin: false, isActive: true, passwordHash: 'hash',
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ email: 'test@example.com', version: 1 });

      expect(res.status).toBe(200);
    });

    it('returns 400 for non-string email', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));

      const res = await request(app)
        .put('/api/account')
        .send({ email: 123, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('メールアドレスが不正');
    });
  });

  describe('PUT / — licenseNumber conflict', () => {
    it('returns 409 when licenseNumber is already taken', async () => {
      const app = createApp();
      mocks.db.select
        .mockReturnValueOnce(createLimitQuery([BASE_ACCOUNT]))
        .mockReturnValueOnce(createLimitQuery([{ id: 999 }]));

      const res = await request(app)
        .put('/api/account')
        .send({ licenseNumber: 'TAKEN-001', version: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('薬局開設許可番号は既に登録');
    });
  });

  describe('PUT / — address and geocode', () => {
    it('returns 400 for invalid address (empty)', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));

      const res = await request(app)
        .put('/api/account')
        .send({ address: '', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('住所');
    });

    it('returns 400 when geocode fails', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));
      mocks.geocodeAddress.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/account')
        .send({ address: '不明な住所', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('位置情報を特定できません');
    });

    it('geocodes when prefecture is changed', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));
      mocks.geocodeAddress.mockResolvedValue({ lat: 35.0, lng: 139.0 });
      mocks.db.update.mockReturnValue(createUpdateQuery([{
        id: 1, version: 2, email: 'test@example.com', isAdmin: false, isActive: true, passwordHash: 'hash',
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ prefecture: '大阪府', version: 1 });

      expect(res.status).toBe(200);
      expect(mocks.geocodeAddress).toHaveBeenCalled();
    });
  });

  describe('PUT / — field validation edge cases', () => {
    it('returns 400 for invalid phone (too long)', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));

      const res = await request(app)
        .put('/api/account')
        .send({ phone: 'a'.repeat(31), version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('電話番号');
    });

    it('returns 400 for invalid fax (empty)', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));

      const res = await request(app)
        .put('/api/account')
        .send({ fax: '', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('FAX');
    });

    it('returns 400 for invalid prefecture (too long)', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));

      const res = await request(app)
        .put('/api/account')
        .send({ prefecture: 'あ'.repeat(11), version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('都道府県');
    });

    it('returns 400 for invalid licenseNumber (empty)', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));

      const res = await request(app)
        .put('/api/account')
        .send({ licenseNumber: '', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('薬局開設許可番号');
    });

    it('returns 400 for non-string postalCode', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));

      const res = await request(app)
        .put('/api/account')
        .send({ postalCode: 1234567, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('郵便番号');
    });

    it('returns 400 for non-boolean matchingAutoNotifyEnabled', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));

      const res = await request(app)
        .put('/api/account')
        .send({ matchingAutoNotifyEnabled: 'yes', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('通知設定');
    });
  });

  describe('PUT / — testAccountPassword flow', () => {
    it('returns 400 when setting testAccountPassword on non-test account', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));

      const res = await request(app)
        .put('/api/account')
        .send({ testAccountPassword: 'pass123', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('テストアカウントではない');
    });

    it('returns 400 for non-string testAccountPassword', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([TEST_ACCOUNT]));

      const res = await request(app)
        .put('/api/account')
        .send({ testAccountPassword: 123, version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('表示用パスワードが不正');
    });

    it('returns 400 for empty testAccountPassword', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([TEST_ACCOUNT]));

      const res = await request(app)
        .put('/api/account')
        .send({ testAccountPassword: '', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('1〜100文字');
    });

    it('returns 400 when test account has no display password after update', async () => {
      const app = createApp();
      const testAccountNoPass = { ...TEST_ACCOUNT, testAccountPassword: '' };
      mocks.db.select.mockReturnValue(createLimitQuery([testAccountNoPass]));

      const res = await request(app)
        .put('/api/account')
        .send({ name: '新名前', version: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('表示用パスワードの設定が必要');
    });
  });

  describe('PUT / — reverification trigger', () => {
    it('triggers reverification when reverification fields change', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));
      mocks.detectChangedReverificationFields.mockReturnValue(['name']);
      mocks.geocodeAddress.mockResolvedValue({ lat: 35.0, lng: 139.0 });
      mocks.db.update.mockReturnValue(createUpdateQuery([{
        id: 1, version: 2, email: 'test@example.com', isAdmin: false, isActive: true, passwordHash: 'hash',
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ name: '変更薬局', version: 1 });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('再審査');
      expect(res.body.verificationStatus).toBe('pending_verification');
      expect(mocks.triggerReverification).toHaveBeenCalled();
    });

    it('handles ReverificationTriggerError', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));
      mocks.detectChangedReverificationFields.mockReturnValue(['name']);
      mocks.db.update.mockReturnValue(createUpdateQuery([{
        id: 1, version: 2, email: 'test@example.com', isAdmin: false, isActive: true, passwordHash: 'hash',
      }]));
      mocks.triggerReverification.mockRejectedValue(new mocks.ReverificationTriggerError('Reverification failed'));
      // The real sendReverificationTriggerErrorResponse sends a response, so mock it to do so
      mocks.sendReverificationTriggerErrorResponse.mockImplementation((res: { status: (code: number) => { json: (body: unknown) => void } }) => {
        res.status(500).json({ error: '再審査依頼の登録に失敗しました' });
      });

      const res = await request(app)
        .put('/api/account')
        .send({ name: '変更薬局', version: 1 });

      expect(res.status).toBe(500);
      expect(mocks.sendReverificationTriggerErrorResponse).toHaveBeenCalled();
    });
  });

  describe('PUT / — inactive account after update', () => {
    it('returns 401 when account becomes inactive after update', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([BASE_ACCOUNT]));
      mocks.db.update.mockReturnValue(createUpdateQuery([{
        id: 1, version: 2, email: 'test@example.com', isAdmin: false, isActive: false, passwordHash: 'hash',
      }]));

      const res = await request(app)
        .put('/api/account')
        .send({ name: '新名前', version: 1 });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('アカウントが無効');
    });
  });

  describe('PUT / — version edge cases', () => {
    it('returns 400 for version 0', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/account')
        .send({ name: 'テスト', version: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('バージョン情報');
    });

    it('returns 400 for negative version', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/account')
        .send({ name: 'テスト', version: -1 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for float version', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/account')
        .send({ name: 'テスト', version: 1.5 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for string version', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/account')
        .send({ name: 'テスト', version: 'abc' });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT / — 404 when account not found for update', () => {
    it('returns 404 when account is not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([]));

      const res = await request(app)
        .put('/api/account')
        .send({ name: '新名前', version: 1 });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT / — 500 on unexpected error', () => {
    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app)
        .put('/api/account')
        .send({ name: '新名前', version: 1 });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('アカウント更新に失敗');
    });
  });

  describe('DELETE / — edge cases', () => {
    it('returns 500 on database error during deletion', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValue(createLimitQuery([{ passwordHash: 'hashed' }]));
      mocks.verifyPassword.mockResolvedValue(true);
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('DB delete error')),
        }),
      });

      const res = await request(app)
        .delete('/api/account')
        .send({ currentPassword: 'correct' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('アカウント削除に失敗');
    });

    it('handles non-string currentPassword gracefully', async () => {
      const app = createApp();

      const res = await request(app)
        .delete('/api/account')
        .send({ currentPassword: 123 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('現在のパスワードが必要');
    });
  });
});
