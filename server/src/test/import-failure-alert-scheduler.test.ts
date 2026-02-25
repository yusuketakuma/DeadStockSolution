import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetImportFailureAlertStateForTests,
  runImportFailureAlertCheck,
  startImportFailureAlertScheduler,
  stopImportFailureAlertScheduler,
  type ImportFailureAlertConfig,
} from '../services/import-failure-alert-scheduler';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

const originalFetch = global.fetch;
const fetchMock = vi.fn();
const ORIGINAL_IMPORT_FAILURE_ALERT_ENABLED = process.env.IMPORT_FAILURE_ALERT_ENABLED;
const ORIGINAL_SCHEDULER_OPTIMIZED_LOOP_ENABLED = process.env.SCHEDULER_OPTIMIZED_LOOP_ENABLED;
const ORIGINAL_IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED =
  process.env.IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED;

function createConfig(overrides: Partial<ImportFailureAlertConfig> = {}): ImportFailureAlertConfig {
  return {
    enabled: true,
    intervalMinutes: 5,
    windowMinutes: 30,
    threshold: 3,
    cooldownMinutes: 60,
    monitoredActions: ['upload', 'drug_master_sync', 'drug_master_package_upload'],
    webhookUrl: '',
    webhookUrlError: null,
    webhookToken: '',
    webhookTimeoutMs: 10000,
    ...overrides,
  };
}

function mockFailureCount(count: number): void {
  const whereMock = vi.fn().mockResolvedValue([{ count }]);
  const fromMock = vi.fn(() => ({ where: whereMock }));
  mocks.db.select.mockImplementationOnce(() => ({ from: fromMock }));
}

function mockFailureByAction(rows: Array<{ action: string; count: number }>): void {
  const groupByMock = vi.fn().mockResolvedValue(rows);
  const whereMock = vi.fn(() => ({ groupBy: groupByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  mocks.db.select.mockImplementationOnce(() => ({ from: fromMock }));
}

function mockFailureByReason(rows: Array<{ reason: string; count: number }>): void {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const groupByMock = vi.fn(() => ({ orderBy: orderByMock }));
  const whereMock = vi.fn(() => ({ groupBy: groupByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  mocks.db.select.mockImplementationOnce(() => ({ from: fromMock }));
}

function mockLatestFailure(rows: Array<{ id: number; createdAt: string }>): void {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  mocks.db.select.mockImplementationOnce(() => ({ from: fromMock }));
}

function mockThresholdExceededRows(total: number): void {
  mockFailureCount(total);
  mockFailureByAction([
    { action: 'upload', count: total - 1 },
    { action: 'drug_master_sync', count: 1 },
  ]);
  mockFailureByReason([
    { reason: 'parse_failed', count: total - 1 },
    { reason: 'sync_failed', count: 1 },
  ]);
  mockLatestFailure([{ id: 999, createdAt: '2026-02-24T09:10:11.000Z' }]);
}

describe('import-failure-alert-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetImportFailureAlertStateForTests();
    stopImportFailureAlertScheduler();
    process.env.IMPORT_FAILURE_ALERT_ENABLED = 'true';
    delete process.env.IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED;
    process.env.SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'true';
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;

    if (ORIGINAL_IMPORT_FAILURE_ALERT_ENABLED === undefined) {
      delete process.env.IMPORT_FAILURE_ALERT_ENABLED;
    } else {
      process.env.IMPORT_FAILURE_ALERT_ENABLED = ORIGINAL_IMPORT_FAILURE_ALERT_ENABLED;
    }

    if (ORIGINAL_SCHEDULER_OPTIMIZED_LOOP_ENABLED === undefined) {
      delete process.env.SCHEDULER_OPTIMIZED_LOOP_ENABLED;
    } else {
      process.env.SCHEDULER_OPTIMIZED_LOOP_ENABLED = ORIGINAL_SCHEDULER_OPTIMIZED_LOOP_ENABLED;
    }

    if (ORIGINAL_IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED === undefined) {
      delete process.env.IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED;
    } else {
      process.env.IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED =
        ORIGINAL_IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED;
    }
  });

  it('returns disabled when scheduler is turned off', async () => {
    const result = await runImportFailureAlertCheck(createConfig({ enabled: false }));

    expect(result).toEqual({
      status: 'disabled',
      totalFailures: 0,
      threshold: 3,
      webhookDelivered: false,
    });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('returns below_threshold when failure count is small', async () => {
    mockFailureCount(2);

    const result = await runImportFailureAlertCheck(createConfig({ threshold: 3 }));

    expect(result).toEqual({
      status: 'below_threshold',
      totalFailures: 2,
      threshold: 3,
      webhookDelivered: false,
    });
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs alert when threshold is exceeded without webhook', async () => {
    mockThresholdExceededRows(4);

    const result = await runImportFailureAlertCheck(createConfig({ threshold: 3 }));

    expect(result).toEqual({
      status: 'alerted',
      totalFailures: 4,
      threshold: 3,
      webhookDelivered: false,
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Import failure alert: threshold exceeded',
      expect.objectContaining({
        totalFailures: 4,
        threshold: 3,
        webhookDelivered: false,
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts webhook payload when configured', async () => {
    mockThresholdExceededRows(5);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await runImportFailureAlertCheck(createConfig({
      threshold: 3,
      webhookUrl: 'https://example.com/webhook',
      webhookToken: 'token-123',
    }));

    expect(result.webhookDelivered).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-123',
        }),
      }),
    );
  });

  it('suppresses duplicate alert inside cooldown window', async () => {
    const baseTime = new Date('2026-02-24T00:00:00.000Z');
    mockThresholdExceededRows(4);

    const first = await runImportFailureAlertCheck(createConfig({ threshold: 3, cooldownMinutes: 60 }), baseTime);
    expect(first.status).toBe('alerted');
    expect(mocks.db.select).toHaveBeenCalledTimes(4);

    const second = await runImportFailureAlertCheck(
      createConfig({ threshold: 3, cooldownMinutes: 60 }),
      new Date(baseTime.getTime() + 60_000),
    );

    expect(second).toEqual({
      status: 'cooldown',
      totalFailures: 4,
      threshold: 3,
      webhookDelivered: false,
    });
    expect(mocks.db.select).toHaveBeenCalledTimes(4);
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('uses timeout-chain scheduler loop by default', () => {
    process.env.SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'true';
    delete process.env.IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED;
    const timeoutSpy = vi.spyOn(global, 'setTimeout');
    const intervalSpy = vi.spyOn(global, 'setInterval');

    startImportFailureAlertScheduler();

    expect(timeoutSpy).toHaveBeenCalledOnce();
    expect(intervalSpy).not.toHaveBeenCalled();
    stopImportFailureAlertScheduler();
  });

  it('can switch to legacy interval loop with feature flag', () => {
    process.env.SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'false';
    delete process.env.IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED;
    const timeoutSpy = vi.spyOn(global, 'setTimeout');
    const intervalSpy = vi.spyOn(global, 'setInterval');

    startImportFailureAlertScheduler();

    expect(timeoutSpy).toHaveBeenCalledOnce();
    expect(intervalSpy).toHaveBeenCalledOnce();
    stopImportFailureAlertScheduler();
  });
});
