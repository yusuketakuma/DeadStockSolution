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

import { clearAuthUserCacheForTests, invalidateAuthUserCache, requireLogin } from '../middleware/auth';

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

describe('auth middleware cache', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthUserCacheForTests();
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    clearAuthUserCacheForTests();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('reuses cached auth user for subsequent requests', async () => {
    mocks.verifyToken.mockReturnValue({
      id: 10,
      email: 'cache@example.com',
      isAdmin: false,
      sessionVersion: 'session-v1',
    });
    mocks.deriveSessionVersion.mockReturnValue('session-v1');
    mocks.select.mockImplementation(() => createSelectQuery([{
      id: 10,
      email: 'cache@example.com',
      isAdmin: false,
      isActive: true,
      passwordHash: 'hashed',
    }]));

    const reqA = { cookies: { token: 'token-a' } } as { cookies: { token: string }; user?: unknown };
    const reqB = { cookies: { token: 'token-a' } } as { cookies: { token: string }; user?: unknown };
    const resA = createRes();
    const resB = createRes();
    const nextA = vi.fn();
    const nextB = vi.fn();

    await requireLogin(reqA as never, resA as never, nextA);
    await requireLogin(reqB as never, resB as never, nextB);

    expect(nextA).toHaveBeenCalledTimes(1);
    expect(nextB).toHaveBeenCalledTimes(1);
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });

  it('queries DB again after cache invalidation', async () => {
    mocks.verifyToken.mockReturnValue({
      id: 11,
      email: 'invalidate@example.com',
      isAdmin: false,
      sessionVersion: 'session-v2',
    });
    mocks.deriveSessionVersion.mockReturnValue('session-v2');
    mocks.select.mockImplementation(() => createSelectQuery([{
      id: 11,
      email: 'invalidate@example.com',
      isAdmin: false,
      isActive: true,
      passwordHash: 'hashed',
    }]));

    const req = { cookies: { token: 'token-b' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);
    invalidateAuthUserCache(11);
    await requireLogin(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });

  it('rejects token when session version does not match current password', async () => {
    mocks.verifyToken.mockReturnValue({
      id: 12,
      email: 'mismatch@example.com',
      isAdmin: false,
      sessionVersion: 'old-session',
    });
    mocks.deriveSessionVersion.mockReturnValue('new-session');
    mocks.select.mockImplementation(() => createSelectQuery([{
      id: 12,
      email: 'mismatch@example.com',
      isAdmin: false,
      isActive: true,
      passwordHash: 'hashed',
    }]));

    const req = { cookies: { token: 'token-c' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('allows pending_verification + active accounts (re-verification)', async () => {
    mocks.verifyToken.mockReturnValue({
      id: 20,
      email: 'pending@example.com',
      isAdmin: false,
      sessionVersion: 'session-v1',
    });
    mocks.deriveSessionVersion.mockReturnValue('session-v1');
    mocks.select.mockImplementation(() => createSelectQuery([{
      id: 20,
      email: 'pending@example.com',
      isAdmin: false,
      isActive: true,
      passwordHash: 'hashed',
      verificationStatus: 'pending_verification',
      rejectionReason: null,
    }]));

    const req = { cookies: { token: 'token-pending' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects pending_verification + inactive accounts with 403', async () => {
    mocks.verifyToken.mockReturnValue({
      id: 23,
      email: 'pending-inactive@example.com',
      isAdmin: false,
      sessionVersion: 'session-v1',
    });
    mocks.deriveSessionVersion.mockReturnValue('session-v1');
    mocks.select.mockImplementation(() => createSelectQuery([{
      id: 23,
      email: 'pending-inactive@example.com',
      isAdmin: false,
      isActive: false,
      passwordHash: 'hashed',
      verificationStatus: 'pending_verification',
      rejectionReason: null,
    }]));

    const req = { cookies: { token: 'token-pending-inactive' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      verificationStatus: 'pending_verification',
    }));
  });

  it('rejects rejected + inactive accounts with 403 and rejection reason', async () => {
    mocks.verifyToken.mockReturnValue({
      id: 21,
      email: 'rejected@example.com',
      isAdmin: false,
      sessionVersion: 'session-v1',
    });
    mocks.deriveSessionVersion.mockReturnValue('session-v1');
    mocks.select.mockImplementation(() => createSelectQuery([{
      id: 21,
      email: 'rejected@example.com',
      isAdmin: false,
      isActive: false,
      passwordHash: 'hashed',
      verificationStatus: 'rejected',
      rejectionReason: '情報不一致',
    }]));

    const req = { cookies: { token: 'token-rejected' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      verificationStatus: 'rejected',
      rejectionReason: '情報不一致',
    }));
  });

  it('allows verified accounts to pass through', async () => {
    mocks.verifyToken.mockReturnValue({
      id: 22,
      email: 'verified@example.com',
      isAdmin: false,
      sessionVersion: 'session-v1',
    });
    mocks.deriveSessionVersion.mockReturnValue('session-v1');
    mocks.select.mockImplementation(() => createSelectQuery([{
      id: 22,
      email: 'verified@example.com',
      isAdmin: false,
      isActive: true,
      passwordHash: 'hashed',
      verificationStatus: 'verified',
      rejectionReason: null,
    }]));

    const req = { cookies: { token: 'token-verified' } } as { cookies: { token: string }; user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await requireLogin(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
