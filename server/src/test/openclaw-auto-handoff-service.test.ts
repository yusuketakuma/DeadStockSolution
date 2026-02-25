import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handoffImportFailureAlertToOpenClaw,
  type ImportFailureAlertForOpenClaw,
} from '../services/openclaw-auto-handoff-service';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  handoffToOpenClaw: vi.fn(),
  buildOpenClawLogContext: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: mocks.handoffToOpenClaw,
}));

vi.mock('../services/openclaw-log-context-service', () => ({
  buildOpenClawLogContext: mocks.buildOpenClawLogContext,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

const ENV_KEYS = [
  'IMPORT_FAILURE_ALERT_OPENCLAW_AUTO_HANDOFF',
  'IMPORT_FAILURE_ALERT_OPENCLAW_PHARMACY_ID',
  'IMPORT_FAILURE_ALERT_OPENCLAW_DEDUP_MINUTES',
] as const;

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
for (const key of ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (typeof value === 'string') {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

function createAlertPayload(): ImportFailureAlertForOpenClaw {
  return {
    detectedAt: '2026-02-25T02:00:00.000Z',
    windowMinutes: 30,
    threshold: 5,
    totalFailures: 7,
    monitoredActions: ['upload', 'drug_master_sync'],
    latestFailureAt: '2026-02-25T01:59:00.000Z',
    failureByAction: [
      { action: 'upload', count: 5 },
      { action: 'drug_master_sync', count: 2 },
    ],
    failureByReason: [
      { reason: 'parse_failed', count: 5 },
      { reason: 'sync_failed', count: 2 },
    ],
  };
}

function setupInsertMock(requestId: number): void {
  const returningMock = vi.fn().mockResolvedValue([{ id: requestId }]);
  const valuesMock = vi.fn(() => ({ returning: returningMock }));
  mocks.db.insert.mockReturnValue({ values: valuesMock });
}

function setupUpdateMock(): void {
  const whereMock = vi.fn().mockResolvedValue(undefined);
  const setMock = vi.fn(() => ({ where: whereMock }));
  mocks.db.update.mockReturnValue({ set: setMock });
}

function setupRecentAutoRequestCheck(rows: Array<{ id: number }>): void {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  mocks.db.select.mockReturnValue({ from: fromMock });
}

describe('openclaw-auto-handoff-service', () => {
  afterEach(() => {
    vi.clearAllMocks();
    restoreEnv();
  });

  it('returns disabled when auto handoff is off', async () => {
    process.env.IMPORT_FAILURE_ALERT_OPENCLAW_AUTO_HANDOFF = 'false';

    const result = await handoffImportFailureAlertToOpenClaw(createAlertPayload());

    expect(result).toEqual({
      triggered: false,
      accepted: false,
      requestId: null,
      status: 'pending_handoff',
      reason: 'disabled',
    });
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.handoffToOpenClaw).not.toHaveBeenCalled();
  });

  it('returns invalid config when pharmacy id is not set', async () => {
    process.env.IMPORT_FAILURE_ALERT_OPENCLAW_AUTO_HANDOFF = 'true';
    delete process.env.IMPORT_FAILURE_ALERT_OPENCLAW_PHARMACY_ID;

    const result = await handoffImportFailureAlertToOpenClaw(createAlertPayload());

    expect(result.reason).toBe('invalid_pharmacy_id');
    expect(result.triggered).toBe(false);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'OpenClaw auto handoff skipped: invalid IMPORT_FAILURE_ALERT_OPENCLAW_PHARMACY_ID',
    );
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it('creates user request and hands off with context', async () => {
    process.env.IMPORT_FAILURE_ALERT_OPENCLAW_AUTO_HANDOFF = 'true';
    process.env.IMPORT_FAILURE_ALERT_OPENCLAW_PHARMACY_ID = '12';

    setupRecentAutoRequestCheck([]);
    setupInsertMock(701);
    setupUpdateMock();
    mocks.buildOpenClawLogContext.mockResolvedValue({
      generatedAt: '2026-02-25T02:00:00.000Z',
      windowHours: 24,
      monitoredImportActions: ['upload'],
      importFailures: {
        total: 7,
        byAction: [],
        byReason: [],
        recent: [],
      },
      pharmacyActivity: {
        pharmacyId: 12,
        recent: [],
      },
    });
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: true,
      connectorConfigured: true,
      implementationBranch: 'review',
      status: 'implementing',
      threadId: 'thread-1',
      summary: 'in progress',
      note: 'ok',
    });

    const payload = createAlertPayload();
    const result = await handoffImportFailureAlertToOpenClaw(payload);

    expect(result).toEqual({
      triggered: true,
      accepted: true,
      requestId: 701,
      status: 'implementing',
      reason: 'ok',
    });
    expect(mocks.handoffToOpenClaw).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 701,
        pharmacyId: 12,
        context: expect.objectContaining({
          source: 'import_failure_alert_scheduler',
          operationLogs: expect.objectContaining({
            pharmacyActivity: expect.objectContaining({
              pharmacyId: 12,
            }),
            importFailures: expect.objectContaining({
              total: 7,
            }),
          }),
        }),
      }),
    );
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'OpenClaw auto handoff completed from import failure alert',
      expect.objectContaining({
        requestId: 701,
        accepted: true,
      }),
    );
  });

  it('skips handoff when duplicate inflight auto request exists', async () => {
    process.env.IMPORT_FAILURE_ALERT_OPENCLAW_AUTO_HANDOFF = 'true';
    process.env.IMPORT_FAILURE_ALERT_OPENCLAW_PHARMACY_ID = '12';
    process.env.IMPORT_FAILURE_ALERT_OPENCLAW_DEDUP_MINUTES = '180';

    setupRecentAutoRequestCheck([{ id: 900 }]);

    const result = await handoffImportFailureAlertToOpenClaw(createAlertPayload());

    expect(result).toEqual({
      triggered: false,
      accepted: false,
      requestId: null,
      status: 'pending_handoff',
      reason: 'duplicate_inflight',
    });
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.handoffToOpenClaw).not.toHaveBeenCalled();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'OpenClaw auto handoff skipped: recent request already exists',
      expect.objectContaining({
        pharmacyId: 12,
        dedupMinutes: 180,
      }),
    );
  });
});
