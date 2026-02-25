import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPasswordResetToken: vi.fn(),
  resetPasswordWithToken: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
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

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { default: authRouter } = await import('../routes/auth');
  app.use('/api/auth', authRouter);
  return app;
}

describe('auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = 'false';
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
});
