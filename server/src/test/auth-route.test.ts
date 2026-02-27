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
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

describe('auth routes', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalExposePasswordResetToken = process.env.EXPOSE_PASSWORD_RESET_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = 'false';
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
      return;
    }
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = originalExposePasswordResetToken;
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
});
