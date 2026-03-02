import { describe, it, expect, beforeEach } from 'vitest';
import { enqueueLogAlert, getBufferSize, clearBuffer, buildAlertPayload } from '../services/openclaw-log-push-service';

describe('openclaw-log-push-service', () => {
  beforeEach(() => clearBuffer());

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
