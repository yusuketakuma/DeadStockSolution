import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
}));

const mockSqlFn = vi.hoisted(() => vi.fn(() => ({})));
const mockAuthDeps = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  deriveSessionVersion: vi.fn(),
  isJwtSecretMissingError: vi.fn(() => false),
  isDependencyServiceUnavailableError: vi.fn(() => false),
}));

function mockDependencies() {
  vi.doMock('../config/database', () => ({
    db: {
      execute: mocks.execute,
      select: mocks.select,
      transaction: mocks.transaction,
    },
  }));

  vi.doMock('../config/database-admin', () => ({
    adminDb: { execute: vi.fn(), select: vi.fn() },
  }));

  vi.doMock('drizzle-orm', () => ({
    eq: vi.fn(() => ({})),
    sql: mockSqlFn,
  }));
}

// ── Tests ──────────────────────────────────────────
describe('RLS Phase 3 — setTenantContext', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockDependencies();
    vi.clearAllMocks();
  });

  it('should execute set_config with the given tenant id', async () => {
    mocks.execute.mockResolvedValue([{ set_config: '42' }]);

    const { setTenantContext } = await import('../utils/db-utils');
    await setTenantContext(42);

    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('should work with tenant id 0', async () => {
    mocks.execute.mockResolvedValue([{ set_config: '0' }]);

    const { setTenantContext } = await import('../utils/db-utils');
    await setTenantContext(0);

    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('should handle concurrent calls', async () => {
    mocks.execute.mockResolvedValue([{ set_config: '' }]);

    const { setTenantContext } = await import('../utils/db-utils');
    await Promise.all([
      setTenantContext(1),
      setTenantContext(2),
      setTenantContext(3),
    ]);

    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });
});

describe('RLS Phase 3 — withTenant', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockDependencies();
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue([{ set_config: '99' }]);
    mocks.transaction.mockImplementation(async (callback) => callback({
      execute: mocks.execute,
      select: mocks.select,
    }));
  });

  it('should set context and call the function', async () => {
    const fn = vi.fn().mockResolvedValue('result');

    const { withTenant } = await import('../utils/db-utils');
    const result = await withTenant(99, fn);

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('result');
  });

  it('should work with async function returning void', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);

    const { withTenant } = await import('../utils/db-utils');
    await withTenant(55, fn);

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should propagate errors from the function', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('db error'));

    const { withTenant } = await import('../utils/db-utils');
    await expect(withTenant(1, fn)).rejects.toThrow('db error');

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('RLS Phase 3 — adminDb infrastructure', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../config/database', () => ({
      db: { execute: vi.fn(), select: vi.fn() },
    }));
    vi.doMock('../config/database-url', () => ({
      resolveDatabaseUrls: vi.fn(() => ({ pooledUrl: 'postgres://localhost/db' })),
      resolveAdminDatabaseUrl: vi.fn(() => 'postgres://admin@localhost/db'),
    }));
  });

  it('should export adminDb from database-admin', async () => {
    const { adminDb } = await import('../config/database-admin');
    expect(adminDb).toBeDefined();
    expect(typeof adminDb).toBe('object');
  });
});

describe('RLS Phase 3 — auth.ts imports setTenantContext', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockDependencies();
    vi.doMock('../services/auth-service', () => ({
      verifyToken: mockAuthDeps.verifyToken,
      deriveSessionVersion: mockAuthDeps.deriveSessionVersion,
      isJwtSecretMissingError: mockAuthDeps.isJwtSecretMissingError,
    }));
    vi.doMock('../routes/auth-helpers', () => ({
      isDependencyServiceUnavailableError: mockAuthDeps.isDependencyServiceUnavailableError,
    }));
    vi.clearAllMocks();
  });

  it('should export requireLogin and requireAdmin from auth.ts', async () => {
    const auth = await import('../middleware/auth');
    expect(auth.requireLogin).toBeDefined();
    expect(typeof auth.requireLogin).toBe('function');
    expect(auth.requireAdmin).toBeDefined();
    expect(typeof auth.requireAdmin).toBe('function');
    expect(auth.invalidateAuthUserCache).toBeDefined();
    expect(auth.clearAuthUserCacheForTests).toBeDefined();
  });
});
