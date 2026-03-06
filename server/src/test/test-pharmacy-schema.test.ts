import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: {
    execute: mocks.execute,
  },
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: vi.fn(),
  },
}));

describe('test-pharmacy-schema ensureTestPharmacyColumnsAtStartup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true and caches ensured state after successful migration', async () => {
    mocks.execute.mockResolvedValue(undefined);
    const mod = await import('../config/test-pharmacy-schema');

    const first = await mod.ensureTestPharmacyColumnsAtStartup();
    const second = await mod.ensureTestPharmacyColumnsAtStartup();

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.loggerInfo).toHaveBeenCalledWith('Test pharmacy columns ensured at startup');
  });

  it('reuses in-flight promise for concurrent callers', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstExecute = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    mocks.execute
      .mockImplementationOnce(() => firstExecute)
      .mockResolvedValueOnce(undefined);

    const mod = await import('../config/test-pharmacy-schema');

    const p1 = mod.ensureTestPharmacyColumnsAtStartup();
    const p2 = mod.ensureTestPharmacyColumnsAtStartup();

    expect(p1).toBe(p2);
    expect(mocks.execute).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await expect(p1).resolves.toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it('returns false and logs warning when migration throws Error', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('db down'));
    const mod = await import('../config/test-pharmacy-schema');

    await expect(mod.ensureTestPharmacyColumnsAtStartup()).resolves.toBe(false);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Test pharmacy column ensure skipped at startup',
      { error: 'db down' },
    );
  });

  it('logs stringified non-Error throw in warning payload', async () => {
    mocks.execute.mockRejectedValueOnce('boom-string');
    const mod = await import('../config/test-pharmacy-schema');

    await expect(mod.ensureTestPharmacyColumnsAtStartup()).resolves.toBe(false);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Test pharmacy column ensure skipped at startup',
      { error: 'boom-string' },
    );
  });
});
