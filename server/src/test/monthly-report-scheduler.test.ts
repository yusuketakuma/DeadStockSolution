import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateMonthlyReport: vi.fn(),
  resolveDefaultTargetMonth: vi.fn(),
  validateYearMonth: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../services/monthly-report-service', () => ({
  generateMonthlyReport: mocks.generateMonthlyReport,
  resolveDefaultTargetMonth: mocks.resolveDefaultTargetMonth,
  validateYearMonth: mocks.validateYearMonth,
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
  return import('../services/monthly-report-scheduler');
}

describe('monthly-report-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.MONTHLY_REPORT_SCHEDULER_ENABLED;
    mocks.resolveDefaultTargetMonth.mockReturnValue({ year: 2026, month: 2 });
    mocks.generateMonthlyReport.mockResolvedValue(undefined);
    mocks.validateYearMonth.mockReturnValue(undefined);
  });

  afterEach(async () => {
    const scheduler = await loadSchedulerModule();
    scheduler.stopMonthlyReportScheduler();
    vi.useRealTimers();
  });

  it('does nothing when scheduler is disabled', async () => {
    process.env.MONTHLY_REPORT_SCHEDULER_ENABLED = 'false';
    const scheduler = await loadSchedulerModule();

    scheduler.startMonthlyReportScheduler();

    expect(mocks.loggerInfo).toHaveBeenCalledWith('Monthly report scheduler is disabled');
    expect(mocks.generateMonthlyReport).not.toHaveBeenCalled();
  });

  it('generates once when enabled and avoids duplicate generation for same month', async () => {
    process.env.MONTHLY_REPORT_SCHEDULER_ENABLED = 'true';
    vi.setSystemTime(new Date('2026-03-02T00:00:00.000Z')); // day <= 3
    const scheduler = await loadSchedulerModule();

    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((() => {
      return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);

    scheduler.startMonthlyReportScheduler();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.generateMonthlyReport).toHaveBeenCalledTimes(1);

    scheduler.stopMonthlyReportScheduler();
    scheduler.startMonthlyReportScheduler();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.generateMonthlyReport).toHaveBeenCalledTimes(1);

    scheduler.startMonthlyReportScheduler();
    expect(mocks.validateYearMonth).toHaveBeenCalledWith(2026, 2);
    expect(mocks.loggerWarn).toHaveBeenCalledWith('Monthly report scheduler already running');

    scheduler.stopMonthlyReportScheduler();
    setIntervalSpy.mockRestore();
  });

  it('skips generation when current day is after 3rd', async () => {
    process.env.MONTHLY_REPORT_SCHEDULER_ENABLED = '1';
    vi.setSystemTime(new Date('2026-03-10T00:00:00.000Z'));
    const scheduler = await loadSchedulerModule();

    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((() => {
      return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);

    scheduler.startMonthlyReportScheduler();

    expect(mocks.generateMonthlyReport).not.toHaveBeenCalled();
    scheduler.stopMonthlyReportScheduler();
    setIntervalSpy.mockRestore();
  });

  it('allows manual trigger and updates last generated key', async () => {
    const scheduler = await loadSchedulerModule();
    await scheduler.triggerManualMonthlyReport(2026, 5);

    expect(mocks.validateYearMonth).toHaveBeenCalledWith(2026, 5);
    expect(mocks.generateMonthlyReport).toHaveBeenCalledWith(2026, 5, null);
  });
});
