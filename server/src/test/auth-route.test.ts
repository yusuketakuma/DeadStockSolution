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

describe('auth routes', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalExposePasswordResetToken = process.env.EXPOSE_PASSWORD_RESET_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = 'false';
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

  it('exposes password reset token when explicitly enabled in non-production', async () => {
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

  it('fails fast when token exposure is enabled in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = 'true';

    await expect(createApp()).rejects.toThrow('EXPOSE_PASSWORD_RESET_TOKEN=true は本番環境では許可されていません');
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
        email: 'demo@example.com',
        password: 'Password123',
        name: 'デモ薬局',
        postalCode: '100-0001',
        address: '千代田1-1',
        phone: '03-1234-5678',
        fax: '03-1234-5679',
        licenseNumber: 'DEMO-999',
        prefecture: '東京都',
      });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: '認証設定が未完了です。管理者に連絡してください' });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });
});
