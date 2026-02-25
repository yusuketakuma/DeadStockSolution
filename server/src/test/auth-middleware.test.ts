import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock('../services/auth-service', () => ({
  verifyToken: mocks.verifyToken,
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
    mocks.verifyToken.mockReturnValue({ id: 10, email: 'cache@example.com', isAdmin: false });
    mocks.select.mockImplementation(() => createSelectQuery([{
      id: 10,
      email: 'cache@example.com',
      isAdmin: false,
      isActive: true,
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
    mocks.verifyToken.mockReturnValue({ id: 11, email: 'invalidate@example.com', isAdmin: false });
    mocks.select.mockImplementation(() => createSelectQuery([{
      id: 11,
      email: 'invalidate@example.com',
      isAdmin: false,
      isActive: true,
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
});
