import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPasswordResetToken: vi.fn(),
  resetPasswordWithToken: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  geocodeAddress: vi.fn(),
  evaluateRegistrationScreening: vi.fn(),
  handoffToOpenClaw: vi.fn(),
  authService: {
    assertJwtSecretConfigured: vi.fn(),
    isJwtSecretMissingError: vi.fn(
      (err: unknown) => err instanceof Error && err.message === 'JWT_SECRET environment variable is not set',
    ),
    hashPassword: vi.fn(),
    verifyPassword: vi.fn(),
    deriveSessionVersion: vi.fn(() => 'session-v1'),
    generateToken: vi.fn(),
    verifyToken: vi.fn(),
  },
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/password-reset-service', () => ({
  createPasswordResetToken: mocks.createPasswordResetToken,
  resetPasswordWithToken: mocks.resetPasswordWithToken,
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

vi.mock('../services/auth-service', () => ({
  assertJwtSecretConfigured: mocks.authService.assertJwtSecretConfigured,
  isJwtSecretMissingError: mocks.authService.isJwtSecretMissingError,
  hashPassword: mocks.authService.hashPassword,
  verifyPassword: mocks.authService.verifyPassword,
  deriveSessionVersion: mocks.authService.deriveSessionVersion,
  generateToken: mocks.authService.generateToken,
  verifyToken: mocks.authService.verifyToken,
}));

vi.mock('../services/geocode-service', () => ({
  geocodeAddress: mocks.geocodeAddress,
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

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
  invalidateAuthUserCache: vi.fn(),
}));

vi.mock('../middleware/csrf', () => ({
  clearCsrfCookie: vi.fn(),
  ensureCsrfCookie: vi.fn((_req: unknown, _res: unknown) => 'mock-csrf-token'),
  generateCsrfToken: vi.fn(() => 'mock-csrf-token'),
  setCsrfCookie: vi.fn(),
}));

vi.mock('../middleware/error-handler', () => ({
  handleRouteError: vi.fn((_err: unknown, _ctx: string, msg: string, res: { status: (s: number) => { json: (b: unknown) => void } }) => {
    res.status(500).json({ error: msg });
  }),
  getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

vi.mock('../utils/http-utils', () => ({
  sleep: vi.fn(async () => undefined),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let authRouter: (typeof import('../routes/auth'))['default'];

beforeAll(async () => {
  ({ default: authRouter } = await import('../routes/auth'));
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}

// For tests that need a fresh module (e.g. to clear module-level cache such as
// testPharmacyCache), resetModules + dynamic import is used.
async function createFreshApp() {
  vi.resetModules();
  const freshApp = express();
  freshApp.use(express.json());
  freshApp.use(cookieParser());
  const { default: freshRouter } = await import('../routes/auth');
  freshApp.use('/api/auth', freshRouter);
  return freshApp;
}

function createSelectChain(rows: unknown[]) {
  const resolved = Promise.resolve(rows);
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

function createTransactionMock(pharmacyId: number, reviewId: number, verificationRequestId: number) {
  mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    let insertCallCount = 0;
    const insertResults = [
      [{ id: reviewId }],
      [{ id: pharmacyId }],
      [{ id: verificationRequestId }],
    ];
    const txMock = {
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => ({
          returning: vi.fn().mockImplementation(() => {
            const result = insertResults[insertCallCount] ?? [{ id: 0 }];
            insertCallCount++;
            return Promise.resolve(result);
          }),
        })),
      })),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };
    return fn(txMock);
  });
}

describe('auth routes — additional coverage', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalExposeToken = process.env.EXPOSE_PASSWORD_RESET_TOKEN;
  const originalTestLoginFeatureEnabled = process.env.TEST_LOGIN_FEATURE_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = 'false';
    delete process.env.TEST_LOGIN_FEATURE_ENABLED;
    mocks.authService.assertJwtSecretConfigured.mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv ?? 'test';
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = originalExposeToken ?? 'false';
    if (originalTestLoginFeatureEnabled === undefined) {
      delete process.env.TEST_LOGIN_FEATURE_ENABLED;
    } else {
      process.env.TEST_LOGIN_FEATURE_ENABLED = originalTestLoginFeatureEnabled;
    }
  });

  describe('POST /register', () => {
    const validBody = {
      email: 'pharmacy@example.com',
      password: 'Password123',
      name: '中央薬局',
      postalCode: '100-0001',
      address: '千代田1-1',
      phone: '03-1234-5678',
      fax: '03-1234-5679',
      licenseNumber: 'PHARM-999',
      permitLicenseNumber: 'PHARM-999',
      permitPharmacyName: '中央薬局',
      permitAddress: '東京都千代田1-1',
      prefecture: '東京都',
    };

    it('returns 400 for invalid registration body', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'bad' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('errors');
    });

    it('returns 409 when email already exists', async () => {
      mocks.db.select
        .mockReturnValueOnce(createSelectChain([{ id: 5 }])) // existing email
        .mockReturnValueOnce(createSelectChain([])); // no existing license

      const app = createApp();
      const res = await request(app)
        .post('/api/auth/register')
        .send(validBody);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('メールアドレスは既に登録');
    });

    it('returns 409 when license number already exists', async () => {
      mocks.db.select
        .mockReturnValueOnce(createSelectChain([])) // no existing email
        .mockReturnValueOnce(createSelectChain([{ id: 5 }])); // existing license

      const app = createApp();
      const res = await request(app)
        .post('/api/auth/register')
        .send(validBody);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('薬局開設許可番号は既に登録');
    });

    it('returns 400 when geocoding fails', async () => {
      mocks.db.select
        .mockReturnValueOnce(createSelectChain([])) // no existing email
        .mockReturnValueOnce(createSelectChain([])); // no existing license
      mocks.authService.hashPassword.mockResolvedValue('hashed-pw');
      mocks.geocodeAddress.mockResolvedValue(null);

      const app = createApp();
      const res = await request(app)
        .post('/api/auth/register')
        .send(validBody);

      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('address');
    });

    it('returns 403 when screening fails', async () => {
      mocks.db.select
        .mockReturnValueOnce(createSelectChain([])) // no existing email
        .mockReturnValueOnce(createSelectChain([])); // no existing license
      mocks.authService.hashPassword.mockResolvedValue('hashed-pw');
      mocks.geocodeAddress.mockResolvedValue({ lat: 35.68, lng: 139.76 });
      mocks.evaluateRegistrationScreening.mockReturnValue({
        approved: false,
        screeningScore: 30,
        reasons: ['mismatch'],
        mismatches: [{ field: 'name', expected: '中央薬局', actual: '別の薬局' }],
      });

      createTransactionMock(100, 1, 0);

      const app = createApp();
      const res = await request(app)
        .post('/api/auth/register')
        .send(validBody);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('一致しないため');
    });

    it('returns 201 when registration succeeds', async () => {
      mocks.db.select
        .mockReturnValueOnce(createSelectChain([])) // no existing email
        .mockReturnValueOnce(createSelectChain([])); // no existing license
      mocks.authService.hashPassword.mockResolvedValue('hashed-pw');
      mocks.geocodeAddress.mockResolvedValue({ lat: 35.68, lng: 139.76 });
      mocks.evaluateRegistrationScreening.mockReturnValue({
        approved: true,
        screeningScore: 90,
        reasons: ['ok'],
        mismatches: [],
      });
      mocks.handoffToOpenClaw.mockResolvedValue(undefined);

      createTransactionMock(100, 1, 200);

      const app = createApp();
      const res = await request(app)
        .post('/api/auth/register')
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.verificationStatus).toBe('pending_verification');
      expect(res.body.pharmacyId).toBe(100);
    });

    it('handles unique constraint violation on email', async () => {
      mocks.db.select
        .mockReturnValueOnce(createSelectChain([])) // no existing email
        .mockReturnValueOnce(createSelectChain([])); // no existing license
      mocks.authService.hashPassword.mockResolvedValue('hashed-pw');
      mocks.geocodeAddress.mockResolvedValue({ lat: 35.68, lng: 139.76 });
      mocks.evaluateRegistrationScreening.mockReturnValue({
        approved: true,
        screeningScore: 90,
        reasons: ['ok'],
        mismatches: [],
      });

      mocks.db.transaction.mockRejectedValue(
        Object.assign(new Error('unique constraint "pharmacies_email_unique"'), { code: '23505', constraint: 'pharmacies_email_unique' }),
      );

      const app = createApp();
      const res = await request(app)
        .post('/api/auth/register')
        .send(validBody);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('メールアドレスは既に登録');
    });

    it('handles unique constraint violation on license', async () => {
      mocks.db.select
        .mockReturnValueOnce(createSelectChain([])) // no existing email
        .mockReturnValueOnce(createSelectChain([])); // no existing license
      mocks.authService.hashPassword.mockResolvedValue('hashed-pw');
      mocks.geocodeAddress.mockResolvedValue({ lat: 35.68, lng: 139.76 });
      mocks.evaluateRegistrationScreening.mockReturnValue({
        approved: true,
        screeningScore: 90,
        reasons: ['ok'],
        mismatches: [],
      });

      mocks.db.transaction.mockRejectedValue(
        Object.assign(new Error('unique constraint "pharmacies_license_unique"'), { code: '23505', constraint: 'pharmacies_license_unique' }),
      );

      const app = createApp();
      const res = await request(app)
        .post('/api/auth/register')
        .send(validBody);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('薬局開設許可番号は既に登録');
    });
  });

  describe('POST /login', () => {
    it('returns 400 for invalid login body', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: '' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('errors');
    });

    it('returns 401 when email not found', async () => {
      mocks.db.select.mockReturnValue(createSelectChain([]));
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('メールアドレスまたはパスワード');
    });

    it('returns 401 when password is wrong', async () => {
      mocks.db.select.mockReturnValue(createSelectChain([{
        id: 1,
        email: 'test@example.com',
        name: 'テスト薬局',
        isActive: true,
        isAdmin: false,
        passwordHash: 'hashed',
        prefecture: '東京都',
      }]));
      mocks.authService.verifyPassword.mockResolvedValue(false);
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'wrongpass' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('メールアドレスまたはパスワード');
    });
  });

  describe('POST /password-reset/request', () => {
    it('returns 400 when email is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/auth/password-reset/request')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('メールアドレスを入力');
    });

    it('returns 400 for invalid email format', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/auth/password-reset/request')
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
    });

    it('returns 200 even when user does not exist (anti-enumeration)', async () => {
      mocks.createPasswordResetToken.mockResolvedValue(null);
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/password-reset/request')
        .send({ email: 'nobody@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('手続きを受け付け');
    });
  });

  describe('POST /password-reset/confirm', () => {
    it('returns 400 when token format is invalid', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({ token: 'short', newPassword: 'NewPassword123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('リセットトークンが無効');
    });

    it('returns 400 when new password is too short', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({ token: 'a'.repeat(64), newPassword: '1' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when reset token is expired', async () => {
      mocks.resetPasswordWithToken.mockResolvedValue({ success: false });
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({ token: 'a'.repeat(64), newPassword: 'NewPassword123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('無効または期限切れ');
    });

    it('resets password successfully', async () => {
      mocks.resetPasswordWithToken.mockResolvedValue({ success: true, pharmacyId: 1 });
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/password-reset/confirm')
        .send({ token: 'a'.repeat(64), newPassword: 'NewPassword123' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('リセットしました');
    });
  });

  describe('POST /logout', () => {
    it('logs out successfully with valid token', async () => {
      mocks.authService.verifyToken.mockReturnValue({ id: 1 });
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', ['token=valid-token']);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('ログアウト');
    });

    it('logs out successfully without token', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('ログアウト');
    });

    it('logs out successfully with invalid token', async () => {
      mocks.authService.verifyToken.mockImplementation(() => {
        throw new Error('invalid token');
      });
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', ['token=bad-token']);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('ログアウト');
    });
  });

  describe('GET /me', () => {
    it('returns 404 when user not found', async () => {
      mocks.db.select.mockReturnValue(createSelectChain([]));
      const app = createApp();

      const res = await request(app)
        .get('/api/auth/me');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('ユーザーが見つかりません');
    });
  });

  describe('GET /test-pharmacies', () => {
    it('returns 404 when test login feature is disabled', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_LOGIN_FEATURE_ENABLED = 'false';
      const app = await createFreshApp();

      const res = await request(app)
        .get('/api/auth/test-pharmacies');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'テストログインは無効です' });
      expect(mocks.db.select).not.toHaveBeenCalled();
    });

    // These tests need createFreshApp() because the auth route module keeps a
    // module-level testPharmacyCache that persists across requests to the same
    // router instance. Each test needs a fresh module to start with an empty cache.
    it('returns 404 when no test pharmacies exist', async () => {
      mocks.db.select.mockReturnValue(createSelectChain([]));
      const app = await createFreshApp();

      const res = await request(app)
        .get('/api/auth/test-pharmacies');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('テスト薬局がDBに登録されていません');
    });

    it('returns password as empty string when includePassword not set', async () => {
      mocks.db.select.mockReturnValue(createSelectChain([
        { id: 1, name: 'テスト薬局', email: 'test@example.com', prefecture: '東京都', password: 'Secret123' },
      ]));
      const app = await createFreshApp();

      const res = await request(app)
        .get('/api/auth/test-pharmacies');

      expect(res.status).toBe(200);
      expect(res.body.accounts[0].password).toBe('');
    });

    it('returns password when includePassword=true', async () => {
      mocks.db.select.mockReturnValue(createSelectChain([
        { id: 1, name: 'テスト薬局', email: 'test@example.com', prefecture: '東京都', password: 'Secret123' },
      ]));
      const app = await createFreshApp();

      const res = await request(app)
        .get('/api/auth/test-pharmacies?includePassword=true');

      expect(res.status).toBe(200);
      expect(res.body.accounts[0].password).toBe('Secret123');
    });

    it('returns empty string when password is null in DB', async () => {
      mocks.db.select.mockReturnValue(createSelectChain([
        { id: 1, name: 'テスト薬局', email: 'test@example.com', prefecture: '東京都', password: null },
      ]));
      const app = await createFreshApp();

      const res = await request(app)
        .get('/api/auth/test-pharmacies?includePassword=1');

      expect(res.status).toBe(200);
      expect(res.body.accounts[0].password).toBe('');
    });
  });
});
