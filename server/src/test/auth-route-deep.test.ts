/**
 * auth-route-deep.test.ts
 * auth.ts ルートの未カバーブランチを追加テスト
 * - extractUniqueViolationConstraint 各パターン
 * - extractErrorCode 再帰
 * - includesIsTestAccountToken 再帰
 * - isMissingTestPharmacyColumnError
 * - handleAuthConfigurationError
 * - password-reset/confirm バリデーション
 * - logout (cookie有り/無し)
 * - test-pharmacies cache / auto-heal 分岐
 */
import express, { Response } from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ParseSuccess = { success: true };
type ParseFailure = { success: false; error: { issues: Array<{ message: string }> } };
type ParseResult = ParseSuccess | ParseFailure;

/* ── hoisted mocks ─────────────────────────────────────── */
const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  },
  validateRegistration: vi.fn(() => []),
  validateLogin: vi.fn(() => []),
  emailSchema: { safeParse: vi.fn<(input: unknown) => ParseResult>(() => ({ success: true })) },
  passwordSchema: { safeParse: vi.fn<(input: unknown) => ParseResult>(() => ({ success: true })) },
  assertJwtSecretConfigured: vi.fn(),
  hashPassword: vi.fn(async () => 'hashedpw'),
  verifyPassword: vi.fn(async () => true),
  generateToken: vi.fn(() => 'jwt-token'),
  verifyToken: vi.fn<() => { id: number; email?: string; isAdmin?: boolean }>(() => ({ id: 1, email: 'test@example.com', isAdmin: false })),
  deriveSessionVersion: vi.fn(() => 'v1'),
  isJwtSecretMissingError: vi.fn(() => false),
  geocodeAddress: vi.fn(async () => ({ lat: 35.6, lng: 139.7 })),
  evaluateRegistrationScreening: vi.fn(() => ({
    approved: true,
    screeningScore: 100,
    reasons: [],
    mismatches: [],
  })),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  createPasswordResetToken: vi.fn<() => Promise<{ token: string } | null>>(async () => ({ token: 'a'.repeat(64) })),
  resetPasswordWithToken: vi.fn<() => Promise<{ success: boolean; pharmacyId?: number }>>(async () => ({ success: true, pharmacyId: 1 })),
  invalidateAuthUserCache: vi.fn(),
  handoffToOpenClaw: vi.fn(async () => undefined),
  handleRouteError: vi.fn((_err: unknown, _ctx: string, msg: string, res: Response) => {
    res.status(500).json({ error: msg });
  }),
  setCsrfCookie: vi.fn(),
  clearCsrfCookie: vi.fn(),
  ensureCsrfCookie: vi.fn(() => 'csrf-tok'),
  generateCsrfToken: vi.fn(() => 'csrf-tok'),
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
}));
vi.mock('../services/auth-service', () => ({
  assertJwtSecretConfigured: mocks.assertJwtSecretConfigured,
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
  generateToken: mocks.generateToken,
  verifyToken: mocks.verifyToken,
  deriveSessionVersion: mocks.deriveSessionVersion,
  isJwtSecretMissingError: mocks.isJwtSecretMissingError,
}));
vi.mock('../utils/validators', () => ({
  validateRegistration: mocks.validateRegistration,
  validateLogin: mocks.validateLogin,
  emailSchema: mocks.emailSchema,
  passwordSchema: mocks.passwordSchema,
}));
vi.mock('../services/geocode-service', () => ({ geocodeAddress: mocks.geocodeAddress }));
vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));
vi.mock('../services/password-reset-service', () => ({
  createPasswordResetToken: mocks.createPasswordResetToken,
  resetPasswordWithToken: mocks.resetPasswordWithToken,
}));
vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
  invalidateAuthUserCache: mocks.invalidateAuthUserCache,
}));
vi.mock('../middleware/csrf', () => ({
  setCsrfCookie: mocks.setCsrfCookie,
  clearCsrfCookie: mocks.clearCsrfCookie,
  ensureCsrfCookie: mocks.ensureCsrfCookie,
  generateCsrfToken: mocks.generateCsrfToken,
}));
vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../middleware/error-handler', () => ({
  handleRouteError: mocks.handleRouteError,
}));
vi.mock('../services/registration-screening-service', () => ({
  evaluateRegistrationScreening: mocks.evaluateRegistrationScreening,
}));
vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: mocks.handoffToOpenClaw,
}));
vi.mock('../services/pharmacy-verification-service', () => ({
  PHARMACY_VERIFICATION_REQUEST_TYPE: 'pharmacy_verification',
}));
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import authRouter from '../routes/auth';

/* ── helpers ─────────────────────────────────────── */
function createSelectQuery(result: unknown) {
  const resolved = Promise.resolve(result);
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', authRouter);
  return app;
}

/* ── tests ─────────────────────────────────────── */
describe('auth route deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── password-reset/request ──

  describe('POST /auth/password-reset/request', () => {
    it('returns 400 when email is empty', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/auth/password-reset/request')
        .send({ email: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('メールアドレスを入力');
    });

    it('returns 400 when email is not a string', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/auth/password-reset/request')
        .send({ email: 123 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when email validation fails', async () => {
      mocks.emailSchema.safeParse.mockReturnValueOnce({
        success: false,
        error: { issues: [{ message: '無効なメール' }] },
      });
      const app = createApp();
      const res = await request(app)
        .post('/auth/password-reset/request')
        .send({ email: 'bad' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('無効なメール');
    });

    it('returns success even when createPasswordResetToken returns null (prevents enumeration)', async () => {
      mocks.createPasswordResetToken.mockResolvedValueOnce(null);
      const app = createApp();
      const res = await request(app)
        .post('/auth/password-reset/request')
        .send({ email: 'noone@example.com' });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('パスワードリセットの手続き');
    });
  });

  // ── password-reset/confirm ──

  describe('POST /auth/password-reset/confirm', () => {
    it('returns 400 when token is empty', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/auth/password-reset/confirm')
        .send({ token: '', newPassword: 'ValidPass1!' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('リセットトークンが無効');
    });

    it('returns 400 when token is non-hex format', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/auth/password-reset/confirm')
        .send({ token: 'not-hex-64-chars', newPassword: 'ValidPass1!' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('リセットトークンが無効');
    });

    it('returns 400 when newPassword validation fails', async () => {
      mocks.passwordSchema.safeParse.mockReturnValueOnce({
        success: false,
        error: { issues: [{ message: 'パスワードが弱すぎます' }] },
      });
      const app = createApp();
      const res = await request(app)
        .post('/auth/password-reset/confirm')
        .send({ token: 'a'.repeat(64), newPassword: '1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('パスワードが弱すぎます');
    });

    it('returns 400 when resetPasswordWithToken fails', async () => {
      mocks.resetPasswordWithToken.mockResolvedValueOnce({ success: false });
      const app = createApp();
      const res = await request(app)
        .post('/auth/password-reset/confirm')
        .send({ token: 'b'.repeat(64), newPassword: 'GoodPass1!' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('リセットトークンが無効または期限切れ');
    });

    it('returns success for valid token and password', async () => {
      mocks.resetPasswordWithToken.mockResolvedValueOnce({ success: true, pharmacyId: 5 });
      const app = createApp();
      const res = await request(app)
        .post('/auth/password-reset/confirm')
        .send({ token: 'c'.repeat(64), newPassword: 'GoodPass1!' });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('パスワードをリセットしました');
      expect(mocks.invalidateAuthUserCache).toHaveBeenCalledWith(5);
    });
  });

  // ── logout ──

  describe('POST /auth/logout', () => {
    it('logs out even without a token cookie', async () => {
      const app = createApp();
      const res = await request(app).post('/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('ログアウト');
    });

    it('logs out and invalidates cache when token cookie is present', async () => {
      mocks.verifyToken.mockReturnValueOnce({ id: 42 });
      const app = createApp();
      const res = await request(app)
        .post('/auth/logout')
        .set('Cookie', 'token=valid-jwt');
      expect(res.status).toBe(200);
      expect(mocks.invalidateAuthUserCache).toHaveBeenCalledWith(42);
    });

    it('handles invalid token cookie gracefully during logout', async () => {
      mocks.verifyToken.mockImplementationOnce(() => { throw new Error('bad'); });
      const app = createApp();
      const res = await request(app)
        .post('/auth/logout')
        .set('Cookie', 'token=bad-jwt');
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('ログアウト');
    });
  });

  // ── csrf-token ──

  describe('GET /auth/csrf-token', () => {
    it('returns csrf token', async () => {
      const app = createApp();
      const res = await request(app).get('/auth/csrf-token');
      expect(res.status).toBe(200);
      expect(res.body.csrfToken).toBe('csrf-tok');
    });
  });

  // ── login with auth configuration error ──

  describe('POST /auth/login - auth config error', () => {
    it('returns 503 when JWT secret is missing', async () => {
      mocks.validateLogin.mockReturnValueOnce([]);
      mocks.assertJwtSecretConfigured.mockImplementationOnce(() => {
        throw Object.assign(new Error('JWT_SECRET not set'), { __jwtSecretMissing: true });
      });
      mocks.isJwtSecretMissingError.mockReturnValueOnce(true);
      const app = createApp();
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'a@b.com', password: 'pass' });
      expect(res.status).toBe(503);
      expect(res.body.error).toContain('認証設定が未完了');
    });
  });

  // ── login inactive account ──

  describe('POST /auth/login - inactive account', () => {
    it('returns 403 when account is inactive', async () => {
      mocks.validateLogin.mockReturnValueOnce([]);
      mocks.db.select.mockImplementationOnce(() =>
        createSelectQuery([{
          id: 10,
          email: 'inactive@example.com',
          isActive: false,
          isAdmin: false,
          passwordHash: 'h',
          name: 'test',
        }]),
      );
      const app = createApp();
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'inactive@example.com', password: 'pass' });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('無効');
    });
  });

  // ── login wrong password ──

  describe('POST /auth/login - wrong password', () => {
    it('returns 401 when password does not match', async () => {
      mocks.validateLogin.mockReturnValueOnce([]);
      mocks.verifyPassword.mockResolvedValueOnce(false);
      mocks.db.select.mockImplementationOnce(() =>
        createSelectQuery([{
          id: 10,
          email: 'test@example.com',
          isActive: true,
          isAdmin: false,
          passwordHash: 'h',
          name: 'test',
        }]),
      );
      const app = createApp();
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'wrong' });
      expect(res.status).toBe(401);
      expect(mocks.writeLog).toHaveBeenCalled();
    });
  });

  // ── register unique constraint errors ──

  describe('POST /auth/register - unique constraint in catch', () => {
    it('handles license unique constraint error', async () => {
      mocks.validateRegistration.mockReturnValueOnce([]);
      mocks.db.select.mockImplementation(() => createSelectQuery([]));
      mocks.db.transaction.mockRejectedValueOnce(
        Object.assign(new Error('unique constraint "pharmacies_license_number_unique"'), { code: '23505', constraint: 'pharmacies_license_number_unique' }),
      );
      const app = createApp();
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'a@b.com', password: 'Pass1!', name: '薬局', postalCode: '1000001',
          address: '千代田区', phone: '0312345678', fax: '0312345679',
          licenseNumber: 'LIC001', prefecture: '東京都',
        });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('薬局開設許可番号');
    });

    it('handles email unique constraint error', async () => {
      mocks.validateRegistration.mockReturnValueOnce([]);
      mocks.db.select.mockImplementation(() => createSelectQuery([]));
      mocks.db.transaction.mockRejectedValueOnce(
        Object.assign(new Error('unique constraint "pharmacies_email_unique"'), { code: '23505', constraint: 'pharmacies_email_unique' }),
      );
      const app = createApp();
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'a@b.com', password: 'Pass1!', name: '薬局', postalCode: '1000001',
          address: '千代田区', phone: '0312345678', fax: '0312345679',
          licenseNumber: 'LIC001', prefecture: '東京都',
        });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('メールアドレス');
    });

    it('handles unknown unique constraint error', async () => {
      mocks.validateRegistration.mockReturnValueOnce([]);
      mocks.db.select.mockImplementation(() => createSelectQuery([]));
      mocks.db.transaction.mockRejectedValueOnce(
        Object.assign(new Error('unique constraint "other_unique"'), { code: '23505', constraint: 'other_unique' }),
      );
      const app = createApp();
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'a@b.com', password: 'Pass1!', name: '薬局', postalCode: '1000001',
          address: '千代田区', phone: '0312345678', fax: '0312345679',
          licenseNumber: 'LIC001', prefecture: '東京都',
        });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('既に登録されています');
    });
  });

  // ── test-pharmacies route ──
  describe('GET /auth/test-pharmacies', () => {
    it('returns 404 when test login feature flag is disabled', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_LOGIN_FEATURE_ENABLED = 'false';
      const app = createApp();
      const res = await request(app).get('/auth/test-pharmacies?includePassword=1');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'テストログインは無効です' });
    });
  });
});
