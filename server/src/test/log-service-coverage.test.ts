import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
  },
  enqueueLogAlert: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/openclaw-log-push-service', () => ({
  enqueueLogAlert: mocks.enqueueLogAlert,
}));

import { writeLog, getClientIp } from '../services/log-service';

function createInsertChain(result: unknown = undefined) {
  const chain = {
    values: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

describe('log-service: writeLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes a basic log entry with minimal options', async () => {
    const chain = createInsertChain();
    mocks.db.insert.mockReturnValue(chain);

    await writeLog('login');

    expect(mocks.db.insert).toHaveBeenCalled();
    expect(chain.values).toHaveBeenCalledWith(
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
    const chain = createInsertChain();
    mocks.db.insert.mockReturnValue(chain);

    await writeLog('upload', {
      pharmacyId: 5,
      detail: 'テスト詳細',
      resourceType: 'pharmacy',
      resourceId: 42,
      metadataJson: { key: 'value' },
      ipAddress: '192.168.1.1',
      errorCode: 'ERR001',
    });

    expect(chain.values).toHaveBeenCalledWith(
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
    const chain = createInsertChain();
    mocks.db.insert.mockReturnValue(chain);

    await writeLog('login', { metadataJson: '{"already":"json"}' });

    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: '{"already":"json"}',
      }),
    );
  });

  it('handles null metadataJson', async () => {
    const chain = createInsertChain();
    mocks.db.insert.mockReturnValue(chain);

    await writeLog('login', { metadataJson: null });

    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: null,
      }),
    );
  });

  it('converts resourceId number to string', async () => {
    const chain = createInsertChain();
    mocks.db.insert.mockReturnValue(chain);

    await writeLog('login', { resourceId: 123 });

    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: '123',
      }),
    );
  });

  it('enqueues log alert for failure detail', async () => {
    const chain = createInsertChain();
    mocks.db.insert.mockReturnValue(chain);

    await writeLog('upload', { detail: '失敗|reason here' });

    expect(mocks.enqueueLogAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'activity_logs',
        severity: 'error',
      }),
    );
  });

  it('enqueues log alert for login_failed action', async () => {
    const chain = createInsertChain();
    mocks.db.insert.mockReturnValue(chain);

    await writeLog('login_failed', { detail: 'bad password' });

    expect(mocks.enqueueLogAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'activity_logs',
        severity: 'warning',
      }),
    );
  });

  it('enqueues log alert for password_reset_failed action', async () => {
    const chain = createInsertChain();
    mocks.db.insert.mockReturnValue(chain);

    await writeLog('password_reset_failed');

    expect(mocks.enqueueLogAlert).toHaveBeenCalled();
  });

  it('does not enqueue log alert for normal actions', async () => {
    const chain = createInsertChain();
    mocks.db.insert.mockReturnValue(chain);

    await writeLog('login');

    expect(mocks.enqueueLogAlert).not.toHaveBeenCalled();
  });

  it('does not throw when db.insert fails', async () => {
    mocks.db.insert.mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    await expect(writeLog('login')).resolves.toBeUndefined();
  });

  it('does not throw when enqueueLogAlert fails', async () => {
    const chain = createInsertChain();
    mocks.db.insert.mockReturnValue(chain);
    mocks.enqueueLogAlert.mockImplementation(() => {
      throw new Error('push failed');
    });

    await expect(writeLog('login_failed')).resolves.toBeUndefined();
  });

  it('handles metadataJson that cannot be stringified', async () => {
    const chain = createInsertChain();
    mocks.db.insert.mockReturnValue(chain);

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await writeLog('login', { metadataJson: circular });

    // Should fallback to null when JSON.stringify fails
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: null,
      }),
    );
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
