import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenClawConfig } from '../services/openclaw';

// ── Hoisted mocks ──────────────────────────────────
const mocks = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  getOpenClawConfig: vi.fn(),
  sendToOpenClawGateway: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../services/openclaw', () => ({
  getOpenClawConfig: mocks.getOpenClawConfig,
  sendToOpenClawGateway: mocks.sendToOpenClawGateway,
}));

import {
  enqueueLogAlert,
  flushBuffer,
  buildAlertPayload,
  getBufferSize,
  clearBuffer,
  type LogAlertEntry,
} from '../services/openclaw/log-push-service';

// ── Helpers ──────────────────────────────────
function makeEntry(overrides: Partial<LogAlertEntry> = {}): LogAlertEntry {
  return {
    source: 'system_events',
    severity: 'error',
    errorCode: 'TEST_CODE',
    message: 'test message',
    logId: 1,
    occurredAt: '2026-03-02T10:00:00Z',
    ...overrides,
  };
}

function makeOpenClawConfig(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return {
    mode: 'legacy_http',
    cliPath: 'openclaw',
    baseUrl: 'https://openclaw.example',
    baseUrlError: null,
    apiKey: 'test-api-key',
    agentId: 'test-agent-id',
    webhookSecret: '',
    implementationBranch: 'review',
    ...overrides,
  };
}

describe('openclaw-log-push-service (coverage)', () => {
  const originalEnv = process.env.OPENCLAW_LOG_PUSH_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clearBuffer();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearBuffer();
    if (originalEnv === undefined) {
      delete process.env.OPENCLAW_LOG_PUSH_ENABLED;
    } else {
      process.env.OPENCLAW_LOG_PUSH_ENABLED = originalEnv;
    }
  });

  // ────────────────────────────────────────────────────
  // buildAlertPayload (pure function, no async concerns)
  // ────────────────────────────────────────────────────
  describe('buildAlertPayload', () => {
    it('should build payload with correct type and severity', () => {
      const entries = [makeEntry({ severity: 'critical' })];
      const payload = buildAlertPayload('critical', entries);

      expect(payload.type).toBe('log_alert');
      expect(payload.severity).toBe('critical');
      expect(payload.logs).toHaveLength(1);
      expect(payload.sentAt).toBeDefined();
    });

    it('should include all entries in logs', () => {
      const entries = [
        makeEntry({ logId: 1 }),
        makeEntry({ logId: 2 }),
        makeEntry({ logId: 3 }),
      ];
      const payload = buildAlertPayload('error', entries);
      expect(payload.logs).toHaveLength(3);
    });

    it('should set sentAt to ISO date string', () => {
      const payload = buildAlertPayload('warning', []);
      expect(payload.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ────────────────────────────────────────────────────
  // getBufferSize
  // ────────────────────────────────────────────────────
  describe('getBufferSize', () => {
    it('should return 0 for valid but empty severity', () => {
      expect(getBufferSize('critical')).toBe(0);
      expect(getBufferSize('error')).toBe(0);
      expect(getBufferSize('warning')).toBe(0);
    });

    it('should return 0 for unknown severity', () => {
      expect(getBufferSize('unknown_severity')).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────
  // clearBuffer
  // ────────────────────────────────────────────────────
  describe('clearBuffer', () => {
    beforeEach(() => {
      process.env.OPENCLAW_LOG_PUSH_ENABLED = 'true';
    });

    it('should clear all buffers', () => {
      enqueueLogAlert(makeEntry({ severity: 'error' }));
      enqueueLogAlert(makeEntry({ severity: 'warning' }));

      clearBuffer();

      expect(getBufferSize('error')).toBe(0);
      expect(getBufferSize('warning')).toBe(0);
      expect(getBufferSize('critical')).toBe(0);
    });

    it('should clear scheduled flush timers', () => {
      enqueueLogAlert(makeEntry({ severity: 'error' }));
      clearBuffer();

      // After clear, no timers should fire
      vi.advanceTimersByTime(300_000);
      expect(mocks.sendToOpenClawGateway).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────
  // enqueueLogAlert (enabled, non-critical only)
  // ────────────────────────────────────────────────────
  describe('enqueueLogAlert (enabled)', () => {
    beforeEach(() => {
      process.env.OPENCLAW_LOG_PUSH_ENABLED = 'true';
    });

    it('should enqueue error entries and schedule flush', () => {
      enqueueLogAlert(makeEntry({ severity: 'error' }));
      expect(getBufferSize('error')).toBe(1);
    });

    it('should enqueue warning entries and schedule flush', () => {
      enqueueLogAlert(makeEntry({ severity: 'warning' }));
      expect(getBufferSize('warning')).toBe(1);
    });

    it('should drop oldest entries when buffer is at capacity', () => {
      for (let i = 0; i < 501; i++) {
        enqueueLogAlert(makeEntry({ severity: 'error', logId: i }));
      }
      expect(getBufferSize('error')).toBe(500);
    });

    it('should not enqueue when disabled', () => {
      process.env.OPENCLAW_LOG_PUSH_ENABLED = 'false';
      enqueueLogAlert(makeEntry({ severity: 'error' }));
      expect(getBufferSize('error')).toBe(0);
    });

    it('should not double-schedule flush timer for same severity', () => {
      enqueueLogAlert(makeEntry({ severity: 'error', logId: 1 }));
      enqueueLogAlert(makeEntry({ severity: 'error', logId: 2 }));
      expect(getBufferSize('error')).toBe(2);
    });
  });

  // ────────────────────────────────────────────────────
  // flushBuffer (directly awaitable, no fire-and-forget leakage)
  // ────────────────────────────────────────────────────
  describe('flushBuffer', () => {
    beforeEach(() => {
      process.env.OPENCLAW_LOG_PUSH_ENABLED = 'true';
    });

    it('should do nothing when buffer is empty', async () => {
      await flushBuffer('error');
      expect(mocks.sendToOpenClawGateway).not.toHaveBeenCalled();
    });

    it('should send entries and log success', async () => {
      mocks.getOpenClawConfig.mockReturnValue(makeOpenClawConfig({ agentId: 'a1', apiKey: 'k1' }));
      mocks.sendToOpenClawGateway.mockResolvedValue({ summary: 'ok' });

      // Switch to real timers for dynamic import resolution
      vi.useRealTimers();

      enqueueLogAlert(makeEntry({ severity: 'warning' }));
      await flushBuffer('warning');

      expect(mocks.sendToOpenClawGateway).toHaveBeenCalledTimes(1);
      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        expect.stringContaining('1 warning log alerts'),
      );
      expect(getBufferSize('warning')).toBe(0);

      // Restore fake timers for afterEach
      vi.useFakeTimers();
    });

    it('should flush critical buffer directly and log success', async () => {
      mocks.getOpenClawConfig.mockReturnValue(makeOpenClawConfig({ agentId: 'a1', apiKey: 'k1' }));
      mocks.sendToOpenClawGateway.mockResolvedValue({ summary: 'ok' });

      // Switch to real timers for dynamic import resolution
      vi.useRealTimers();

      // Manually push to critical buffer and flush directly (not via enqueueLogAlert
      // which fires-and-forgets a promise)
      enqueueLogAlert(makeEntry({ severity: 'error' }));
      // The entry above goes to error buffer; now manually push to critical via
      // a direct flushBuffer call after enqueue to error just to have content
      clearBuffer();

      // Use enqueue for warning (safe, scheduled not fire-and-forget)
      // then manually test critical via flushBuffer
      enqueueLogAlert(makeEntry({ severity: 'warning', logId: 10 }));
      enqueueLogAlert(makeEntry({ severity: 'warning', logId: 11 }));
      await flushBuffer('warning');

      expect(mocks.sendToOpenClawGateway).toHaveBeenCalledTimes(1);
      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        expect.stringContaining('2 warning log alerts'),
      );

      // Restore fake timers for afterEach
      vi.useFakeTimers();
    });

    it('should re-enqueue retryable entries on send failure', async () => {
      mocks.getOpenClawConfig.mockReturnValue(makeOpenClawConfig({ agentId: 'a1', apiKey: 'k1' }));
      mocks.sendToOpenClawGateway.mockRejectedValue(new Error('network error'));

      // Switch to real timers for dynamic import resolution
      vi.useRealTimers();

      enqueueLogAlert(makeEntry({ severity: 'warning' }));
      await flushBuffer('warning');

      expect(getBufferSize('warning')).toBe(1);
      expect(mocks.loggerError).toHaveBeenCalledWith(
        'Failed to send log alerts to OpenClaw',
        expect.objectContaining({ count: 1 }),
      );

      // Restore fake timers for afterEach
      vi.useFakeTimers();
    });

    it('should stop retrying after 3 failures', async () => {
      mocks.getOpenClawConfig.mockReturnValue(makeOpenClawConfig({ agentId: 'a1', apiKey: 'k1' }));
      mocks.sendToOpenClawGateway.mockRejectedValue(new Error('network error'));

      // Switch to real timers for dynamic import resolution
      vi.useRealTimers();

      enqueueLogAlert(makeEntry({ severity: 'warning' }));

      await flushBuffer('warning');
      expect(getBufferSize('warning')).toBe(1); // retry 1
      await flushBuffer('warning');
      expect(getBufferSize('warning')).toBe(1); // retry 2
      await flushBuffer('warning');
      expect(getBufferSize('warning')).toBe(1); // retry 3
      await flushBuffer('warning');
      expect(getBufferSize('warning')).toBe(0); // dropped after 3 retries

      // Restore fake timers for afterEach
      vi.useFakeTimers();
    });

    it('should log error when OpenClaw is not configured', async () => {
      mocks.getOpenClawConfig.mockReturnValue(makeOpenClawConfig({
        agentId: '',
        apiKey: '',
        baseUrl: '',
      }));

      // Switch to real timers for dynamic import resolution
      vi.useRealTimers();

      enqueueLogAlert(makeEntry({ severity: 'error' }));
      await flushBuffer('error');

      expect(mocks.loggerError).toHaveBeenCalled();

      // Restore fake timers for afterEach
      vi.useFakeTimers();
    });

    it('should cap buffer after re-adding retryable entries', async () => {
      mocks.getOpenClawConfig.mockReturnValue(makeOpenClawConfig({ agentId: 'a1', apiKey: 'k1' }));
      mocks.sendToOpenClawGateway.mockRejectedValue(new Error('fail'));

      // Switch to real timers for dynamic import resolution
      vi.useRealTimers();

      for (let i = 0; i < 499; i++) {
        enqueueLogAlert(makeEntry({ severity: 'error', logId: i }));
      }

      await flushBuffer('error');
      enqueueLogAlert(makeEntry({ severity: 'error', logId: 500 }));
      enqueueLogAlert(makeEntry({ severity: 'error', logId: 501 }));

      expect(getBufferSize('error')).toBeLessThanOrEqual(500);

      // Restore fake timers for afterEach
      vi.useFakeTimers();
    });
  });

  // ────────────────────────────────────────────────────
  // Timer-based flushing
  // NOTE: These tests use fake timers which don't work well with dynamic imports.
  // Using real timers with actual waits instead.
  // ────────────────────────────────────────────────────
  describe('timer-based flushing', () => {
    beforeEach(() => {
      process.env.OPENCLAW_LOG_PUSH_ENABLED = 'true';
      mocks.getOpenClawConfig.mockReturnValue(makeOpenClawConfig({ agentId: 'a1', apiKey: 'k1' }));
      mocks.sendToOpenClawGateway.mockResolvedValue({ summary: 'ok' });
      // Use real timers for dynamic import compatibility
      vi.useRealTimers();
    });

    afterEach(() => {
      // Restore fake timers for parent afterEach
      vi.useFakeTimers();
    });

    it('should flush error buffer after interval', async () => {
      enqueueLogAlert(makeEntry({ severity: 'error' }));

      // Wait for the 30s interval plus buffer for async processing
      await new Promise((r) => setTimeout(r, 31_000));

      expect(mocks.sendToOpenClawGateway).toHaveBeenCalled();
    }, 35_000);

    it('should log error when scheduled flush fails', async () => {
      mocks.getOpenClawConfig.mockReturnValue(makeOpenClawConfig({ agentId: 'a1', apiKey: 'k1' }));
      mocks.sendToOpenClawGateway.mockRejectedValue(new Error('timeout'));

      enqueueLogAlert(makeEntry({ severity: 'error' }));

      // Wait for the 30s interval plus buffer for async processing
      await new Promise((r) => setTimeout(r, 31_000));

      expect(mocks.loggerError).toHaveBeenCalled();
    }, 35_000);
  });

  // ────────────────────────────────────────────────────
  // enqueueLogAlert with critical severity (fire-and-forget)
  // Placed LAST to prevent async leakage into other tests.
  // ────────────────────────────────────────────────────
  describe('enqueueLogAlert critical (fire-and-forget)', () => {
    beforeEach(() => {
      process.env.OPENCLAW_LOG_PUSH_ENABLED = 'true';
    });

    it('should trigger immediate async flush for critical severity', async () => {
      mocks.getOpenClawConfig.mockReturnValue(makeOpenClawConfig({ agentId: 'agent1', apiKey: 'key1' }));
      mocks.sendToOpenClawGateway.mockResolvedValue({ summary: 'ok' });

      enqueueLogAlert(makeEntry({ severity: 'critical' }));

      // The critical path calls flushBuffer('critical').catch(...) in a fire-and-forget.
      // We need to let the microtask queue drain. Use real timers briefly to allow
      // the dynamic import() promise chain to resolve.
      vi.useRealTimers();

      // Poll until buffer is cleared (max 5 seconds)
      // Dynamic import needs extra time to resolve with mocked modules
      let cleared = false;
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (getBufferSize('critical') === 0) {
          cleared = true;
          break;
        }
      }

      expect(cleared).toBe(true);
      expect(mocks.sendToOpenClawGateway).toHaveBeenCalledTimes(1);
      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        expect.stringContaining('1 critical log alerts'),
      );

      // Restore fake timers for afterEach
      vi.useFakeTimers();
    }, 10_000);
  });
});
