import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertJwtSecretConfigured: vi.fn(),
  generateToken: vi.fn(() => 'signed-token'),
  invalidateAuthUserCache: vi.fn(),
  setCsrfCookie: vi.fn(),
  generateCsrfToken: vi.fn(() => 'csrf-token'),
  timingSafeCompare: vi.fn((left: string, right: string) => left === right),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  handleRouteError: vi.fn((_err: unknown, _ctx: string, message: string, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
    res.status(500).json({ error: message });
  }),
  getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
  getAuthorizationUrl: vi.fn((_screenHint: 'sign-in' | 'sign-up', state: string) => `https://workos.example/auth?state=${state}`),
  authenticateWithCode: vi.fn(),
  findOrLinkPharmacy: vi.fn(),
  generateOnboardingToken: vi.fn(() => 'onboarding-token'),
  verifyOnboardingToken: vi.fn(),
  buildTokenPayload: vi.fn((pharmacy: { id: number; email: string }) => ({ sub: pharmacy.id, email: pharmacy.email })),
  setAuthCookie: vi.fn(),
  getLoginLogAction: vi.fn(() => 'pharmacy_login'),
  loggerError: vi.fn(),
}));

function mockAuthWorkosRouteDependencies() {
  vi.doMock('../services/auth-service', () => ({
    assertJwtSecretConfigured: mocks.assertJwtSecretConfigured,
    generateToken: mocks.generateToken,
  }));

  vi.doMock('../middleware/auth', () => ({
    invalidateAuthUserCache: mocks.invalidateAuthUserCache,
  }));

  vi.doMock('../middleware/csrf', () => ({
    setCsrfCookie: mocks.setCsrfCookie,
    generateCsrfToken: mocks.generateCsrfToken,
    timingSafeCompare: mocks.timingSafeCompare,
  }));

  vi.doMock('../services/log-service', () => ({
    writeLog: mocks.writeLog,
    getClientIp: mocks.getClientIp,
  }));

  vi.doMock('../services/logger', () => ({
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: mocks.loggerError,
    },
  }));

  vi.doMock('../middleware/error-handler', () => ({
    handleRouteError: mocks.handleRouteError,
    getErrorMessage: mocks.getErrorMessage,
  }));

  vi.doMock('../services/workos-service', () => ({
    getAuthorizationUrl: mocks.getAuthorizationUrl,
    authenticateWithCode: mocks.authenticateWithCode,
    findOrLinkPharmacy: mocks.findOrLinkPharmacy,
    generateOnboardingToken: mocks.generateOnboardingToken,
    verifyOnboardingToken: mocks.verifyOnboardingToken,
  }));

  vi.doMock('../routes/auth-helpers', () => ({
    buildTokenPayload: mocks.buildTokenPayload,
    setAuthCookie: mocks.setAuthCookie,
    getLoginLogAction: mocks.getLoginLogAction,
  }));
}

let authWorkosRouter: express.Router;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authWorkosRouter);
  return app;
}

describe('auth WorkOS routes', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockAuthWorkosRouteDependencies();
    ({ default: authWorkosRouter } = await import('../routes/auth-workos'));
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    delete process.env.CLIENT_URL;
    delete process.env.VERCEL_URL;
  });

  it('GET /api/auth/login returns a login URL and sets the OAuth state cookie', async () => {
    const res = await request(createApp()).get('/api/auth/login');

    expect(res.status).toBe(200);
    expect(res.body.url).toContain('https://workos.example/auth?state=');
    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith('sign-in', expect.any(String));
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('oauth_state=')]),
    );
  });

  it('GET /api/auth/register returns a sign-up URL', async () => {
    const res = await request(createApp()).get('/api/auth/register');

    expect(res.status).toBe(200);
    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith('sign-up', expect.any(String));
  });

  it('GET /api/auth/callback rejects invalid OAuth state', async () => {
    const res = await request(createApp())
      .get('/api/auth/callback?code=test-code&state=unexpected')
      .set('Cookie', 'oauth_state=expected');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'OAuth state パラメータが無効です' });
    expect(mocks.authenticateWithCode).not.toHaveBeenCalled();
  });

  it('GET /api/auth/callback redirects new users to onboarding with the onboarding cookie', async () => {
    mocks.authenticateWithCode.mockResolvedValue({
      user: { id: 'user_123', email: 'new@example.com' },
    });
    mocks.findOrLinkPharmacy.mockResolvedValue({
      pharmacy: null,
      isNewUser: true,
    });

    const res = await request(createApp())
      .get('/api/auth/callback?code=test-code&state=expected')
      .set('Cookie', 'oauth_state=expected');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/onboarding');
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('onboarding_token=onboarding-token')]),
    );
  });

  it('GET /api/auth/callback logs in active existing users and redirects to the client root', async () => {
    mocks.authenticateWithCode.mockResolvedValue({
      user: { id: 'user_999', email: 'active@example.com' },
    });
    mocks.findOrLinkPharmacy.mockResolvedValue({
      pharmacy: {
        id: 42,
        name: '中央薬局',
        email: 'active@example.com',
        isAdmin: false,
        isActive: true,
        verificationStatus: 'verified',
      },
      isNewUser: false,
    });

    const res = await request(createApp())
      .get('/api/auth/callback?code=test-code&state=expected')
      .set('Cookie', 'oauth_state=expected');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173');
    expect(mocks.generateToken).toHaveBeenCalledWith({ sub: 42, email: 'active@example.com' });
    expect(mocks.setAuthCookie).toHaveBeenCalledWith(expect.anything(), 'signed-token', false);
    expect(mocks.setCsrfCookie).toHaveBeenCalledWith(expect.anything(), 'csrf-token');
    expect(mocks.writeLog).toHaveBeenCalledWith('pharmacy_login', expect.objectContaining({
      pharmacyId: 42,
    }));
  });

  it('GET /api/auth/onboarding-info returns 401 when the onboarding cookie is missing', async () => {
    const res = await request(createApp()).get('/api/auth/onboarding-info');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: 'Onboardingセッションが無効です。再度ログインしてください',
    });
  });

  it('GET /api/auth/onboarding-info returns onboarding claims from the cookie', async () => {
    mocks.verifyOnboardingToken.mockReturnValue({
      workosUserId: 'user_123',
      email: 'new@example.com',
    });

    const res = await request(createApp())
      .get('/api/auth/onboarding-info')
      .set('Cookie', 'onboarding_token=valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      workosUserId: 'user_123',
      email: 'new@example.com',
    });
  });
});
