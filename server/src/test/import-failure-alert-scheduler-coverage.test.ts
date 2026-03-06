import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getImportFailureAlertConfig,
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
  handoffImportFailureAlertToOpenClaw: vi.fn(),
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

vi.mock('../services/openclaw-auto-handoff-service', () => ({
  handoffImportFailureAlertToOpenClaw: mocks.handoffImportFailureAlertToOpenClaw,
}));

const originalFetch = global.fetch;
const fetchMock = vi.fn();

const ENV_KEYS = [
  'IMPORT_FAILURE_ALERT_ENABLED',
  'IMPORT_FAILURE_ALERT_INTERVAL_MINUTES',
  'IMPORT_FAILURE_ALERT_WINDOW_MINUTES',
  'IMPORT_FAILURE_ALERT_THRESHOLD',
  'IMPORT_FAILURE_ALERT_COOLDOWN_MINUTES',
  'IMPORT_FAILURE_ALERT_ACTIONS',
  'IMPORT_FAILURE_ALERT_WEBHOOK_URL',
  'IMPORT_FAILURE_ALERT_WEBHOOK_TOKEN',
  'IMPORT_FAILURE_ALERT_WEBHOOK_TIMEOUT_MS',
  'SCHEDULER_OPTIMIZED_LOOP_ENABLED',
  'IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED',
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

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
  mockFailureByAction([{ action: 'upload', count: total }]);
  mockFailureByReason([{ reason: 'parse_failed', count: total }]);
  mockLatestFailure([{ id: 1, createdAt: '2026-01-01T00:00:00.000Z' }]);
}

describe('import-failure-alert-scheduler — additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetImportFailureAlertStateForTests();
    stopImportFailureAlertScheduler();
    process.env.IMPORT_FAILURE_ALERT_ENABLED = 'true';
    delete process.env.IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED;
    process.env.SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'true';
    global.fetch = fetchMock as unknown as typeof fetch;
    mocks.handoffImportFailureAlertToOpenClaw.mockResolvedValue({
      triggered: false,
      accepted: false,
      requestId: null,
    });
  });

  afterEach(() => {
    stopImportFailureAlertScheduler();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  describe('getImportFailureAlertConfig', () => {
    it('returns default config when no env vars set', () => {
      delete process.env.IMPORT_FAILURE_ALERT_ENABLED;
      delete process.env.IMPORT_FAILURE_ALERT_INTERVAL_MINUTES;
      delete process.env.IMPORT_FAILURE_ALERT_WEBHOOK_URL;

      const config = getImportFailureAlertConfig();

      expect(config.enabled).toBe(false);
      expect(config.intervalMinutes).toBe(5);
      expect(config.webhookUrl).toBe('');
    });

    it('parses enabled config correctly', () => {
      process.env.IMPORT_FAILURE_ALERT_ENABLED = 'true';
      process.env.IMPORT_FAILURE_ALERT_INTERVAL_MINUTES = '10';
      process.env.IMPORT_FAILURE_ALERT_WINDOW_MINUTES = '60';
      process.env.IMPORT_FAILURE_ALERT_THRESHOLD = '10';
      process.env.IMPORT_FAILURE_ALERT_COOLDOWN_MINUTES = '120';

      const config = getImportFailureAlertConfig();

      expect(config.enabled).toBe(true);
      expect(config.intervalMinutes).toBe(10);
      expect(config.windowMinutes).toBe(60);
      expect(config.threshold).toBe(10);
      expect(config.cooldownMinutes).toBe(120);
    });

    it('handles invalid webhook URL', () => {
      process.env.IMPORT_FAILURE_ALERT_WEBHOOK_URL = 'not-a-url';

      const config = getImportFailureAlertConfig();

      expect(config.webhookUrl).toBe('');
      expect(config.webhookUrlError).toBe('invalid');
    });

    it('handles insecure webhook URL', () => {
      process.env.IMPORT_FAILURE_ALERT_WEBHOOK_URL = 'http://remote-server.com/webhook';

      const config = getImportFailureAlertConfig();

      expect(config.webhookUrl).toBe('');
      expect(config.webhookUrlError).toBe('insecure');
    });

    it('allows http localhost webhook URL', () => {
      process.env.IMPORT_FAILURE_ALERT_WEBHOOK_URL = 'http://localhost:8080/webhook';

      const config = getImportFailureAlertConfig();

      expect(config.webhookUrl).toContain('localhost');
      expect(config.webhookUrlError).toBeNull();
    });

    it('allows https webhook URL', () => {
      process.env.IMPORT_FAILURE_ALERT_WEBHOOK_URL = 'https://example.com/webhook';

      const config = getImportFailureAlertConfig();

      expect(config.webhookUrl).toContain('example.com');
      expect(config.webhookUrlError).toBeNull();
    });

    it('parses custom monitored actions', () => {
      process.env.IMPORT_FAILURE_ALERT_ACTIONS = 'upload,custom_action';

      const config = getImportFailureAlertConfig();

      expect(config.monitoredActions).toEqual(['upload', 'custom_action']);
    });
  });

  describe('runImportFailureAlertCheck', () => {
    it('returns disabled when monitored actions are empty', async () => {
      const result = await runImportFailureAlertCheck(createConfig({ monitoredActions: [] }));

      expect(result.status).toBe('disabled');
    });

    it('returns alerted and delivers webhook successfully', async () => {
      mockThresholdExceededRows(5);
      fetchMock.mockResolvedValue({ ok: true, status: 200 });

      const result = await runImportFailureAlertCheck(createConfig({
        threshold: 3,
        webhookUrl: 'https://example.com/hook',
      }));

      expect(result.status).toBe('alerted');
      expect(result.webhookDelivered).toBe(true);
    });

    it('handles webhook delivery failure', async () => {
      mockThresholdExceededRows(5);
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      const result = await runImportFailureAlertCheck(createConfig({
        threshold: 3,
        webhookUrl: 'https://example.com/hook',
      }));

      expect(result.status).toBe('alerted');
      expect(result.webhookDelivered).toBe(false);
    });

    it('handles webhook fetch error', async () => {
      mockThresholdExceededRows(5);
      fetchMock.mockRejectedValue(new Error('Connection refused'));

      const result = await runImportFailureAlertCheck(createConfig({
        threshold: 3,
        webhookUrl: 'https://example.com/hook',
      }));

      expect(result.status).toBe('alerted');
      expect(result.webhookDelivered).toBe(false);
    });

    it('skips webhook when URL has error', async () => {
      mockThresholdExceededRows(5);

      const result = await runImportFailureAlertCheck(createConfig({
        threshold: 3,
        webhookUrl: '',
        webhookUrlError: 'invalid',
      }));

      expect(result.status).toBe('alerted');
      expect(result.webhookDelivered).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('enters cooldown after second check above threshold', async () => {
      const baseTime = new Date('2026-01-01T00:00:00.000Z');
      mockThresholdExceededRows(5);

      const first = await runImportFailureAlertCheck(createConfig({ threshold: 3, cooldownMinutes: 60 }), baseTime);
      expect(first.status).toBe('alerted');

      // After threshold but still within cooldown
      mockFailureCount(5);

      const second = await runImportFailureAlertCheck(
        createConfig({ threshold: 3, cooldownMinutes: 60 }),
        new Date(baseTime.getTime() + 30 * 60_000),
      );

      expect(second.status).toBe('cooldown');
    });
  });

  describe('startImportFailureAlertScheduler', () => {
    it('does not start when disabled', () => {
      process.env.IMPORT_FAILURE_ALERT_ENABLED = 'false';

      startImportFailureAlertScheduler();

      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        expect.stringContaining('disabled'),
      );
    });

    it('starts successfully and logs info message', () => {
      process.env.IMPORT_FAILURE_ALERT_ENABLED = 'true';
      delete process.env.IMPORT_FAILURE_ALERT_ACTIONS;

      startImportFailureAlertScheduler();

      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        expect.stringContaining('starting scheduler'),
        expect.any(Object),
      );

      stopImportFailureAlertScheduler();
    });

    it('warns about already running scheduler', () => {
      process.env.IMPORT_FAILURE_ALERT_ENABLED = 'true';

      startImportFailureAlertScheduler();
      startImportFailureAlertScheduler();

      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('already running'),
      );

      stopImportFailureAlertScheduler();
    });

    it('warns about invalid webhook URL', () => {
      process.env.IMPORT_FAILURE_ALERT_ENABLED = 'true';
      process.env.IMPORT_FAILURE_ALERT_WEBHOOK_URL = 'not-a-url';

      startImportFailureAlertScheduler();

      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('webhook URL is invalid'),
        expect.any(Object),
      );

      stopImportFailureAlertScheduler();
    });

    it('uses local feature flag override for loop mode', () => {
      process.env.IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'false';
      process.env.SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'true';

      const timeoutSpy = vi.spyOn(global, 'setTimeout');
      const intervalSpy = vi.spyOn(global, 'setInterval');

      startImportFailureAlertScheduler();

      // Legacy mode uses both setTimeout and setInterval
      expect(timeoutSpy).toHaveBeenCalled();
      expect(intervalSpy).toHaveBeenCalled();

      stopImportFailureAlertScheduler();
    });
  });
});
