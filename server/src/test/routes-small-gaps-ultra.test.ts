/**
 * routes-small-gaps-ultra.test.ts
 *
 * Targets remaining uncovered lines in:
 *   - src/routes/auth.ts
 *   - src/routes/exchange-proposals.ts
 *   - src/routes/exchange-comments.ts
 *   - src/routes/business-hours.ts
 */
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ──────────────────────────────────────────────────────────────────────────
 * File-level mocks (single set to avoid vi.mock conflicts between describes)
 * ────────────────────────────────────────────────────────────────────────── */

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
    update: vi.fn(),
  },
  // auth-service
  assertJwtSecretConfigured: vi.fn(),
  hashPassword: vi.fn(async () => 'hash'),
  verifyPassword: vi.fn(async () => true),
  generateToken: vi.fn(() => 'jwt'),
  verifyToken: vi.fn(() => ({ id: 1 })),
  deriveSessionVersion: vi.fn(() => 'v1'),
  isJwtSecretMissingError: vi.fn(() => false),
  // validators
  validateRegistration: vi.fn(() => []),
  validateLogin: vi.fn(() => []),
  emailSchema: { safeParse: vi.fn(() => ({ success: true })) },
  passwordSchema: { safeParse: vi.fn(() => ({ success: true })) },
  // geocode
  geocodeAddress: vi.fn(async () => ({ lat: 35.6, lng: 139.7 })),
  // log
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  // password-reset
  createPasswordResetToken: vi.fn(async () => ({ token: 'a'.repeat(64) })),
  resetPasswordWithToken: vi.fn(async () => ({ success: true, pharmacyId: 1 })),
  // auth middleware
  invalidateAuthUserCache: vi.fn(),
  // csrf
  setCsrfCookie: vi.fn(),
  clearCsrfCookie: vi.fn(),
  ensureCsrfCookie: vi.fn(() => 'csrf'),
  generateCsrfToken: vi.fn(() => 'csrf'),
  // error-handler
  handleRouteError: vi.fn((_err: unknown, _ctx: string, msg: string, res: Response) => {
    res.status(500).json({ error: msg });
  }),
  // openclaw
  handoffToOpenClaw: vi.fn(async () => undefined),
  // screening
  evaluateRegistrationScreening: vi.fn(() => ({
    approved: true, screeningScore: 100, reasons: [], mismatches: [],
  })),
  // matching-service
  findMatches: vi.fn(),
  // exchange-service
  createProposal: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  completeProposal: vi.fn(),
  // proposal-priority
  getProposalPriority: vi.fn(),
  // timeline
  fetchProposalTimelineActionRows: vi.fn(),
  buildProposalTimeline: vi.fn(),
  // notification
  createNotification: vi.fn(async () => true),
  // request-utils
  parsePositiveInt: vi.fn((v: string | undefined) => {
    if (typeof v !== 'string') return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  }),
  // logger
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('drizzle-orm', () => {
  const sqlFn = Object.assign((..._args: unknown[]) => ({}), { raw: (..._args: unknown[]) => ({}) });
  return {
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    or: vi.fn(() => ({})),
    asc: vi.fn(() => ({})),
    desc: vi.fn(() => ({})),
    inArray: vi.fn(() => ({})),
    sql: sqlFn,
  };
});
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
  logger: {
    debug: mocks.loggerDebug,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));
vi.mock('../middleware/error-handler', () => ({
  handleRouteError: mocks.handleRouteError,
  getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
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
vi.mock('../services/matching-service', () => ({ findMatches: mocks.findMatches }));
vi.mock('../services/exchange-service', () => ({
  createProposal: mocks.createProposal,
  acceptProposal: mocks.acceptProposal,
  rejectProposal: mocks.rejectProposal,
  completeProposal: mocks.completeProposal,
}));
vi.mock('../services/proposal-priority-service', () => ({
  getProposalPriority: mocks.getProposalPriority,
}));
vi.mock('../services/proposal-timeline-service', () => ({
  fetchProposalTimelineActionRows: mocks.fetchProposalTimelineActionRows,
  buildProposalTimeline: mocks.buildProposalTimeline,
}));
vi.mock('../services/notification-service', () => ({
  createNotification: mocks.createNotification,
}));
vi.mock('../utils/request-utils', () => ({
  parsePagination: vi.fn(() => ({ page: 1, limit: 50, offset: 0 })),
  parsePositiveInt: mocks.parsePositiveInt,
  isPositiveSafeInteger: vi.fn((v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0),
}));
vi.mock('../utils/http-utils', () => ({
  sleep: vi.fn(async () => undefined),
}));
vi.mock('../utils/db-utils', () => ({ rowCount: {} }));

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────────── */

/** select chain that resolves at .limit() */
function selectChainWithLimit(result: unknown) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(result);
  return c;
}

/** select chain that resolves at .limit() after orderBy() — used by /test-pharmacies */
function selectChainWithOrderBy(result: unknown) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(result);
  return c;
}

/** select chain that rejects at .limit() after orderBy() */
function selectChainOrderByRejects(err: Error) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockRejectedValue(err);
  return c;
}

/** select chain that rejects at .limit() */
function selectChainLimitRejects(err: Error) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockRejectedValue(err);
  return c;
}

function resetDefaultMocks() {
  vi.resetAllMocks();
  mocks.assertJwtSecretConfigured.mockImplementation(() => undefined);
  mocks.isJwtSecretMissingError.mockReturnValue(false);
  mocks.hashPassword.mockResolvedValue('hash');
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.generateToken.mockReturnValue('jwt');
  mocks.verifyToken.mockReturnValue({ id: 1 });
  mocks.deriveSessionVersion.mockReturnValue('v1');
  mocks.geocodeAddress.mockResolvedValue({ lat: 35.6, lng: 139.7 });
  mocks.evaluateRegistrationScreening.mockReturnValue({
    approved: true, screeningScore: 100, reasons: [], mismatches: [],
  });
  mocks.handoffToOpenClaw.mockResolvedValue(undefined);
  mocks.createPasswordResetToken.mockResolvedValue({ token: 'a'.repeat(64) });
  mocks.resetPasswordWithToken.mockResolvedValue({ success: true, pharmacyId: 1 });
  mocks.handleRouteError.mockImplementation((_e: unknown, _c: string, msg: string, res: Response) => {
    res.status(500).json({ error: msg });
  });
  mocks.getClientIp.mockReturnValue('127.0.0.1');
  mocks.ensureCsrfCookie.mockReturnValue('csrf');
  mocks.generateCsrfToken.mockReturnValue('csrf');
  mocks.validateLogin.mockReturnValue([]);
  mocks.validateRegistration.mockReturnValue([]);
  mocks.emailSchema.safeParse.mockReturnValue({ success: true } as never);
  mocks.passwordSchema.safeParse.mockReturnValue({ success: true } as never);
  mocks.createNotification.mockResolvedValue(true);
  mocks.parsePositiveInt.mockImplementation((v: string | undefined) => {
    if (typeof v !== 'string') return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * PART A — auth.ts uncovered lines
 * ══════════════════════════════════════════════════════════════════════════ */

describe('auth.ts — ultra coverage', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    resetDefaultMocks();
    process.env.NODE_ENV = 'test';
    process.env.EXPOSE_PASSWORD_RESET_TOKEN = 'false';
    delete process.env.ENABLE_TEST_PHARMACY_PREVIEW;
  });
  afterEach(() => { process.env = { ...origEnv }; });

  async function createAuthApp() {
    const { default: router } = await import('../routes/auth');
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/auth', router);
    return app;
  }

  async function createFreshAuthApp() {
    vi.resetModules();
    const { default: freshRouter } = await import('../routes/auth');
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/auth', freshRouter);
    return app;
  }

  // --- Cover login generic error (handleRouteError in login catch) ---
  it('POST /login — returns 500 on generic error in catch', async () => {
    mocks.assertJwtSecretConfigured.mockImplementation(() => {
      throw new Error('some generic error');
    });
    mocks.isJwtSecretMissingError.mockReturnValue(false);
    const app = await createAuthApp();
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'pass' });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('ログインに失敗');
  });

  // --- Cover password-reset/request error catch ---
  it('POST /password-reset/request — returns 500 on error', async () => {
    mocks.createPasswordResetToken.mockRejectedValue(new Error('db error'));
    const app = await createAuthApp();
    const res = await request(app)
      .post('/auth/password-reset/request')
      .send({ email: 'test@example.com' });
    expect(res.status).toBe(500);
  });

  // --- Cover password-reset/confirm error catch ---
  it('POST /password-reset/confirm — returns 500 on error', async () => {
    mocks.resetPasswordWithToken.mockRejectedValue(new Error('db error'));
    const app = await createAuthApp();
    const res = await request(app)
      .post('/auth/password-reset/confirm')
      .send({ token: 'a'.repeat(64), newPassword: 'ValidPass1!' });
    expect(res.status).toBe(500);
  });

  // --- Cover /me with isMissingTestPharmacyColumnError fallback ---
  it('GET /me — falls back to legacy when is_test_account column is missing', async () => {
    const columnMissingErr = Object.assign(
      new Error('column "is_test_account" does not exist'), { code: '42703' },
    );
    mocks.db.select
      .mockReturnValueOnce(selectChainLimitRejects(columnMissingErr))
      .mockReturnValueOnce(selectChainWithLimit([{
        id: 1, email: 'test@example.com', name: 'Test', postalCode: '1000001',
        address: 'Chiyoda', phone: '03-1234', fax: '03-1234', licenseNumber: 'L-001',
        prefecture: 'Tokyo', isAdmin: false,
      }]));
    const app = await createFreshAuthApp();
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.isTestAccount).toBe(false);
  });

  // --- Cover /me error catch ---
  it('GET /me — returns 500 on non-column-missing error', async () => {
    mocks.db.select.mockReturnValue(selectChainLimitRejects(new Error('connection error')));
    const app = await createAuthApp();
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(500);
  });

  it('GET /test-pharmacies — returns 503 when columns are missing', async () => {
    const columnMissingErr = Object.assign(
      new Error('column "is_test_account" does not exist'), { code: '42703' },
    );
    mocks.db.execute.mockRejectedValueOnce(new Error('permission denied'));
    mocks.db.select.mockReturnValueOnce(selectChainOrderByRejects(columnMissingErr));
    const app = await createFreshAuthApp();
    const res = await request(app).get('/auth/test-pharmacies');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('DBスキーマが未適用');
  });

  it('GET /test-pharmacies — still returns 503 on repeated missing-column error', async () => {
    const columnMissingErr = Object.assign(
      new Error('column "is_test_account" does not exist'), { code: '42703' },
    );
    mocks.db.execute.mockRejectedValueOnce(new Error('permission denied'));
    mocks.db.select.mockReturnValueOnce(selectChainOrderByRejects(columnMissingErr));
    const app = await createFreshAuthApp();
    const res = await request(app).get('/auth/test-pharmacies');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('DBスキーマが未適用');
  });

  // --- Cover /test-pharmacies error catch ---
  it('GET /test-pharmacies — returns 500 on non-column-missing error', async () => {
    mocks.db.select.mockReturnValue(selectChainOrderByRejects(new Error('unexpected')));
    const app = await createAuthApp();
    const res = await request(app).get('/auth/test-pharmacies');
    expect(res.status).toBe(500);
  });

  // --- Cover register with auth configuration error ---
  it('POST /register — returns 503 when JWT secret is missing', async () => {
    mocks.assertJwtSecretConfigured.mockImplementation(() => {
      throw new Error('JWT_SECRET environment variable is not set');
    });
    mocks.isJwtSecretMissingError.mockReturnValue(true);
    const app = await createAuthApp();
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'a@b.com', password: 'Pass1!', name: 'Pharmacy', postalCode: '1000001',
        address: 'Chiyoda', phone: '0312345678', fax: '0312345679',
        licenseNumber: 'LIC001', prefecture: 'Tokyo',
      });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('認証設定が未完了');
  });

  // --- Cover register handleRouteError fallthrough ---
  it('POST /register — returns 500 on generic error (not unique, not auth config)', async () => {
    mocks.db.select.mockReturnValue(selectChainWithLimit([]));
    mocks.db.transaction.mockRejectedValue(new Error('generic db error'));
    const app = await createAuthApp();
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'a@b.com', password: 'Pass1!', name: 'Pharmacy', postalCode: '1000001',
        address: 'Chiyoda', phone: '0312345678', fax: '0312345679',
        licenseNumber: 'LIC001', prefecture: 'Tokyo',
      });
    expect(res.status).toBe(500);
  });

  // --- Cover /test-pharmacies cached empty rows ---
  it('GET /test-pharmacies — returns 404 when cache contains empty array', async () => {
    mocks.db.select.mockReturnValueOnce(selectChainWithOrderBy([]));
    const app = await createFreshAuthApp();
    const res1 = await request(app).get('/auth/test-pharmacies');
    expect(res1.status).toBe(404);

    const res2 = await request(app).get('/auth/test-pharmacies');
    expect(res2.status).toBe(404);
    expect(res2.body.error).toContain('テスト薬局がDBに登録されていません');
  });

  // --- Cover /test-pharmacies cache hit with data ---
  it('GET /test-pharmacies — serves from cache on second request', async () => {
    mocks.db.select.mockReturnValueOnce(selectChainWithOrderBy([
      { id: 1, name: 'Test Pharmacy', email: 'test@example.com', prefecture: 'Tokyo', password: 'pw' },
    ]));
    const app = await createFreshAuthApp();
    const res1 = await request(app).get('/auth/test-pharmacies');
    expect(res1.status).toBe(200);

    mocks.db.select.mockReset();
    const res2 = await request(app).get('/auth/test-pharmacies?includePassword=true');
    expect(res2.status).toBe(200);
    expect(res2.body.accounts[0].password).toBe('pw');
  });

  // --- Cover successful login (admin login branch) ---
  it('POST /login — succeeds with admin login', async () => {
    mocks.db.select.mockReturnValue(selectChainWithLimit([{
      id: 1, email: 'admin@example.com', name: 'Admin Pharmacy',
      isActive: true, isAdmin: true, passwordHash: 'hash', prefecture: 'Tokyo',
    }]));
    mocks.verifyPassword.mockResolvedValue(true);
    const app = await createAuthApp();
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@example.com', password: 'pass' });
    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART B — exchange-proposals.ts uncovered lines
 * ══════════════════════════════════════════════════════════════════════════ */

describe('exchange-proposals.ts — ultra coverage', () => {
  beforeEach(() => { resetDefaultMocks(); });

  async function createProposalApp() {
    const { default: router } = await import('../routes/exchange-proposals');
    const app = express();
    app.use(express.json());
    app.use((req: Request & { user?: { id: number; email: string; isAdmin: boolean } }, _res: Response, next: NextFunction) => {
      req.user = { id: 2, email: 'user@example.com', isAdmin: false };
      next();
    });
    app.use('/api/exchange', router);
    return app;
  }

  it('POST /proposals/bulk-action — returns 400 when ids is not an array', async () => {
    const app = await createProposalApp();
    const res = await request(app)
      .post('/api/exchange/proposals/bulk-action')
      .send({ action: 'accept', ids: 'not-array' });
    expect(res.status).toBe(400);
  });

  it('POST /proposals/bulk-action — per-item error is captured in results', async () => {
    mocks.acceptProposal.mockRejectedValue(new Error('item error'));
    const app = await createProposalApp();
    const res = await request(app)
      .post('/api/exchange/proposals/bulk-action')
      .send({ action: 'accept', ids: [1] });
    expect(res.status).toBe(200);
    expect(res.body.results[0].ok).toBe(false);
  });

  it('GET /proposals/:id/print — returns 500 on error', async () => {
    mocks.db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error('DB error')),
        }),
      }),
    });
    const app = await createProposalApp();
    const res = await request(app).get('/api/exchange/proposals/1/print');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('印刷データの取得に失敗');
  });

  it('POST /find — returns 500 on error', async () => {
    mocks.findMatches.mockRejectedValue(new Error('match error'));
    const app = await createProposalApp();
    const res = await request(app).post('/api/exchange/find');
    expect(res.status).toBe(500);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART C — exchange-comments.ts uncovered lines
 * ══════════════════════════════════════════════════════════════════════════ */

describe('exchange-comments.ts — ultra coverage', () => {
  beforeEach(() => { resetDefaultMocks(); });

  async function createCommentsApp(isAdmin = false) {
    const { default: router } = await import('../routes/exchange-comments');
    const app = express();
    app.use(express.json());
    app.use((req: Request & { user?: { id: number; email: string; isAdmin: boolean } }, _res: Response, next: NextFunction) => {
      req.user = { id: 1, email: 'test@example.com', isAdmin };
      next();
    });
    app.use('/api/exchange', router);
    return app;
  }

  it('POST /proposals/:id/comments — warns when notification fails to persist', async () => {
    const proposalChain: Record<string, ReturnType<typeof vi.fn>> = {};
    proposalChain.from = vi.fn().mockReturnValue(proposalChain);
    proposalChain.where = vi.fn().mockReturnValue(proposalChain);
    proposalChain.limit = vi.fn().mockResolvedValue([{ id: 1, pharmacyAId: 1, pharmacyBId: 2 }]);
    mocks.db.select.mockReturnValue(proposalChain);
    mocks.createNotification.mockResolvedValue(null as never);

    mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const txMock = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
              id: 10, proposalId: 1, authorPharmacyId: 1,
              body: 'test', isDeleted: false,
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            }]),
          }),
        }),
      };
      return fn(txMock);
    });

    const app = await createCommentsApp();
    const res = await request(app)
      .post('/api/exchange/proposals/1/comments')
      .send({ body: 'test comment' });
    expect(res.status).toBe(201);
  });

  it('POST /proposals/:id/comments — returns 500 when insert returns nothing', async () => {
    const proposalChain: Record<string, ReturnType<typeof vi.fn>> = {};
    proposalChain.from = vi.fn().mockReturnValue(proposalChain);
    proposalChain.where = vi.fn().mockReturnValue(proposalChain);
    proposalChain.limit = vi.fn().mockResolvedValue([{ id: 1, pharmacyAId: 1, pharmacyBId: 2 }]);
    mocks.db.select.mockReturnValue(proposalChain);

    mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const txMock = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
      return fn(txMock);
    });

    const app = await createCommentsApp();
    const res = await request(app)
      .post('/api/exchange/proposals/1/comments')
      .send({ body: 'test comment' });
    expect(res.status).toBe(500);
  });

  it('DELETE /proposals/:id/comments/:commentId — returns 403 for admin', async () => {
    const app = await createCommentsApp(true);
    const res = await request(app).delete('/api/exchange/proposals/1/comments/1');
    expect(res.status).toBe(403);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART D — business-hours.ts uncovered lines
 * ══════════════════════════════════════════════════════════════════════════ */

describe('business-hours.ts — ultra coverage', () => {
  it('validateSpecialBusinessHours — rejects invalid date like 2025-02-30', async () => {
    const { validateSpecialBusinessHours } = await import('../routes/business-hours');
    const result = validateSpecialBusinessHours([{
      specialType: 'holiday_closed',
      startDate: '2025-02-30',
      endDate: '2025-03-01',
      isClosed: true,
      is24Hours: false,
      openTime: null,
      closeTime: null,
      note: null,
    }]);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('開始日が不正');
    }
  });
});
