import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  verifyToken: vi.fn(),
  deriveSessionVersion: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock('../services/auth-service', () => ({
  verifyToken: mocks.verifyToken,
  deriveSessionVersion: mocks.deriveSessionVersion,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}));

import { clearAuthUserCacheForTests, requireLogin, requireAdmin } from '../middleware/auth';

function createSelectQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    then: undefined as unknown,
  } as {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    then: Promise<unknown>['then'];
  };

  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  query.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);

  return query;
}

function createRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('auth-middleware-ultra', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearAuthUserCacheForTests();
  });

  afterEach(() => {
    clearAuthUserCacheForTests();
  });

  // ── requireLogin: cookies is undefined ──
  describe('requireLogin — no cookies object', () => {
    it('returns 401 when cookies is undefined', async () => {
      const req = { cookies: undefined } as { cookies?: Record<string, string>; user?: unknown };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'ログインが必要です' }),
      );
    });

    it('returns 401 when cookies is null', async () => {
      const req = { cookies: null } as unknown as { cookies: Record<string, string>; user?: unknown };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // ── requireLogin: sessionVersion as undefined ──
  describe('requireLogin — sessionVersion is undefined', () => {
    it('returns 401 when sessionVersion is undefined', async () => {
      mocks.verifyToken.mockReturnValueOnce({
        id: 1,
        email: 'a@b.com',
        isAdmin: false,
        sessionVersion: undefined,
      });
      const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('セッションが無効') }),
      );
    });
  });

  // ── requireLogin: inactive user with pending_verification from DB ──
  describe('requireLogin — inactive user sendInactiveAccountResponse from DB path', () => {
    it('returns 403 for pending_verification from DB lookup', async () => {
      mocks.verifyToken.mockReturnValueOnce({
        id: 40,
        email: 'pending@test.com',
        isAdmin: false,
        sessionVersion: 'v1',
      });
      mocks.select.mockImplementation(() => createSelectQuery([{
        id: 40,
        email: 'pending@test.com',
        isAdmin: false,
        isActive: false,
        passwordHash: 'hash',
        verificationStatus: 'pending_verification',
        rejectionReason: null,
      }]));

      const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: '審査中です', verificationStatus: 'pending_verification' }),
      );
    });

    it('returns 403 for rejected from DB lookup with rejectionReason', async () => {
      mocks.verifyToken.mockReturnValueOnce({
        id: 41,
        email: 'rejected@test.com',
        isAdmin: false,
        sessionVersion: 'v1',
      });
      mocks.select.mockImplementation(() => createSelectQuery([{
        id: 41,
        email: 'rejected@test.com',
        isAdmin: false,
        isActive: false,
        passwordHash: 'hash',
        verificationStatus: 'rejected',
        rejectionReason: '書類不備',
      }]));

      const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: '却下されました',
          verificationStatus: 'rejected',
          rejectionReason: '書類不備',
        }),
      );
    });

    it('returns 401 for inactive user with "verified" status (else branch)', async () => {
      mocks.verifyToken.mockReturnValueOnce({
        id: 42,
        email: 'inactive-verified@test.com',
        isAdmin: false,
        sessionVersion: 'v1',
      });
      mocks.select.mockImplementation(() => createSelectQuery([{
        id: 42,
        email: 'inactive-verified@test.com',
        isAdmin: false,
        isActive: false,
        passwordHash: 'hash',
        verificationStatus: 'verified',
        rejectionReason: null,
      }]));

      const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'アカウントが無効です' }),
      );
    });
  });

  // ── requireLogin: sessionVersion mismatch from DB ──
  describe('requireLogin — sessionVersion mismatch from DB', () => {
    it('returns 401 when derived sessionVersion does not match token', async () => {
      mocks.verifyToken.mockReturnValueOnce({
        id: 50,
        email: 'stale@test.com',
        isAdmin: false,
        sessionVersion: 'old-ver',
      });
      mocks.deriveSessionVersion.mockReturnValueOnce('new-ver');
      mocks.select.mockImplementation(() => createSelectQuery([{
        id: 50,
        email: 'stale@test.com',
        isAdmin: false,
        isActive: true,
        passwordHash: 'hash',
        verificationStatus: 'verified',
        rejectionReason: null,
      }]));

      const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('セッションが無効') }),
      );
    });
  });

  // ── requireLogin: successful auth sets req.user and calls next ──
  describe('requireLogin — successful auth', () => {
    it('sets req.user with isAdmin=true from DB', async () => {
      mocks.verifyToken.mockReturnValueOnce({
        id: 60,
        email: 'admin@test.com',
        isAdmin: true,
        sessionVersion: 'v1',
      });
      mocks.deriveSessionVersion.mockReturnValueOnce('v1');
      mocks.select.mockImplementation(() => createSelectQuery([{
        id: 60,
        email: 'admin@test.com',
        isAdmin: true,
        isActive: true,
        passwordHash: 'hash',
        verificationStatus: 'verified',
        rejectionReason: null,
      }]));

      const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((req as { user?: { id: number; isAdmin: boolean } }).user).toEqual(
        expect.objectContaining({ id: 60, isAdmin: true }),
      );
    });

    it('sets isAdmin to false when DB returns null isAdmin', async () => {
      mocks.verifyToken.mockReturnValueOnce({
        id: 61,
        email: 'nulladmin@test.com',
        isAdmin: false,
        sessionVersion: 'v1',
      });
      mocks.deriveSessionVersion.mockReturnValueOnce('v1');
      mocks.select.mockImplementation(() => createSelectQuery([{
        id: 61,
        email: 'nulladmin@test.com',
        isAdmin: null,
        isActive: true,
        passwordHash: 'hash',
        verificationStatus: 'verified',
        rejectionReason: null,
      }]));

      const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((req as { user?: { isAdmin: boolean } }).user?.isAdmin).toBe(false);
    });
  });

  // ── requireLogin: DB error catch branch ──
  describe('requireLogin — DB error catch', () => {
    it('returns 500 when DB select rejects', async () => {
      mocks.verifyToken.mockReturnValueOnce({
        id: 70,
        email: 'error@test.com',
        isAdmin: false,
        sessionVersion: 'v1',
      });
      const failQuery = createSelectQuery([]);
      failQuery.limit.mockRejectedValue(new Error('connection lost'));
      failQuery.then = (onFulfilled, onRejected) =>
        Promise.reject(new Error('connection lost')).then(onFulfilled, onRejected);
      mocks.select.mockImplementation(() => failQuery);

      const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: '認証処理中にエラーが発生しました' }),
      );
    });

    it('returns 500 when select throws synchronously', async () => {
      mocks.verifyToken.mockReturnValueOnce({
        id: 71,
        email: 'throw@test.com',
        isAdmin: false,
        sessionVersion: 'v1',
      });
      mocks.select.mockImplementation(() => {
        throw new Error('sync error');
      });

      const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── requireAdmin ──
  describe('requireAdmin', () => {
    it('returns 403 when user is not present on request', () => {
      const req = {} as { user?: { isAdmin: boolean } };
      const res = createRes();
      const next = vi.fn();

      requireAdmin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: '管理者権限が必要です' }),
      );
    });

    it('returns 403 when user.isAdmin is false', () => {
      const req = { user: { id: 1, email: 'user@test.com', isAdmin: false } };
      const res = createRes();
      const next = vi.fn();

      requireAdmin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('calls next when user.isAdmin is true', () => {
      const req = { user: { id: 1, email: 'admin@test.com', isAdmin: true } };
      const res = createRes();
      const next = vi.fn();

      requireAdmin(req as never, res as never, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── clearAuthUserCacheForTests ──
  describe('clearAuthUserCacheForTests', () => {
    it('does not throw when called', () => {
      expect(() => clearAuthUserCacheForTests()).not.toThrow();
    });
  });
});
