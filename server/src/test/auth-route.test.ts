import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPasswordResetToken: vi.fn(),
  resetPasswordWithToken: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  authService: {
    assertJwtSecretConfigured: vi.fn(),
    isJwtSecretMissingError: vi.fn((err: unknown) => err instanceof Error && err.message === 'JWT_SECRET environment variable is not set'),
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

async function createApp() {
  vi.resetModules();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { default: authRouter } = await import('../routes/auth');
  app.use('/api/auth', authRouter);
  return app;
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

function createRejectedSelectChain(error: Error & { code?: string }) {
  const rejected = Promise.reject(error);
  rejected.catch(() => undefined);
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: rejected.then.bind(rejected),
    catch: rejected.catch.bind(rejected),
    finally: rejected.finally.bind(rejected),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

describe('auth routes', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalExposePasswordResetToken = process.env.EXPOSE_PASSWORD_RESET_TOKEN;
  const originalTestLoginFeatureEnabled = process.env.TEST_LOGIN_FEATURE_ENABLED;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalVitest = process.env.VITEST;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = 'false';
    delete process.env.TEST_LOGIN_FEATURE_ENABLED;
    delete process.env.VERCEL_ENV;
    mocks.authService.assertJwtSecretConfigured.mockImplementation(() => undefined);
    mocks.authService.isJwtSecretMissingError.mockImplementation(
      (err: unknown) => err instanceof Error && err.message === 'JWT_SECRET environment variable is not set'
    );
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalExposePasswordResetToken === undefined) {
      delete process.env.EXPOSE_PASSWORD_RESET_TOKEN;
    } else {
      process.env.EXPOSE_PASSWORD_RESET_TOKEN = originalExposePasswordResetToken;
    }

    if (originalTestLoginFeatureEnabled === undefined) {
      delete process.env.TEST_LOGIN_FEATURE_ENABLED;
    } else {
      process.env.TEST_LOGIN_FEATURE_ENABLED = originalTestLoginFeatureEnabled;
    }

    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnv;
    }

    if (originalVitest === undefined) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = originalVitest;
    }
  });

  it('does not expose password reset token by default', async () => {
    const app = await createApp();
    mocks.createPasswordResetToken.mockResolvedValue({
      token: 'a'.repeat(64),
      pharmacyName: 'テスト薬局',
    });

    const res = await request(app)
      .post('/api/auth/password-reset/request')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'パスワードリセットの手続きを受け付けました',
    });
    expect(mocks.createPasswordResetToken).toHaveBeenCalledWith('test@example.com');
  });

  it('normalizes email casing before creating password reset tokens', async () => {
    const app = await createApp();
    mocks.createPasswordResetToken.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/password-reset/request')
      .send({ email: 'Test.User@Example.COM ' });

    expect(res.status).toBe(200);
    expect(mocks.createPasswordResetToken).toHaveBeenCalledWith('test.user@example.com');
  });

  it('exposes password reset token when explicitly enabled in test environment', async () => {
    process.env.NODE_ENV = 'test';
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = 'true';
    const app = await createApp();
    mocks.createPasswordResetToken.mockResolvedValue({
      token: 'b'.repeat(64),
      pharmacyName: 'テスト薬局',
    });

    const res = await request(app)
      .post('/api/auth/password-reset/request')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'パスワードリセットの手続きを受け付けました',
      token: 'b'.repeat(64),
    });
  });

  it('fails fast when token exposure is enabled outside test environment', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = 'true';

    await expect(createApp()).rejects.toThrow('EXPOSE_PASSWORD_RESET_TOKEN=true は test 環境でのみ許可されています');
  });

  it('fails fast in production when token exposure is enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = 'true';

    await expect(createApp()).rejects.toThrow('EXPOSE_PASSWORD_RESET_TOKEN=true は test 環境でのみ許可されています');
  });

  it('issues csrf token and cookie', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/api/auth/csrf-token');

    expect(res.status).toBe(200);
    expect(typeof res.body.csrfToken).toBe('string');
    expect(res.body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('csrfToken=')])
    );
  });

  it('reuses existing csrf cookie token', async () => {
    const app = await createApp();

    const res = await request(app)
      .get('/api/auth/csrf-token')
      .set('Cookie', 'csrfToken=existing-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ csrfToken: 'existing-token' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns 503 when JWT secret is not configured on login', async () => {
    mocks.authService.assertJwtSecretConfigured.mockImplementation(() => {
      throw new Error('JWT_SECRET environment variable is not set');
    });
    const app = await createApp();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: '認証設定が未完了です。管理者に連絡してください' });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('returns 503 when JWT secret is not configured on register', async () => {
    mocks.authService.assertJwtSecretConfigured.mockImplementation(() => {
      throw new Error('JWT_SECRET environment variable is not set');
    });
    const app = await createApp();

    const res = await request(app)
      .post('/api/auth/register')
      .send({
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
      });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: '認証設定が未完了です。管理者に連絡してください' });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('logs in via auth route with database lookup', async () => {
    mocks.authService.verifyPassword.mockResolvedValue(true);
    mocks.authService.generateToken.mockReturnValue('demo-token');
    const selectChain = createSelectChain([{
      id: 10,
      email: 'test@example.com',
      name: '中央薬局',
      prefecture: '東京都',
      isAdmin: false,
      isActive: true,
      passwordHash: 'hashed-password',
    }]);
    mocks.db.select.mockReturnValue(selectChain);
    const app = await createApp();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 10,
      email: 'test@example.com',
      name: '中央薬局',
      prefecture: '東京都',
      isAdmin: false,
    });
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
    expect(selectChain.from).toHaveBeenCalledTimes(1);
    expect(selectChain.where).toHaveBeenCalledTimes(1);
    expect(selectChain.limit).toHaveBeenCalledWith(1);
    expect(mocks.authService.verifyPassword).toHaveBeenCalledWith('password123', 'hashed-password');
    expect(mocks.authService.assertJwtSecretConfigured).toHaveBeenCalledTimes(1);
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('token=demo-token'),
        expect.stringContaining('csrfToken='),
      ])
    );
  });

  it('rejects inactive account on login', async () => {
    const selectChain = createSelectChain([{
      id: 11,
      email: 'test@example.com',
      name: '停止薬局',
      prefecture: '東京都',
      isAdmin: false,
      isActive: false,
      passwordHash: 'hashed-password',
    }]);
    mocks.db.select.mockReturnValue(selectChain);
    const app = await createApp();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'このアカウントは無効になっています' });
    expect(mocks.authService.verifyPassword).not.toHaveBeenCalled();
  });

  it('disables test login endpoint by default when VERCEL_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    delete process.env.TEST_LOGIN_FEATURE_ENABLED;
    const app = await createApp();

    const res = await request(app).get('/api/auth/test-pharmacies?includePassword=1');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'テストログインは無効です' });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('enables test login endpoint by default when VERCEL_ENV=preview', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'preview';
    delete process.env.TEST_LOGIN_FEATURE_ENABLED;
    const selectChain = createSelectChain([
      { id: 1, name: 'テスト薬局東京店', email: 'test-tokyo@example.com', prefecture: '東京都', password: 'TokyoDemo!2026' },
    ]);
    mocks.db.select.mockReturnValue(selectChain);
    const app = await createApp();

    const res = await request(app).get('/api/auth/test-pharmacies?includePassword=1');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      accounts: [
        {
          id: 1, name: 'テスト薬局東京店', email: 'test-tokyo@example.com', prefecture: '東京都', password: 'TokyoDemo!2026',
        },
      ],
    });
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
  });

  it('disables test login endpoint when feature flag is false', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.TEST_LOGIN_FEATURE_ENABLED = 'false';
    const app = await createApp();

    const res = await request(app).get('/api/auth/test-pharmacies?includePassword=1');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'テストログインは無効です' });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('returns test pharmacy previews from database without password by default', async () => {
    const selectChain = createSelectChain([
      { id: 1, name: 'テスト薬局東京店', email: 'test-tokyo@example.com', prefecture: '東京都', password: 'TokyoDemo!2026' },
      { id: 2, name: 'テスト薬局札幌店', email: 'test-sapporo@example.com', prefecture: '北海道', password: 'SapporoDemo!2026' },
    ]);
    mocks.db.select.mockReturnValue(selectChain);
    const app = await createApp();

    const res = await request(app).get('/api/auth/test-pharmacies');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=60');
    expect(res.body).toEqual({
      accounts: [
        {
          id: 1, name: 'テスト薬局東京店', email: 'test-tokyo@example.com', prefecture: '東京都', password: '',
        },
        {
          id: 2, name: 'テスト薬局札幌店', email: 'test-sapporo@example.com', prefecture: '北海道', password: '',
        },
      ],
    });
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
    expect(selectChain.from).toHaveBeenCalledTimes(1);
    expect(selectChain.where).toHaveBeenCalledTimes(1);
    expect(selectChain.orderBy).toHaveBeenCalledTimes(1);
    expect(selectChain.limit).toHaveBeenCalledWith(5);
  });

  it('returns 503 when test pharmacy columns are missing', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TEST_LOGIN_FEATURE_ENABLED = 'true';
    const missingColumnError = Object.assign(new Error('column "is_test_account" does not exist'), { code: '42703' });
    const missingColumnChain = createRejectedSelectChain(missingColumnError);
    mocks.db.execute.mockRejectedValueOnce(new Error('permission denied'));
    mocks.db.select
      .mockImplementationOnce(() => missingColumnChain);
    const app = await createApp();

    const res = await request(app).get('/api/auth/test-pharmacies?includePassword=1');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'テスト薬局機能のDBスキーマが未適用です。マイグレーションを実行してください' });
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
    expect(mocks.db.execute).toHaveBeenCalledTimes(1);
    expect(missingColumnChain.where).toHaveBeenCalledTimes(1);
  });

  it('recovers test pharmacy preview after ensuring missing columns', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TEST_LOGIN_FEATURE_ENABLED = 'true';
    const missingColumnError = Object.assign(new Error('column "is_test_account" does not exist'), { code: '42703' });
    const missingColumnChain = createRejectedSelectChain(missingColumnError);
    const healedRows = [
      { id: 1, name: 'テスト薬局東京店', email: 'test-tokyo@example.com', prefecture: '東京都', password: 'TokyoDemo!2026' },
    ];
    const healedChain = createSelectChain(healedRows);
    mocks.db.execute.mockResolvedValue({});
    mocks.db.select
      .mockImplementationOnce(() => missingColumnChain)
      .mockImplementationOnce(() => healedChain);
    const app = await createApp();

    const res = await request(app).get('/api/auth/test-pharmacies?includePassword=1');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      accounts: [{
        id: 1,
        name: 'テスト薬局東京店',
        email: 'test-tokyo@example.com',
        prefecture: '東京都',
        password: 'TokyoDemo!2026',
      }],
    });
    expect(mocks.db.select).toHaveBeenCalledTimes(2);
    expect(mocks.db.execute).toHaveBeenCalledTimes(2);
  });

  it('returns distinct passwords for DB test pharmacy accounts', async () => {
    const selectChain = createSelectChain([
      { id: 1, name: 'テスト薬局東京店', email: 'test-tokyo@example.com', prefecture: '東京都', password: 'TokyoDemo!2026' },
      { id: 2, name: 'テスト薬局札幌店', email: 'test-sapporo@example.com', prefecture: '北海道', password: 'SapporoDemo!2026' },
      { id: 3, name: 'テスト薬局大阪店', email: 'test-osaka@example.com', prefecture: '大阪府', password: 'OsakaDemo!2026' },
      { id: 4, name: 'テスト薬局福岡店', email: 'test-fukuoka@example.com', prefecture: '福岡県', password: 'FukuokaDemo!2026' },
      { id: 5, name: 'テスト薬局那覇店', email: 'test-naha@example.com', prefecture: '沖縄県', password: 'NahaDemo!2026' },
    ]);
    mocks.db.select.mockReturnValue(selectChain);
    const app = await createApp();

    const res = await request(app).get('/api/auth/test-pharmacies?includePassword=1');

    expect(res.status).toBe(200);
    expect(res.body.accounts).toEqual([
      {
        id: 1,
        name: 'テスト薬局東京店',
        email: 'test-tokyo@example.com',
        prefecture: '東京都',
        password: 'TokyoDemo!2026',
      },
      {
        id: 2,
        name: 'テスト薬局札幌店',
        email: 'test-sapporo@example.com',
        prefecture: '北海道',
        password: 'SapporoDemo!2026',
      },
      {
        id: 3,
        name: 'テスト薬局大阪店',
        email: 'test-osaka@example.com',
        prefecture: '大阪府',
        password: 'OsakaDemo!2026',
      },
      {
        id: 4,
        name: 'テスト薬局福岡店',
        email: 'test-fukuoka@example.com',
        prefecture: '福岡県',
        password: 'FukuokaDemo!2026',
      },
      {
        id: 5,
        name: 'テスト薬局那覇店',
        email: 'test-naha@example.com',
        prefecture: '沖縄県',
        password: 'NahaDemo!2026',
      },
    ]);
  });

  it('uses DB password value in preview response', async () => {
    const selectChain = createSelectChain([
      { id: 7, name: 'デモ薬局', email: 'demo@example.com', prefecture: '福岡県', password: 'DemoPass!999' },
    ]);
    mocks.db.select.mockReturnValue(selectChain);
    const app = await createApp();

    const res = await request(app).get('/api/auth/test-pharmacies?includePassword=1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accounts: [
        {
          id: 7,
          name: 'デモ薬局',
          email: 'demo@example.com',
          prefecture: '福岡県',
          password: 'DemoPass!999',
        },
      ],
    });
  });
});
