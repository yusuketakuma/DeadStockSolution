/**
 * LEGACY_PASSWORD_AUTH_ENABLED フラグのテスト
 *
 * フラグが "false" の場合、POST /register, /login, /password-reset/request,
 * /password-reset/confirm が 410 Gone を返すことを確認する。
 * デフォルト（未設定 または "true"）では従来通り動作することも確認する。
 */

import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── モック ──────────────────────────────────────────────────────────────────
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
    hashPassword: vi.fn(async () => '$2b$10$hashedpassword'),
    verifyPassword: vi.fn(async () => true),
    deriveSessionVersion: vi.fn(() => 'session-v1'),
    generateToken: vi.fn(() => 'mock-token'),
    verifyToken: vi.fn(),
  },
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/password-reset-service', () => ({
  createPasswordResetToken: mocks.createPasswordResetToken,
  resetPasswordWithToken: mocks.resetPasswordWithToken,
}));
vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));
vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
vi.mock('../services/geocode-service', () => ({ geocodeAddress: mocks.geocodeAddress }));
vi.mock('../services/registration-screening-service', () => ({
  evaluateRegistrationScreening: mocks.evaluateRegistrationScreening,
}));
vi.mock('../services/openclaw-service', () => ({ handoffToOpenClaw: mocks.handoffToOpenClaw }));
vi.mock('../services/pharmacy-verification-service', () => ({
  PHARMACY_VERIFICATION_REQUEST_TYPE: 'pharmacy_verification',
}));
vi.mock('../middleware/auth', () => ({
  requireLogin: (_req: unknown, _res: unknown, next: () => void) => next(),
  invalidateAuthUserCache: vi.fn(),
}));
vi.mock('../middleware/csrf', () => ({
  clearCsrfCookie: vi.fn(),
  ensureCsrfCookie: vi.fn(() => 'mock-csrf-token'),
  generateCsrfToken: vi.fn(() => 'mock-csrf-token'),
  setCsrfCookie: vi.fn(),
  timingSafeCompare: vi.fn(() => true),
}));
vi.mock('../middleware/error-handler', () => ({
  handleRouteError: vi.fn(
    (_err: unknown, _ctx: string, msg: string, res: { status: (s: number) => { json: (b: unknown) => void } }) => {
      res.status(500).json({ error: msg });
    },
  ),
  getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));
vi.mock('../utils/http-utils', () => ({ sleep: vi.fn(async () => undefined) }));
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/workos-service', () => ({
  getAuthorizationUrl: vi.fn(() => 'https://workos.example.com/auth'),
  authenticateWithCode: vi.fn(),
  findOrLinkPharmacy: vi.fn(),
  generateOnboardingToken: vi.fn(() => 'mock-onboarding-token'),
  verifyOnboardingToken: vi.fn(),
}));

// ── ヘルパー ─────────────────────────────────────────────────────────────────
async function buildApp() {
  vi.resetModules();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { default: authRouter } = await import('../routes/auth');
  app.use('/api/auth', authRouter);
  return app;
}

// ── テスト ────────────────────────────────────────────────────────────────────
describe('LEGACY_PASSWORD_AUTH_ENABLED feature flag', () => {
  const LEGACY_ENDPOINTS = [
    ['POST', '/api/auth/register'],
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/password-reset/request'],
    ['POST', '/api/auth/password-reset/confirm'],
  ] as const;

  describe('when LEGACY_PASSWORD_AUTH_ENABLED=false', () => {
    beforeEach(() => {
      process.env.LEGACY_PASSWORD_AUTH_ENABLED = 'false';
    });

    afterEach(() => {
      delete process.env.LEGACY_PASSWORD_AUTH_ENABLED;
    });

    it.each(LEGACY_ENDPOINTS)(
      '%s %s returns 410 Gone with descriptive error',
      async (_method, path) => {
        const app = await buildApp();
        const res = await request(app).post(path).send({});
        expect(res.status).toBe(410);
        expect(res.body).toHaveProperty('error');
        expect(typeof res.body.error).toBe('string');
        expect(res.body.error.length).toBeGreaterThan(0);
      },
    );
  });

  describe('when LEGACY_PASSWORD_AUTH_ENABLED=true (explicit)', () => {
    beforeEach(() => {
      process.env.LEGACY_PASSWORD_AUTH_ENABLED = 'true';
    });

    afterEach(() => {
      delete process.env.LEGACY_PASSWORD_AUTH_ENABLED;
    });

    it('POST /api/auth/register does NOT return 410', async () => {
      // Expect anything other than 410 — registration will fail due to missing
      // body/mocks, but the gate must be open (not returning 410).
      const app = await buildApp();
      const res = await request(app).post('/api/auth/register').send({});
      expect(res.status).not.toBe(410);
    });

    it('POST /api/auth/login does NOT return 410', async () => {
      const app = await buildApp();
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).not.toBe(410);
    });
  });

  describe('when LEGACY_PASSWORD_AUTH_ENABLED is not set (default)', () => {
    beforeEach(() => {
      delete process.env.LEGACY_PASSWORD_AUTH_ENABLED;
    });

    it('POST /api/auth/register does NOT return 410', async () => {
      const app = await buildApp();
      const res = await request(app).post('/api/auth/register').send({});
      expect(res.status).not.toBe(410);
    });

    it('POST /api/auth/login does NOT return 410', async () => {
      const app = await buildApp();
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).not.toBe(410);
    });
  });

  describe('endpoints that must remain accessible regardless of flag', () => {
    beforeEach(() => {
      process.env.LEGACY_PASSWORD_AUTH_ENABLED = 'false';
    });

    afterEach(() => {
      delete process.env.LEGACY_PASSWORD_AUTH_ENABLED;
    });

    it('GET /api/auth/csrf-token returns 200 regardless of flag', async () => {
      const app = await buildApp();
      const res = await request(app).get('/api/auth/csrf-token');
      expect(res.status).toBe(200);
    });

    it('POST /api/auth/logout returns 200 regardless of flag', async () => {
      const app = await buildApp();
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
    });
  });
});
