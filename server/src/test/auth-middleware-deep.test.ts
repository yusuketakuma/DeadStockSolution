/**
 * auth-middleware-deep.test.ts
 * middleware/auth.ts の未カバーブランチを追加テスト
 * - requireLogin: no token, invalid token, empty sessionVersion
 * - requireLogin: user not found (0 rows), inactive with no verificationStatus
 * - requireLogin: db error catch
 * - requireAdmin: non-admin user, admin user
 * - sendInactiveAccountResponse: pending_verification, rejected, other
 */
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

describe('auth middleware deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthUserCacheForTests();
  });

  afterEach(() => {
    clearAuthUserCacheForTests();
  });

  // ── requireLogin: no token ──

  it('returns 401 when no token cookie is present', async () => {
    const req = { cookies: {} } as { cookies: Record<string, string>; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'ログインが必要です',
    }));
  });

  // ── requireLogin: invalid token (verifyToken throws) ──

  it('returns 401 when verifyToken throws', async () => {
    mocks.verifyToken.mockImplementationOnce(() => {
      throw new Error('invalid token');
    });
    const req = { cookies: { token: 'bad' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('セッションが無効'),
    }));
  });

  // ── requireLogin: empty sessionVersion ──

  it('returns 401 when sessionVersion is empty string', async () => {
    mocks.verifyToken.mockReturnValueOnce({
      id: 1,
      email: 'a@b.com',
      isAdmin: false,
      sessionVersion: '',
    });
    const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // ── requireLogin: sessionVersion is not a string ──

  it('returns 401 when sessionVersion is not a string', async () => {
    mocks.verifyToken.mockReturnValueOnce({
      id: 1,
      email: 'a@b.com',
      isAdmin: false,
      sessionVersion: 123,
    });
    const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // ── requireLogin: user not found in DB ──

  it('returns 401 when user not found in database', async () => {
    mocks.verifyToken.mockReturnValueOnce({
      id: 999,
      email: 'gone@b.com',
      isAdmin: false,
      sessionVersion: 'v1',
    });
    mocks.select.mockImplementation(() => createSelectQuery([]));

    const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('アカウントが無効'),
    }));
  });

  // ── requireLogin: inactive user with generic (no verification status) ──

  it('returns 401 for inactive user with no special verification status', async () => {
    mocks.verifyToken.mockReturnValueOnce({
      id: 30,
      email: 'inactive@b.com',
      isAdmin: false,
      sessionVersion: 'v1',
    });
    mocks.deriveSessionVersion.mockReturnValueOnce('v1');
    mocks.select.mockImplementation(() => createSelectQuery([{
      id: 30,
      email: 'inactive@b.com',
      isAdmin: false,
      isActive: false,
      passwordHash: 'hash',
      verificationStatus: 'verified', // verified but inactive
      rejectionReason: null,
    }]));

    const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'アカウントが無効です',
    }));
  });

  // ── requireLogin: db error ──

  it('returns 500 when database query throws', async () => {
    mocks.verifyToken.mockReturnValueOnce({
      id: 1,
      email: 'a@b.com',
      isAdmin: false,
      sessionVersion: 'v1',
    });
    const failQuery = createSelectQuery([]);
    failQuery.limit.mockRejectedValue(new Error('db connection lost'));
    failQuery.then = (onFulfilled, onRejected) =>
      Promise.reject(new Error('db connection lost')).then(onFulfilled, onRejected);
    mocks.select.mockImplementation(() => failQuery);

    const req = { cookies: { token: 'tok' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: '認証処理中にエラーが発生しました',
    }));
  });

  // ── requireAdmin ──

  describe('requireAdmin', () => {
    it('returns 403 for non-admin user', () => {
      const req = { user: { id: 1, email: 'a@b.com', isAdmin: false } } as { user: { id: number; email: string; isAdmin: boolean } };
      const res = createRes();
      const next = vi.fn();

      requireAdmin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: '管理者権限が必要です',
      }));
    });

    it('calls next for admin user', () => {
      const req = { user: { id: 1, email: 'admin@b.com', isAdmin: true } } as { user: { id: number; email: string; isAdmin: boolean } };
      const res = createRes();
      const next = vi.fn();

      requireAdmin(req as never, res as never, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns 403 when user is undefined', () => {
      const req = {} as { user?: { isAdmin: boolean } };
      const res = createRes();
      const next = vi.fn();

      requireAdmin(req as never, res as never, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
