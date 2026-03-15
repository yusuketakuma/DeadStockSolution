import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
  },
  dispatchLogAlert: vi.fn(),
  getLogEntryById: vi.fn(),
  getLogInsightForEntry: vi.fn(),
  recordLogIssueAutoEscalation: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/openclaw-log-push-service', () => ({
  dispatchLogAlert: mocks.dispatchLogAlert,
}));

vi.mock('../services/log-center-service', () => ({
  getLogEntryById: mocks.getLogEntryById,
  getLogInsightForEntry: mocks.getLogInsightForEntry,
}));

vi.mock('../services/log-center-issue-service', () => ({
  recordLogIssueAutoEscalation: mocks.recordLogIssueAutoEscalation,
}));

import { writeLog, getClientIp } from '../services/log-service';

function createInsertChain(result: unknown = [{ id: 101 }]) {
  const chain = {
    values: vi.fn(),
    returning: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

let currentChain: ReturnType<typeof createInsertChain>;

describe('log-service: writeLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentChain = createInsertChain();
    currentChain.values.mockReturnValue(currentChain);
    mocks.db.insert.mockReturnValue(currentChain);
    mocks.dispatchLogAlert.mockResolvedValue({ mode: 'enqueued', reasonCodes: [] });
    mocks.getLogEntryById.mockResolvedValue(null);
    mocks.getLogInsightForEntry.mockResolvedValue(null);
    mocks.recordLogIssueAutoEscalation.mockResolvedValue(undefined);
  });

  it('writes a basic log entry with minimal options', async () => {
    await writeLog('login');

    expect(mocks.db.insert).toHaveBeenCalled();
    expect(currentChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login',
        pharmacyId: null,
        detail: null,
        resourceType: null,
        resourceId: null,
        metadataJson: null,
        ipAddress: null,
        errorCode: null,
      }),
    );
  });

  it('writes a log entry with all options', async () => {
    await writeLog('upload', {
      pharmacyId: 5,
      detail: 'テスト詳細',
      resourceType: 'pharmacy',
      resourceId: 42,
      metadataJson: { key: 'value' },
      ipAddress: '192.168.1.1',
      errorCode: 'ERR001',
    });

    expect(currentChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'upload',
        pharmacyId: 5,
        detail: 'テスト詳細',
        resourceType: 'pharmacy',
        resourceId: '42',
        metadataJson: '{"key":"value"}',
        ipAddress: '192.168.1.1',
        errorCode: 'ERR001',
      }),
    );
  });

  it('serializes string metadataJson as-is', async () => {
    await writeLog('login', { metadataJson: '{"already":"json"}' });

    expect(currentChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: '{"already":"json"}',
      }),
    );
  });

  it('handles null metadataJson', async () => {
    await writeLog('login', { metadataJson: null });

    expect(currentChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: null,
      }),
    );
  });

  it('converts resourceId number to string', async () => {
    await writeLog('login', { resourceId: 123 });

    expect(currentChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: '123',
      }),
    );
  });

  it('dispatches log alert for failure detail', async () => {
    await writeLog('upload', { detail: '失敗|reason here' });

    expect(mocks.dispatchLogAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'activity_logs',
        severity: 'error',
      }),
    );
  });

  it('dispatches log alert for login_failed action', async () => {
    await writeLog('login_failed', { detail: 'bad password' });

    expect(mocks.dispatchLogAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'activity_logs',
        severity: 'warning',
      }),
    );
  });

  it('dispatches log alert for password_reset_failed action', async () => {
    await writeLog('password_reset_failed');

    expect(mocks.dispatchLogAlert).toHaveBeenCalled();
  });

  it('does not dispatch log alert for normal actions', async () => {
    await writeLog('login');

    expect(mocks.dispatchLogAlert).not.toHaveBeenCalled();
  });

  it('does not throw when db.insert fails', async () => {
    mocks.db.insert.mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    await expect(writeLog('login')).resolves.toBeUndefined();
  });

  it('does not throw when dispatchLogAlert fails', async () => {
    mocks.dispatchLogAlert.mockRejectedValue(new Error('push failed'));

    await expect(writeLog('login_failed')).resolves.toBeUndefined();
  });

  it('handles metadataJson that cannot be stringified', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await writeLog('login', { metadataJson: circular });

    // Should fallback to null when JSON.stringify fails
    expect(currentChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: null,
      }),
    );
  });

  it('records auto escalation audit when dispatch escalates', async () => {
    mocks.dispatchLogAlert.mockResolvedValue({ mode: 'auto_escalated', reasonCodes: ['critical_severity'] });

    await writeLog('login_failed', { pharmacyId: 9, detail: 'bad password' });

    expect(mocks.recordLogIssueAutoEscalation).toHaveBeenCalledWith(expect.objectContaining({
      source: 'activity_logs',
      actorPharmacyId: 9,
      reasonCodes: ['critical_severity'],
    }));
  });
});

describe('log-service: getClientIp', () => {
  it('returns req.ip when available', () => {
    expect(getClientIp({ ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  it('returns unknown when req.ip is undefined', () => {
    expect(getClientIp({})).toBe('unknown');
  });
});
