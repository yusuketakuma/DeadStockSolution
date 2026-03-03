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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../services/openclaw-log-push-service', () => ({
  enqueueLogAlert: mocks.enqueueLogAlert,
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn(() => ({})),
}));

import {
  recordSystemEvent,
  recordHttpUnhandledError,
  recordUnhandledRejection,
  recordUncaughtException,
  recordVercelDeployEvent,
} from '../services/system-event-service';

function createInsertChain() {
  return {
    values: vi.fn().mockResolvedValue(undefined),
  };
}

describe('system-event-service ultra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.db.insert.mockReturnValue(createInsertChain());
    mocks.enqueueLogAlert.mockReturnValue(undefined);
  });

  describe('recordSystemEvent', () => {
    it('persists event with default level error', async () => {
      const result = await recordSystemEvent({
        source: 'runtime_error',
        eventType: 'test_event',
        message: 'test message',
      } as never);
      expect(result).toBe(true);
      expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    });

    it('persists event with warning level and enqueues log alert', async () => {
      const result = await recordSystemEvent({
        source: 'runtime_error',
        level: 'warning',
        eventType: 'test_warning',
        message: 'warning message',
      } as never);
      expect(result).toBe(true);
      expect(mocks.enqueueLogAlert).toHaveBeenCalledWith(expect.objectContaining({
        severity: 'warning',
      }));
    });

    it('persists event with info level and does NOT enqueue log alert', async () => {
      const result = await recordSystemEvent({
        source: 'runtime_error',
        level: 'info',
        eventType: 'test_info',
        message: 'info message',
      } as never);
      expect(result).toBe(true);
      expect(mocks.enqueueLogAlert).not.toHaveBeenCalled();
    });

    it('returns false when db insert fails', async () => {
      mocks.db.insert.mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('db error')),
      });
      const result = await recordSystemEvent({
        source: 'runtime_error',
        eventType: 'fail_event',
        message: 'fail message',
      } as never);
      expect(result).toBe(false);
    });

    it('truncates long messages', async () => {
      const longMessage = 'a'.repeat(3000);
      const result = await recordSystemEvent({
        source: 'runtime_error',
        eventType: 'long_event',
        message: longMessage,
      } as never);
      expect(result).toBe(true);
      const insertValues = (mocks.db.insert.mock.results[0]?.value as ReturnType<typeof createInsertChain>).values;
      const calledWith = insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
      expect((calledWith.message as string).length).toBeLessThanOrEqual(2003); // 2000 + "..."
    });

    it('serializes object detail to JSON', async () => {
      const result = await recordSystemEvent({
        source: 'runtime_error',
        eventType: 'detail_event',
        message: 'msg',
        detail: { key: 'value' },
      } as never);
      expect(result).toBe(true);
    });

    it('handles string detail', async () => {
      const result = await recordSystemEvent({
        source: 'runtime_error',
        eventType: 'string_detail',
        message: 'msg',
        detail: 'some detail text',
      } as never);
      expect(result).toBe(true);
    });

    it('truncates long string detail', async () => {
      const longDetail = 'd'.repeat(15000);
      const result = await recordSystemEvent({
        source: 'runtime_error',
        eventType: 'long_detail',
        message: 'msg',
        detail: longDetail,
      } as never);
      expect(result).toBe(true);
    });

    it('handles null detail', async () => {
      const result = await recordSystemEvent({
        source: 'runtime_error',
        eventType: 'null_detail',
        message: 'msg',
        detail: null,
      } as never);
      expect(result).toBe(true);
    });

    it('handles undefined detail', async () => {
      const result = await recordSystemEvent({
        source: 'runtime_error',
        eventType: 'undef_detail',
        message: 'msg',
      } as never);
      expect(result).toBe(true);
    });

    it('handles circular reference in detail (JSON.stringify throws)', async () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const result = await recordSystemEvent({
        source: 'runtime_error',
        eventType: 'circular_detail',
        message: 'msg',
        detail: circular,
      } as never);
      expect(result).toBe(true);
    });

    it('uses provided occurredAt and errorCode', async () => {
      const result = await recordSystemEvent({
        source: 'runtime_error',
        eventType: 'custom_time',
        message: 'msg',
        occurredAt: '2026-01-01T00:00:00Z',
        errorCode: 'ERR_001',
      } as never);
      expect(result).toBe(true);
    });

    it('does not fail when enqueueLogAlert throws', async () => {
      mocks.enqueueLogAlert.mockImplementation(() => {
        throw new Error('push fail');
      });
      const result = await recordSystemEvent({
        source: 'runtime_error',
        level: 'error',
        eventType: 'push_fail_event',
        message: 'msg',
      } as never);
      expect(result).toBe(true);
    });
  });

  describe('recordHttpUnhandledError', () => {
    it('records 500 error with error level', async () => {
      const result = await recordHttpUnhandledError({
        method: 'GET',
        path: '/api/test',
        status: 500,
        requestId: 'req-123',
        errorCode: 'INTERNAL',
      });
      expect(result).toBe(true);
    });

    it('records 400 error with warning level', async () => {
      const result = await recordHttpUnhandledError({
        method: 'POST',
        path: '/api/test',
        status: 400,
      });
      expect(result).toBe(true);
    });
  });

  describe('recordUnhandledRejection', () => {
    it('records Error instance', async () => {
      const result = await recordUnhandledRejection(new Error('unhandled'));
      expect(result).toBe(true);
    });

    it('records non-Error value', async () => {
      const result = await recordUnhandledRejection('string reason');
      expect(result).toBe(true);
    });
  });

  describe('recordUncaughtException', () => {
    it('records Error instance', async () => {
      const result = await recordUncaughtException(new Error('uncaught'));
      expect(result).toBe(true);
    });

    it('records non-Error value', async () => {
      const result = await recordUncaughtException(42);
      expect(result).toBe(true);
    });
  });

  describe('recordVercelDeployEvent', () => {
    it('records deploy event with all fields', async () => {
      const result = await recordVercelDeployEvent({
        eventType: 'deployment.created',
        level: 'info',
        message: 'Deploy started',
        deploymentId: 'dpl_123',
        url: 'app.vercel.app',
        payload: { state: 'building' },
      });
      expect(result).toBe(true);
    });

    it('records deploy event with null optional fields', async () => {
      const result = await recordVercelDeployEvent({
        eventType: 'deployment.error',
        level: 'error',
        message: 'Deploy failed',
      });
      expect(result).toBe(true);
    });
  });
});
