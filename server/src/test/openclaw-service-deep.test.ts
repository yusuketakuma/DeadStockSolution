import crypto from 'crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  canTransitionOpenClawStatus,
  consumeOpenClawWebhookReplay,
  getOpenClawConfig,
  getOpenClawImplementationBranch,
  handoffToOpenClaw,
  isImplementationBranchAllowed,
  isOpenClawConnectorConfigured,
  isOpenClawStatus,
  isOpenClawWebhookConfigured,
  isOpenClawWebhookReplay,
  releaseOpenClawWebhookReplay,
  resetOpenClawWebhookReplayCacheForTests,
  sendToOpenClawGateway,
  verifyOpenClawWebhookSignature,
} from '../services/openclaw-service';

const OPENCLAW_ENV_KEYS = [
  'OPENCLAW_CONNECTOR_MODE',
  'OPENCLAW_CLI_PATH',
  'OPENCLAW_BASE_URL',
  'OPENCLAW_API_KEY',
  'OPENCLAW_AGENT_ID',
  'OPENCLAW_IMPLEMENT_BRANCH',
  'OPENCLAW_TIMEOUT_MS',
  'OPENCLAW_TIMEOUT_SECONDS',
  'OPENCLAW_RETRY_MAX',
  'OPENCLAW_RETRY_BASE_MS',
  'OPENCLAW_IDEMPOTENCY_TTL_MS',
  'OPENCLAW_WEBHOOK_SECRET',
  'OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS',
] as const;

const savedEnv: Partial<Record<string, string | undefined>> = {};
for (const key of OPENCLAW_ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

function resetEnv(): void {
  for (const key of OPENCLAW_ENV_KEYS) {
    const value = savedEnv[key];
    if (typeof value === 'string') {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

function setLegacyEnv(): void {
  process.env.OPENCLAW_CONNECTOR_MODE = 'legacy_http';
  process.env.OPENCLAW_BASE_URL = 'https://openclaw.example.com/';
  process.env.OPENCLAW_API_KEY = 'test-api-key';
  process.env.OPENCLAW_AGENT_ID = 'test-agent';
}

function setCliEnv(): void {
  process.env.OPENCLAW_CONNECTOR_MODE = 'gateway_cli';
  process.env.OPENCLAW_CLI_PATH = '/usr/bin/openclaw';
  process.env.OPENCLAW_AGENT_ID = 'test-cli-agent';
}

function makeSignature(secret: string, ts: number, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
}

const originalFetch = global.fetch;

describe('openclaw-service-deep', () => {
  afterEach(() => {
    resetEnv();
    resetOpenClawWebhookReplayCacheForTests();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  // ── getOpenClawConfig ──
  describe('getOpenClawConfig', () => {
    it('returns config with gateway_cli mode', () => {
      setCliEnv();
      const config = getOpenClawConfig();
      expect(config.mode).toBe('gateway_cli');
      expect(config.cliPath).toBe('/usr/bin/openclaw');
      expect(config.agentId).toBe('test-cli-agent');
    });

    it('returns config with legacy_http mode by default', () => {
      setLegacyEnv();
      const config = getOpenClawConfig();
      expect(config.mode).toBe('legacy_http');
      expect(config.baseUrl).toContain('openclaw.example.com');
      expect(config.baseUrlError).toBeNull();
    });

    it('trims whitespace from env vars', () => {
      process.env.OPENCLAW_CLI_PATH = '  /usr/bin/oc  ';
      process.env.OPENCLAW_API_KEY = '  key  ';
      process.env.OPENCLAW_AGENT_ID = '  agent  ';
      process.env.OPENCLAW_WEBHOOK_SECRET = '  secret  ';
      const config = getOpenClawConfig();
      expect(config.cliPath).toBe('/usr/bin/oc');
      expect(config.apiKey).toBe('key');
      expect(config.agentId).toBe('agent');
      expect(config.webhookSecret).toBe('secret');
    });

    it('normalizes base URL by removing trailing slash', () => {
      process.env.OPENCLAW_BASE_URL = 'https://example.com/';
      const config = getOpenClawConfig();
      expect(config.baseUrl).toBe('https://example.com');
    });

    it('reports missing base URL', () => {
      delete process.env.OPENCLAW_BASE_URL;
      const config = getOpenClawConfig();
      expect(config.baseUrlError).toBe('missing');
    });

    it('reports invalid base URL', () => {
      process.env.OPENCLAW_BASE_URL = '://bad-url';
      const config = getOpenClawConfig();
      expect(config.baseUrlError).toBe('invalid');
    });

    it('reports insecure base URL', () => {
      process.env.OPENCLAW_BASE_URL = 'http://remote-host.example.com';
      const config = getOpenClawConfig();
      expect(config.baseUrlError).toBe('insecure');
    });

    it('allows http for 127.0.0.1', () => {
      process.env.OPENCLAW_BASE_URL = 'http://127.0.0.1:8080';
      const config = getOpenClawConfig();
      expect(config.baseUrlError).toBeNull();
    });
  });

  // ── isOpenClawStatus ──
  describe('isOpenClawStatus', () => {
    it('returns true for valid statuses', () => {
      expect(isOpenClawStatus('pending_handoff')).toBe(true);
      expect(isOpenClawStatus('in_dialogue')).toBe(true);
      expect(isOpenClawStatus('implementing')).toBe(true);
      expect(isOpenClawStatus('completed')).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isOpenClawStatus('unknown')).toBe(false);
      expect(isOpenClawStatus(null)).toBe(false);
      expect(isOpenClawStatus(undefined)).toBe(false);
      expect(isOpenClawStatus(42)).toBe(false);
      expect(isOpenClawStatus('')).toBe(false);
    });
  });

  // ── canTransitionOpenClawStatus ──
  describe('canTransitionOpenClawStatus', () => {
    it('allows forward transitions', () => {
      expect(canTransitionOpenClawStatus('pending_handoff', 'in_dialogue')).toBe(true);
      expect(canTransitionOpenClawStatus('in_dialogue', 'implementing')).toBe(true);
      expect(canTransitionOpenClawStatus('implementing', 'completed')).toBe(true);
      expect(canTransitionOpenClawStatus('pending_handoff', 'completed')).toBe(true);
    });

    it('allows same-status transitions', () => {
      expect(canTransitionOpenClawStatus('in_dialogue', 'in_dialogue')).toBe(true);
      expect(canTransitionOpenClawStatus('completed', 'completed')).toBe(true);
    });

    it('rejects backward transitions', () => {
      expect(canTransitionOpenClawStatus('completed', 'pending_handoff')).toBe(false);
      expect(canTransitionOpenClawStatus('implementing', 'in_dialogue')).toBe(false);
      expect(canTransitionOpenClawStatus('in_dialogue', 'pending_handoff')).toBe(false);
    });
  });

  // ── isOpenClawWebhookConfigured ──
  describe('isOpenClawWebhookConfigured', () => {
    it('returns true when webhook secret is set', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'secret-value';
      expect(isOpenClawWebhookConfigured()).toBe(true);
    });

    it('returns false when webhook secret is empty', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = '';
      expect(isOpenClawWebhookConfigured()).toBe(false);
    });

    it('returns false when webhook secret is not set', () => {
      delete process.env.OPENCLAW_WEBHOOK_SECRET;
      expect(isOpenClawWebhookConfigured()).toBe(false);
    });
  });

  describe('sendToOpenClawGateway', () => {
    it('returns empty summary for malformed legacy_http response payload', async () => {
      setLegacyEnv();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 42 } }] }),
      }) as unknown as typeof fetch;

      await expect(sendToOpenClawGateway({ agentId: 'test-agent', message: 'hello' })).resolves.toEqual({ summary: '' });
    });
  });

  // ── isImplementationBranchAllowed ──
  describe('isImplementationBranchAllowed', () => {
    it('returns true for review branch', () => {
      expect(isImplementationBranchAllowed('review')).toBe(true);
    });

    it('returns true for review branch with whitespace', () => {
      expect(isImplementationBranchAllowed('  review  ')).toBe(true);
    });

    it('returns false for other branches', () => {
      expect(isImplementationBranchAllowed('main')).toBe(false);
      expect(isImplementationBranchAllowed('develop')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isImplementationBranchAllowed(null)).toBe(false);
      expect(isImplementationBranchAllowed(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isImplementationBranchAllowed('')).toBe(false);
    });
  });

  // ── verifyOpenClawWebhookSignature edge cases ──
  describe('verifyOpenClawWebhookSignature edge cases', () => {
    it('returns false when secret is not set', () => {
      delete process.env.OPENCLAW_WEBHOOK_SECRET;
      expect(verifyOpenClawWebhookSignature({
        receivedSignature: 'sha256=abc',
        receivedTimestamp: '1000000',
        rawBody: '{}',
      })).toBe(false);
    });

    it('returns false when signature is missing', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
      expect(verifyOpenClawWebhookSignature({
        receivedSignature: undefined,
        receivedTimestamp: '1000000',
        rawBody: '{}',
      })).toBe(false);
    });

    it('returns false when timestamp is missing', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
      expect(verifyOpenClawWebhookSignature({
        receivedSignature: 'sha256=abc',
        receivedTimestamp: undefined,
        rawBody: '{}',
      })).toBe(false);
    });

    it('returns false when rawBody is not a string', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
      expect(verifyOpenClawWebhookSignature({
        receivedSignature: 'sha256=abc',
        receivedTimestamp: '1000000',
        rawBody: undefined,
      })).toBe(false);
    });

    it('returns false when timestamp is not a valid integer', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
      expect(verifyOpenClawWebhookSignature({
        receivedSignature: 'sha256=abc',
        receivedTimestamp: 'not-a-number',
        rawBody: '{}',
      })).toBe(false);
    });

    it('returns false when timestamp is zero', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
      expect(verifyOpenClawWebhookSignature({
        receivedSignature: 'sha256=abc',
        receivedTimestamp: '0',
        rawBody: '{}',
      })).toBe(false);
    });

    it('returns false when signature is not valid hex', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
      const now = Math.floor(Date.now() / 1000);
      expect(verifyOpenClawWebhookSignature({
        receivedSignature: 'sha256=not-valid-hex-64chars',
        receivedTimestamp: String(now),
        rawBody: '{}',
        nowMs: now * 1000,
      })).toBe(false);
    });

    it('handles signature without sha256= prefix', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'webhook-secret';
      const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
      const ts = Math.floor(nowMs / 1000);
      const rawBody = '{}';
      const digest = crypto.createHmac('sha256', 'webhook-secret').update(`${ts}.${rawBody}`).digest('hex');

      expect(verifyOpenClawWebhookSignature({
        receivedSignature: digest,
        receivedTimestamp: String(ts),
        rawBody,
        nowMs,
      })).toBe(true);
    });

    it('returns false when computed signature does not match', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'webhook-secret';
      const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
      const ts = Math.floor(nowMs / 1000);
      const rawBody = '{}';
      // Generate a valid-length hex string that doesn't match
      const fakeSignature = 'a'.repeat(64);

      expect(verifyOpenClawWebhookSignature({
        receivedSignature: `sha256=${fakeSignature}`,
        receivedTimestamp: String(ts),
        rawBody,
        nowMs,
      })).toBe(false);
    });
  });

  // ── consumeOpenClawWebhookReplay edge cases ──
  describe('consumeOpenClawWebhookReplay edge cases', () => {
    it('returns false when signature is undefined', () => {
      expect(consumeOpenClawWebhookReplay({
        receivedSignature: undefined,
        receivedTimestamp: '12345',
      })).toBe(false);
    });

    it('returns false when timestamp is undefined', () => {
      expect(consumeOpenClawWebhookReplay({
        receivedSignature: 'sig',
        receivedTimestamp: undefined,
      })).toBe(false);
    });

    it('returns false when normalized signature is empty', () => {
      expect(consumeOpenClawWebhookReplay({
        receivedSignature: 'sha256=',
        receivedTimestamp: '12345',
      })).toBe(false);
    });

    it('returns false when timestamp is empty after trim', () => {
      expect(consumeOpenClawWebhookReplay({
        receivedSignature: 'valid-sig',
        receivedTimestamp: '   ',
      })).toBe(false);
    });
  });

  // ── isOpenClawWebhookReplay edge cases ──
  describe('isOpenClawWebhookReplay edge cases', () => {
    it('returns false when signature is undefined', () => {
      expect(isOpenClawWebhookReplay({
        receivedSignature: undefined,
        receivedTimestamp: '12345',
      })).toBe(false);
    });

    it('returns false when timestamp is undefined', () => {
      expect(isOpenClawWebhookReplay({
        receivedSignature: 'sig',
        receivedTimestamp: undefined,
      })).toBe(false);
    });
  });

  // ── releaseOpenClawWebhookReplay edge cases ──
  describe('releaseOpenClawWebhookReplay edge cases', () => {
    it('does nothing when signature is undefined', () => {
      releaseOpenClawWebhookReplay({
        receivedSignature: undefined,
        receivedTimestamp: '12345',
      });
      // Should not throw
    });

    it('does nothing when timestamp is undefined', () => {
      releaseOpenClawWebhookReplay({
        receivedSignature: 'sig',
        receivedTimestamp: undefined,
      });
    });

    it('does nothing when normalized signature is empty', () => {
      releaseOpenClawWebhookReplay({
        receivedSignature: 'sha256=',
        receivedTimestamp: '12345',
      });
    });
  });

  // ── handoffToOpenClaw edge cases ──
  describe('handoffToOpenClaw', () => {
    it('returns not configured when gateway_cli mode has no cli path', async () => {
      process.env.OPENCLAW_CONNECTOR_MODE = 'gateway_cli';
      process.env.OPENCLAW_AGENT_ID = 'agent';
      delete process.env.OPENCLAW_CLI_PATH;

      const result = await handoffToOpenClaw({
        requestId: 1,
        pharmacyId: 1,
        requestText: 'test',
      });

      expect(result.accepted).toBe(false);
      expect(result.connectorConfigured).toBe(false);
      expect(result.note).toContain('CLI');
    });

    it('returns not configured with invalid URL message', async () => {
      process.env.OPENCLAW_BASE_URL = '://invalid';
      process.env.OPENCLAW_API_KEY = 'key';
      process.env.OPENCLAW_AGENT_ID = 'agent';

      const result = await handoffToOpenClaw({
        requestId: 2,
        pharmacyId: 1,
        requestText: 'test',
      });

      expect(result.accepted).toBe(false);
      expect(result.note).toContain('不正');
    });

    it('returns not configured with default message for missing URL', async () => {
      delete process.env.OPENCLAW_BASE_URL;
      process.env.OPENCLAW_API_KEY = 'key';
      process.env.OPENCLAW_AGENT_ID = 'agent';

      const result = await handoffToOpenClaw({
        requestId: 3,
        pharmacyId: 1,
        requestText: 'test',
      });

      expect(result.accepted).toBe(false);
      expect(result.note).toContain('未接続');
    });

    it('handles legacy_http handoff with non-retryable error status', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '0';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({}),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 10,
        pharmacyId: 1,
        requestText: 'non-retryable test',
      });

      expect(result.accepted).toBe(false);
      expect(result.note).toContain('400');
    });

    it('handles legacy_http handoff timeout error', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '0';
      process.env.OPENCLAW_TIMEOUT_MS = '100';

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const fetchMock = vi.fn().mockRejectedValue(abortError);
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 11,
        pharmacyId: 1,
        requestText: 'timeout test',
      });

      expect(result.accepted).toBe(false);
      expect(result.note).toContain('タイムアウト');
    });

    it('handles legacy_http handoff with generic error', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '0';

      const fetchMock = vi.fn().mockRejectedValue(new Error('network failure'));
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 12,
        pharmacyId: 1,
        requestText: 'error test',
      });

      expect(result.accepted).toBe(false);
      expect(result.note).toContain('エラー');
    });

    it('handles legacy_http handoff with empty threadId and summary', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '0';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          threadId: '',
          summary: '',
          status: 'implementing',
        }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 13,
        pharmacyId: 2,
        requestText: 'empty response test',
      });

      expect(result.accepted).toBe(true);
      expect(result.threadId).toBeNull();
      expect(result.summary).toBeNull();
      expect(result.status).toBe('implementing');
    });

    it('normalizes unknown status to in_dialogue', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '0';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          threadId: 'thread-1',
          summary: 'ok',
          status: 'unknown_status',
        }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 14,
        pharmacyId: 3,
        requestText: 'status normalization test',
      });

      expect(result.status).toBe('in_dialogue');
    });

    it('does not include context when empty object is provided', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '0';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'in_dialogue', threadId: 'thread-1', summary: 'ok' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await handoffToOpenClaw({
        requestId: 15,
        pharmacyId: 1,
        requestText: 'no context test',
        context: {},
      });

      const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
      expect(body).not.toHaveProperty('context');
    });

    it('handles JSON parse error from legacy_http response', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '0';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => { throw new Error('invalid JSON'); },
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 16,
        pharmacyId: 1,
        requestText: 'json error test',
      });

      // Should still succeed since json parse error is caught
      expect(result.accepted).toBe(true);
    });
  });

  // ── sendToOpenClawGateway ──
  describe('sendToOpenClawGateway', () => {
    it('sends via legacy_http mode and returns summary', async () => {
      setLegacyEnv();

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'response summary' } }],
        }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await sendToOpenClawGateway({
        agentId: 'agent-1',
        message: 'hello',
      });

      expect(result.summary).toBe('response summary');
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('throws on non-ok legacy_http response', async () => {
      setLegacyEnv();

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(sendToOpenClawGateway({
        agentId: 'agent-1',
        message: 'hello',
      })).rejects.toThrow('OpenClaw API error: 500');
    });

    it('returns empty string when choices is missing', async () => {
      setLegacyEnv();

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await sendToOpenClawGateway({
        agentId: 'agent-1',
        message: 'hello',
      });

      expect(result.summary).toBe('');
    });

    it('returns empty summary when choices array is empty in legacy_http', async () => {
      setLegacyEnv();

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await sendToOpenClawGateway({
        agentId: 'agent-1',
        message: 'hello',
      });

      expect(result.summary).toBe('');
    });

    it('returns empty summary when choices message content is missing', async () => {
      setLegacyEnv();

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: {} }] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await sendToOpenClawGateway({
        agentId: 'agent-1',
        message: 'hello',
      });

      expect(result.summary).toBe('');
    });
  });

  // ── resolveWebhookMaxSkewSeconds edge cases ──
  describe('webhook max skew seconds', () => {
    it('uses default when env is invalid', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
      process.env.OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS = 'abc';
      const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
      const ts = Math.floor(nowMs / 1000);
      const rawBody = '{}';
      const sig = makeSignature('secret', ts, rawBody);

      // Should use default 300 seconds and accept
      expect(verifyOpenClawWebhookSignature({
        receivedSignature: sig,
        receivedTimestamp: String(ts),
        rawBody,
        nowMs,
      })).toBe(true);
    });

    it('uses default when env is negative', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
      process.env.OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS = '-1';
      const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
      const ts = Math.floor(nowMs / 1000);
      const rawBody = '{}';
      const sig = makeSignature('secret', ts, rawBody);

      expect(verifyOpenClawWebhookSignature({
        receivedSignature: sig,
        receivedTimestamp: String(ts),
        rawBody,
        nowMs,
      })).toBe(true);
    });

    it('uses default when env exceeds 3600', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
      process.env.OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS = '9999';
      const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
      const ts = Math.floor(nowMs / 1000);
      const rawBody = '{}';
      const sig = makeSignature('secret', ts, rawBody);

      expect(verifyOpenClawWebhookSignature({
        receivedSignature: sig,
        receivedTimestamp: String(ts),
        rawBody,
        nowMs,
      })).toBe(true);
    });
  });
});
