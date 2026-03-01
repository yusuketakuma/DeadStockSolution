import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processPendingMatchingRefreshJobs: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../services/matching-refresh-service', () => ({
  processPendingMatchingRefreshJobs: mocks.processPendingMatchingRefreshJobs,
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

async function loadSchedulerModule() {
  vi.resetModules();
  return import('../services/matching-refresh-scheduler');
}

describe('matching-refresh-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.MATCHING_REFRESH_SCHEDULER_INTERVAL_MS;
    delete process.env.MATCHING_REFRESH_SCHEDULER_BATCH_SIZE;
    mocks.processPendingMatchingRefreshJobs.mockResolvedValue(0);
  });

  afterEach(async () => {
    const scheduler = await loadSchedulerModule();
    scheduler.stopMatchingRefreshScheduler();
    vi.useRealTimers();
  });

  it('warns and ignores duplicate start calls', async () => {
    const scheduler = await loadSchedulerModule();

    scheduler.startMatchingRefreshScheduler();
    scheduler.startMatchingRefreshScheduler();

    expect(mocks.loggerWarn).toHaveBeenCalledWith('Matching refresh scheduler already running');
  });

  it('processes jobs with configured interval and batch size', async () => {
    process.env.MATCHING_REFRESH_SCHEDULER_INTERVAL_MS = '1000';
    process.env.MATCHING_REFRESH_SCHEDULER_BATCH_SIZE = '7';
    mocks.processPendingMatchingRefreshJobs.mockResolvedValue(2);

    const scheduler = await loadSchedulerModule();
    scheduler.startMatchingRefreshScheduler();

    await vi.advanceTimersByTimeAsync(1500);
    await Promise.resolve();
    expect(mocks.processPendingMatchingRefreshJobs).toHaveBeenCalledWith(7);
    expect(mocks.processPendingMatchingRefreshJobs).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(mocks.processPendingMatchingRefreshJobs).toHaveBeenCalledTimes(3);
  });

  it('skips interval ticks while previous run is still running', async () => {
    process.env.MATCHING_REFRESH_SCHEDULER_INTERVAL_MS = '1000';
    process.env.MATCHING_REFRESH_SCHEDULER_BATCH_SIZE = '5';

    let resolveRun: (value: number) => void = () => {};
    mocks.processPendingMatchingRefreshJobs.mockImplementation(() => (
      new Promise<number>((resolve) => {
        resolveRun = resolve;
      })
    ));

    const scheduler = await loadSchedulerModule();
    scheduler.startMatchingRefreshScheduler();

    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.processPendingMatchingRefreshJobs).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.processPendingMatchingRefreshJobs).toHaveBeenCalledTimes(1);
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'Matching refresh scheduler: previous run is still in progress, skipping',
    );

    resolveRun(0);
    await Promise.resolve();
  });
});
