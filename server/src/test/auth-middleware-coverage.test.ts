import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────
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

import {
  requireLogin,
  requireAdmin,
  clearAuthUserCacheForTests,
  invalidateAuthUserCache,
} from '../middleware/auth';

// ── Helper: create Drizzle select chain ──────────────
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
  query.then = (onFulfilled, onRejected) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return query;
}

// ── Helper: create mock response ──────────────
function createRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

// ── Helper: create mock request ──────────────
function createReq(token?: string) {
  return {
    cookies: token ? { token } : {},
    user: undefined as { id: number; email: string; isAdmin: boolean } | undefined,
  };
}

describe('auth middleware (coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthUserCacheForTests();
  });

  afterEach(() => {
    clearAuthUserCacheForTests();
  });

  // ────────────────────────────────────────────────────
  // requireLogin
  // ────────────────────────────────────────────────────
  describe('requireLogin', () => {
    it('should return 401 when no token is present', async () => {
      const req = createReq();
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'ログインが必要です' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when no cookies object exists', async () => {
      const req = { cookies: undefined, user: undefined };
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when token verification throws', async () => {
      mocks.verifyToken.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const req = createReq('bad-token');
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'セッションが無効です。再度ログインしてください' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when sessionVersion is missing', async () => {
      mocks.verifyToken.mockReturnValue({
        id: 1,
        email: 'test@example.com',
        isAdmin: false,
        sessionVersion: '',
      });

      const req = createReq('valid-token');
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when sessionVersion is not a string', async () => {
      mocks.verifyToken.mockReturnValue({
        id: 1,
        email: 'test@example.com',
        isAdmin: false,
        sessionVersion: 123,
      });

      const req = createReq('valid-token');
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not found in DB', async () => {
      mocks.verifyToken.mockReturnValue({
        id: 999,
        email: 'ghost@example.com',
        isAdmin: false,
        sessionVersion: 'v1',
      });
      mocks.select.mockImplementation(() => createSelectQuery([]));

      const req = createReq('valid-token');
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'アカウントが無効です。再度ログインしてください' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when inactive user has no special verification status', async () => {
      mocks.verifyToken.mockReturnValue({
        id: 1,
        email: 'inactive@example.com',
        isAdmin: false,
        sessionVersion: 'v1',
      });
      mocks.select.mockImplementation(() =>
        createSelectQuery([{
          id: 1,
          email: 'inactive@example.com',
          isAdmin: false,
          isActive: false,
          passwordHash: 'hashed',
          verificationStatus: 'unverified',
          rejectionReason: null,
        }]),
      );

      const req = createReq('valid-token');
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'アカウントが無効です' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 when inactive user is pending_verification', async () => {
      mocks.verifyToken.mockReturnValue({
        id: 2,
        email: 'pending@example.com',
        isAdmin: false,
        sessionVersion: 'v1',
      });
      mocks.select.mockImplementation(() =>
        createSelectQuery([{
          id: 2,
          email: 'pending@example.com',
          isAdmin: false,
          isActive: false,
          passwordHash: 'hashed',
          verificationStatus: 'pending_verification',
          rejectionReason: null,
        }]),
      );

      const req = createReq('valid-token');
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ verificationStatus: 'pending_verification' }),
      );
    });

    it('should return 403 when inactive user is rejected', async () => {
      mocks.verifyToken.mockReturnValue({
        id: 3,
        email: 'rejected@example.com',
        isAdmin: false,
        sessionVersion: 'v1',
      });
      mocks.select.mockImplementation(() =>
        createSelectQuery([{
          id: 3,
          email: 'rejected@example.com',
          isAdmin: false,
          isActive: false,
          passwordHash: 'hashed',
          verificationStatus: 'rejected',
          rejectionReason: '書類不備',
        }]),
      );

      const req = createReq('valid-token');
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationStatus: 'rejected',
          rejectionReason: '書類不備',
        }),
      );
    });

    it('should return 401 when session version does not match', async () => {
      mocks.verifyToken.mockReturnValue({
        id: 4,
        email: 'stale@example.com',
        isAdmin: false,
        sessionVersion: 'old-version',
      });
      mocks.deriveSessionVersion.mockReturnValue('new-version');
      mocks.select.mockImplementation(() =>
        createSelectQuery([{
          id: 4,
          email: 'stale@example.com',
          isAdmin: false,
          isActive: true,
          passwordHash: 'hashed',
          verificationStatus: 'verified',
          rejectionReason: null,
        }]),
      );

      const req = createReq('valid-token');
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next and set req.user on successful auth', async () => {
      mocks.verifyToken.mockReturnValue({
        id: 5,
        email: 'valid@example.com',
        isAdmin: false,
        sessionVersion: 'sv1',
      });
      mocks.deriveSessionVersion.mockReturnValue('sv1');
      mocks.select.mockImplementation(() =>
        createSelectQuery([{
          id: 5,
          email: 'valid@example.com',
          isAdmin: false,
          isActive: true,
          passwordHash: 'hashed',
          verificationStatus: 'verified',
          rejectionReason: null,
        }]),
      );

      const req = createReq('valid-token');
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({
        id: 5,
        email: 'valid@example.com',
        isAdmin: false,
      });
    });

    it('should set isAdmin to false when DB returns null isAdmin', async () => {
      mocks.verifyToken.mockReturnValue({
        id: 6,
        email: 'admin-null@example.com',
        isAdmin: false,
        sessionVersion: 'sv1',
      });
      mocks.deriveSessionVersion.mockReturnValue('sv1');
      mocks.select.mockImplementation(() =>
        createSelectQuery([{
          id: 6,
          email: 'admin-null@example.com',
          isAdmin: null,
          isActive: true,
          passwordHash: 'hashed',
          verificationStatus: 'verified',
          rejectionReason: null,
        }]),
      );

      const req = createReq('valid-token');
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user?.isAdmin).toBe(false);
    });

    it('should return 500 when DB query throws', async () => {
      mocks.verifyToken.mockReturnValue({
        id: 7,
        email: 'error@example.com',
        isAdmin: false,
        sessionVersion: 'sv1',
      });
      mocks.select.mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      const req = createReq('valid-token');
      const res = createRes();
      const next = vi.fn();

      await requireLogin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: '認証処理中にエラーが発生しました' }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────
  // requireAdmin
  // ────────────────────────────────────────────────────
  describe('requireAdmin', () => {
    it('should return 403 when user is not admin', () => {
      const req = { user: { id: 1, email: 'user@example.com', isAdmin: false } };
      const res = createRes();
      const next = vi.fn();

      requireAdmin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: '管理者権限が必要です' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 when user is undefined', () => {
      const req = { user: undefined };
      const res = createRes();
      const next = vi.fn();

      requireAdmin(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next when user is admin', () => {
      const req = { user: { id: 1, email: 'admin@example.com', isAdmin: true } };
      const res = createRes();
      const next = vi.fn();

      requireAdmin(req as never, res as never, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────
  // invalidateAuthUserCache / clearAuthUserCacheForTests
  // ────────────────────────────────────────────────────
  describe('cache utility functions', () => {
    it('invalidateAuthUserCache should not throw for non-existing user', () => {
      expect(() => invalidateAuthUserCache(99999)).not.toThrow();
    });

    it('clearAuthUserCacheForTests should not throw', () => {
      expect(() => clearAuthUserCacheForTests()).not.toThrow();
    });
  });
});
