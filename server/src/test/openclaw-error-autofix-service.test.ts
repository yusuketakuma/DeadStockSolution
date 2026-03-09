import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorFixContext } from '../services/error-fix-context';

const mocks = vi.hoisted(() => ({
  handoffToOpenClaw: vi.fn(),
  dbInsert: vi.fn(),
  dbUpdate: vi.fn(),
}));

vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: mocks.handoffToOpenClaw,
}));

vi.mock('../config/database', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: mocks.dbInsert }) }),
    update: () => ({ set: () => ({ where: mocks.dbUpdate }) }),
  },
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  handoffErrorToOpenClaw,
  _resetDedupCacheForTests,
} from '../services/openclaw-error-autofix-service';

function makeContext(overrides?: Partial<ErrorFixContext>): ErrorFixContext {
  return {
    errorMessage: 'test error',
    stackTrace: null,
    sourceFile: 'server/src/services/test.ts',
    sourceLine: 42,
    endpoint: 'POST /api/test',
    sentryEventId: 'evt123',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('handoffErrorToOpenClaw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDedupCacheForTests();
    vi.stubEnv('OPENCLAW_ERROR_AUTOFIX_ENABLED', 'true');
    vi.stubEnv('OPENCLAW_ERROR_AUTOFIX_PHARMACY_ID', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should skip when disabled', async () => {
    vi.stubEnv('OPENCLAW_ERROR_AUTOFIX_ENABLED', 'false');
    const result = await handoffErrorToOpenClaw(makeContext(), 500);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('should skip 4xx errors', async () => {
    const result = await handoffErrorToOpenClaw(makeContext(), 400);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('not_5xx');
  });

  it('should deduplicate same error within window', async () => {
    mocks.dbInsert.mockResolvedValue([{ id: 1 }]);
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: true,
      status: 'in_dialogue',
      threadId: 't1',
      summary: 's1',
      note: 'ok',
    });

    await handoffErrorToOpenClaw(makeContext(), 500);
    const result = await handoffErrorToOpenClaw(makeContext(), 500);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('deduplicated');
  });

  it('should trigger handoff for 5xx', async () => {
    mocks.dbInsert.mockResolvedValue([{ id: 1 }]);
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: true,
      status: 'in_dialogue',
      threadId: 't1',
      summary: 's1',
      note: 'ok',
    });

    const result = await handoffErrorToOpenClaw(makeContext(), 500);
    expect(result.triggered).toBe(true);
    expect(result.accepted).toBe(true);
    expect(mocks.handoffToOpenClaw).toHaveBeenCalledOnce();
  });

  it('should allow retry after a failed handoff attempt', async () => {
    mocks.dbInsert.mockResolvedValue([{ id: 1 }]);
    mocks.handoffToOpenClaw
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        accepted: true,
        status: 'in_dialogue',
        threadId: 't2',
        summary: 's2',
        note: 'ok',
      });

    const first = await handoffErrorToOpenClaw(makeContext(), 500);
    const second = await handoffErrorToOpenClaw(makeContext(), 500);

    expect(first.triggered).toBe(false);
    expect(first.reason).toBe('error');
    expect(second.triggered).toBe(true);
    expect(second.accepted).toBe(true);
    expect(mocks.handoffToOpenClaw).toHaveBeenCalledTimes(2);
  });

  it('should skip when pharmacy ID is invalid', async () => {
    vi.stubEnv('OPENCLAW_ERROR_AUTOFIX_PHARMACY_ID', 'invalid');
    const result = await handoffErrorToOpenClaw(makeContext(), 500);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('invalid_pharmacy_id');
  });

  it('should handle handoff rejection gracefully', async () => {
    mocks.dbInsert.mockResolvedValue([{ id: 2 }]);
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: false,
      status: 'rejected',
      threadId: null,
      summary: null,
      note: 'rate limited',
    });

    const result = await handoffErrorToOpenClaw(makeContext(), 500);
    expect(result.triggered).toBe(true);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('rate limited');
  });

  it('should allow retry after a non-accepted handoff result', async () => {
    mocks.dbInsert.mockResolvedValue([{ id: 3 }]);
    mocks.handoffToOpenClaw
      .mockResolvedValueOnce({
        accepted: false,
        status: 'pending_handoff',
        threadId: null,
        summary: null,
        note: 'connector unavailable',
      })
      .mockResolvedValueOnce({
        accepted: true,
        status: 'in_dialogue',
        threadId: 't3',
        summary: 's3',
        note: 'ok',
      });

    const first = await handoffErrorToOpenClaw(makeContext(), 500);
    const second = await handoffErrorToOpenClaw(makeContext(), 500);

    expect(first.accepted).toBe(false);
    expect(second.accepted).toBe(true);
    expect(mocks.handoffToOpenClaw).toHaveBeenCalledTimes(2);
  });
});
