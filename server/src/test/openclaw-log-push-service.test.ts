import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOpenClawConfig: vi.fn(),
  sendToOpenClawGateway: vi.fn(),
}));

vi.mock('../services/openclaw', () => ({
  getOpenClawConfig: mocks.getOpenClawConfig,
  sendToOpenClawGateway: mocks.sendToOpenClawGateway,
}));

import {
  enqueueLogAlert,
  flushBuffer,
  getBufferSize,
  clearBuffer,
  buildAlertPayload,
  buildOpenClawLogAlertMessage,
  escalateLogAlertToOpenClaw,
} from '../services/openclaw/log-push-service';

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

    it('sends a manual escalation with operator note', async () => {
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

      await escalateLogAlertToOpenClaw({
        source: 'system_events',
        severity: 'error',
        errorCode: 'SYSTEM_INTERNAL_ERROR',
        message: 'Gateway CLI test',
        whatHappened: '内部エラー',
        codeLocation: 'server/src/routes/account.ts',
        improvementSuggestion: '例外処理を見直してください。',
        tenant: { pharmacyId: 7, pharmacyName: 'Tenant 7' },
        logId: 10,
        occurredAt: '2026-03-02T10:00:00Z',
        recurrenceCount: 3,
        impactedTenantCount: 2,
      }, 'night-watch');

      expect(mocks.sendToOpenClawGateway).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'agent-1',
        message: expect.stringContaining('[Operator note]'),
        metadata: expect.objectContaining({
          impactedTenantCount: 2,
        }),
      }));
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

    it('builds a detailed OpenClaw message', () => {
      const payload = buildAlertPayload('error', [
        {
          source: 'system_events',
          severity: 'error',
          errorCode: 'SYSTEM_INTERNAL_ERROR',
          message: 'Test error',
          whatHappened: '内部エラー',
          codeLocation: 'server/src/routes/account.ts',
          improvementSuggestion: '例外処理を見直してください。',
          tenant: { pharmacyId: 5, pharmacyName: 'Tenant 5' },
          recurrenceCount: 4,
          logId: 1,
          occurredAt: '2026-03-02T10:00:00Z',
        },
      ]);

      const message = buildOpenClawLogAlertMessage(payload);

      expect(message).toContain('再発中の論点');
      expect(message).toContain('Tenant 5');
      expect(message).toContain('server/src/routes/account.ts');
      expect(message).toContain('recurrence=4');
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
