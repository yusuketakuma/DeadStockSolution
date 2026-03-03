import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOpenClawConfig: vi.fn(),
  sendToOpenClawGateway: vi.fn(),
}));

vi.mock('../services/openclaw-service', () => ({
  getOpenClawConfig: mocks.getOpenClawConfig,
  sendToOpenClawGateway: mocks.sendToOpenClawGateway,
}));

import {
  enqueueLogAlert,
  flushBuffer,
  getBufferSize,
  clearBuffer,
  buildAlertPayload,
} from '../services/openclaw-log-push-service';

const originalLogPushEnabled = process.env.OPENCLAW_LOG_PUSH_ENABLED;

describe('openclaw-log-push-service', () => {
  beforeEach(() => {
    clearBuffer();
    vi.clearAllMocks();
    delete process.env.OPENCLAW_LOG_PUSH_ENABLED;
  });

  afterEach(() => {
    if (typeof originalLogPushEnabled === 'string') {
      process.env.OPENCLAW_LOG_PUSH_ENABLED = originalLogPushEnabled;
    } else {
      delete process.env.OPENCLAW_LOG_PUSH_ENABLED;
    }
    clearBuffer();
  });

  describe('enqueueLogAlert (when disabled)', () => {
    it('should not add to buffer when disabled', () => {
      // OPENCLAW_LOG_PUSH_ENABLED is not set, so isEnabled() returns false
      enqueueLogAlert({
        source: 'system_events',
        severity: 'error',
        errorCode: 'TEST',
        message: 'Test',
        logId: 1,
        occurredAt: '2026-03-02T10:00:00Z',
      });
      expect(getBufferSize('error')).toBe(0);
    });
  });

  describe('flushBuffer', () => {
    it('sends log alerts in gateway_cli mode even if apiKey is empty', async () => {
      process.env.OPENCLAW_LOG_PUSH_ENABLED = 'true';
      mocks.getOpenClawConfig.mockReturnValue({
        mode: 'gateway_cli',
        cliPath: '/usr/local/bin/openclaw',
        baseUrl: '',
        baseUrlError: null,
        apiKey: '',
        agentId: 'agent-1',
        webhookSecret: '',
        implementationBranch: 'review',
      });
      mocks.sendToOpenClawGateway.mockResolvedValue({ summary: 'ok' });

      enqueueLogAlert({
        source: 'system_events',
        severity: 'error',
        errorCode: 'LOG001',
        message: 'Gateway CLI test',
        logId: 10,
        occurredAt: '2026-03-02T10:00:00Z',
      });

      expect(getBufferSize('error')).toBe(1);
      await flushBuffer('error');

      expect(mocks.sendToOpenClawGateway).toHaveBeenCalledTimes(1);
      expect(getBufferSize('error')).toBe(0);
    });
  });

  describe('buildAlertPayload', () => {
    it('should build valid payload', () => {
      const payload = buildAlertPayload('error', [
        {
          source: 'system_events',
          severity: 'error',
          errorCode: 'SYSTEM_INTERNAL_ERROR',
          message: 'Test error',
          logId: 1,
          occurredAt: '2026-03-02T10:00:00Z',
        },
      ]);
      expect(payload.type).toBe('log_alert');
      expect(payload.severity).toBe('error');
      expect(payload.logs).toHaveLength(1);
      expect(payload.sentAt).toBeDefined();
    });

    it('should handle multiple entries', () => {
      const entries = [
        { source: 'a', severity: 'error' as const, errorCode: null, message: 'e1', logId: 1, occurredAt: '2026-03-02T10:00:00Z' },
        { source: 'b', severity: 'error' as const, errorCode: 'X', message: 'e2', logId: 2, occurredAt: '2026-03-02T10:01:00Z' },
      ];
      const payload = buildAlertPayload('error', entries);
      expect(payload.logs).toHaveLength(2);
    });

    it('should handle empty entries', () => {
      const payload = buildAlertPayload('warning', []);
      expect(payload.logs).toHaveLength(0);
    });
  });

  describe('getBufferSize', () => {
    it('should return 0 for unknown severity', () => {
      expect(getBufferSize('unknown')).toBe(0);
    });
  });

  describe('clearBuffer', () => {
    it('should not throw on empty buffers', () => {
      expect(() => clearBuffer()).not.toThrow();
    });
  });
});
