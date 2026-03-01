import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: {
    execute: mocks.dbExecute,
  },
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
  },
}));

async function loadModule() {
  vi.resetModules();
  return import('../db/performance-scale-indexes');
}

describe('performance-scale-indexes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbExecute.mockResolvedValue(undefined);
  });

  it('applies every performance index statement', async () => {
    const module = await loadModule();

    const appliedCount = await module.applyPerformanceScaleIndexes();

    expect(appliedCount).toBe(module.__testables.PERFORMANCE_SCALE_INDEX_DEFINITIONS.length);
    expect(mocks.dbExecute).toHaveBeenCalledTimes(module.__testables.PERFORMANCE_SCALE_INDEX_DEFINITIONS.length);
  });

  it('logs and rethrows when one index statement fails', async () => {
    const module = await loadModule();
    mocks.dbExecute
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('index failure'));

    await expect(module.applyPerformanceScaleIndexes()).rejects.toThrow('index failure');
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Performance scale index rollout failed',
      expect.objectContaining({
        indexName: module.__testables.PERFORMANCE_SCALE_INDEX_DEFINITIONS[1]?.name,
      }),
    );
  });
});
