import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'util';
import { execFile } from 'child_process';

const mocks = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  execFileAsync: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
    debug: vi.fn(),
  },
}));

vi.mock('util', async (importOriginal) => {
  const original = await importOriginal<typeof import('util')>();
  return {
    ...original,
    promisify: (fn: unknown) => {
      if (fn === execFile) {
        return mocks.execFileAsync;
      }
      return original.promisify(fn as any);
    },
  };
});

vi.mock('../utils/http-utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/http-utils')>();
  return {
    ...original,
    sleep: mocks.sleep,
  };
});

import {
  getOpenClawConfig,
  handoffToOpenClaw,
  resetOpenClawWebhookReplayCacheForTests,
  sendToOpenClawGateway,
  verifyOpenClawWebhookSignature,
  consumeOpenClawWebhookReplay,
  isOpenClawWebhookReplay,
  releaseOpenClawWebhookReplay,
} from '../services/openclaw-service';

const OPENCLAW_ENV_KEYS = [
  'OPENCLAW_CONNECTOR_MODE',
  'OPENCLAW_CLI_PATH',
  'OPENCLAW_BASE_URL',
  'OPENCLAW_API_KEY',
  'OPENCLAW_AGENT_ID',
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

function setCliEnv(): void {
  process.env.OPENCLAW_CONNECTOR_MODE = 'gateway_cli';
  process.env.OPENCLAW_CLI_PATH = '/usr/bin/openclaw';
  process.env.OPENCLAW_AGENT_ID = 'test-cli-agent';
  process.env.OPENCLAW_RETRY_MAX = '0';
  process.env.OPENCLAW_TIMEOUT_SECONDS = '10';
}

function setLegacyEnv(): void {
  process.env.OPENCLAW_CONNECTOR_MODE = 'legacy_http';
  process.env.OPENCLAW_BASE_URL = 'https://openclaw.example.com/';
  process.env.OPENCLAW_API_KEY = 'test-api-key';
  process.env.OPENCLAW_AGENT_ID = 'test-agent';
  process.env.OPENCLAW_RETRY_MAX = '0';
}

const originalFetch = global.fetch;

describe('openclaw-service-ultra', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetEnv();
    resetOpenClawWebhookReplayCacheForTests();
    global.fetch = originalFetch;
    mocks.sleep.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetEnv();
    resetOpenClawWebhookReplayCacheForTests();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  // ── handoffViaGatewayCli ──
  describe('handoffViaGatewayCli', () => {
    it('successfully hands off via gateway CLI with valid JSON response', async () => {
      setCliEnv();

      mocks.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          status: 'completed',
          result: {
            payloads: [{ text: 'Task accepted and processed' }],
            meta: { agentMeta: { sessionId: 'cli-session-123' } },
          },
        }),
      } as never);

      const result = await handoffToOpenClaw({
        requestId: 100,
        pharmacyId: 5,
        requestText: 'CLI test request',
      });

      expect(result.accepted).toBe(true);
      expect(result.connectorConfigured).toBe(true);
      expect(result.threadId).toBe('cli-session-123');
      expect(result.summary).toBe('Task accepted and processed');
      expect(result.status).toBe('in_dialogue');
    });

    it('includes structured context in gateway CLI messages', async () => {
      setCliEnv();

      mocks.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          result: {
            payloads: [{ text: 'Task accepted and processed' }],
            meta: { agentMeta: { sessionId: 'cli-session-ctx' } },
          },
        }),
      } as never);

      await handoffToOpenClaw({
        requestId: 110,
        pharmacyId: 6,
        requestText: 'CLI context test',
        context: {
          sentryEventId: 'evt-123',
          sourceFile: 'server/src/app.ts',
        },
      });

      const callArgs = mocks.execFileAsync.mock.calls[0]?.[1] as string[];
      const message = callArgs[callArgs.indexOf('--message') + 1];
      expect(message).toContain('追加コンテキスト(JSON)');
      expect(message).toContain('evt-123');
      expect(message).toContain('server/src/app.ts');
    });

    it('returns null threadId when sessionId is empty', async () => {
      setCliEnv();

      mocks.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          result: {
            payloads: [{ text: 'response' }],
            meta: { agentMeta: { sessionId: '' } },
          },
        }),
      } as never);

      const result = await handoffToOpenClaw({
        requestId: 101,
        pharmacyId: 5,
        requestText: 'empty session test',
      });

      expect(result.accepted).toBe(true);
      expect(result.threadId).toBeNull();
    });

    it('returns null threadId when sessionId is not a string', async () => {
      setCliEnv();

      mocks.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          result: {
            payloads: [],
            meta: { agentMeta: { sessionId: 12345 } },
          },
        }),
      } as never);

      const result = await handoffToOpenClaw({
        requestId: 102,
        pharmacyId: 5,
        requestText: 'non-string session test',
      });

      expect(result.accepted).toBe(true);
      expect(result.threadId).toBeNull();
    });

    it('uses fallback stdout as summary when no valid text in payloads', async () => {
      setCliEnv();

      mocks.execFileAsync.mockResolvedValue({
        stdout: 'plain text output from CLI',
      } as never);

      const result = await handoffToOpenClaw({
        requestId: 103,
        pharmacyId: 5,
        requestText: 'fallback summary test',
      });

      expect(result.accepted).toBe(true);
      expect(result.summary).toBe('plain text output from CLI');
    });

    it('returns null summary when stdout is empty', async () => {
      setCliEnv();

      mocks.execFileAsync.mockResolvedValue({
        stdout: '',
      } as never);

      const result = await handoffToOpenClaw({
        requestId: 104,
        pharmacyId: 5,
        requestText: 'empty stdout test',
      });

      expect(result.accepted).toBe(true);
      expect(result.summary).toBeNull();
    });

    it('handles CLI error and returns failure', async () => {
      setCliEnv();

      mocks.execFileAsync.mockRejectedValue(new Error('CLI crashed'));

      const result = await handoffToOpenClaw({
        requestId: 105,
        pharmacyId: 5,
        requestText: 'cli error test',
      });

      expect(result.accepted).toBe(false);
      expect(result.note).toContain('Gateway CLI');
    });

    it('retries CLI on failure when retry is available', async () => {
      setCliEnv();
      process.env.OPENCLAW_RETRY_MAX = '1';

      mocks.execFileAsync
        .mockRejectedValueOnce(new Error('first attempt failed'))
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            result: { payloads: [{ text: 'retry ok' }] },
          }),
        } as never);

      const result = await handoffToOpenClaw({
        requestId: 106,
        pharmacyId: 5,
        requestText: 'retry test',
      });

      expect(result.accepted).toBe(true);
      expect(result.summary).toBe('retry ok');
      expect(mocks.execFileAsync).toHaveBeenCalledTimes(2);
    });

    it('handles invalid JSON from CLI stdout gracefully', async () => {
      setCliEnv();

      mocks.execFileAsync.mockResolvedValue({
        stdout: 'not { valid json',
      } as never);

      const result = await handoffToOpenClaw({
        requestId: 107,
        pharmacyId: 5,
        requestText: 'invalid json test',
      });

      expect(result.accepted).toBe(true);
      // Should use fallback stdout as summary
      expect(result.summary).toBe('not { valid json');
    });

    it('truncates summary to 4000 chars', async () => {
      setCliEnv();

      const longText = 'x'.repeat(5000);
      mocks.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          result: {
            payloads: [{ text: longText }],
          },
        }),
      } as never);

      const result = await handoffToOpenClaw({
        requestId: 108,
        pharmacyId: 5,
        requestText: 'long summary test',
      });

      expect(result.accepted).toBe(true);
      expect(result.summary!.length).toBe(4000);
    });
  });

  // ── sendToOpenClawGateway via gateway_cli ──
  describe('sendToOpenClawGateway gateway_cli', () => {
    it('sends via CLI and returns result string', async () => {
      setCliEnv();

      mocks.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ result: 'CLI response text' }),
      } as never);

      const result = await sendToOpenClawGateway({
        agentId: 'test-agent',
        message: 'test message',
      });

      expect(result.summary).toBe('CLI response text');
    });

    it('returns message field when result is not a string', async () => {
      setCliEnv();

      mocks.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ message: 'msg response' }),
      } as never);

      const result = await sendToOpenClawGateway({
        agentId: 'test-agent',
        message: 'test message',
      });

      expect(result.summary).toBe('msg response');
    });

    it('returns stdout slice when neither result nor message are strings', async () => {
      setCliEnv();

      mocks.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ data: { nested: true } }),
      } as never);

      const result = await sendToOpenClawGateway({
        agentId: 'test-agent',
        message: 'test message',
      });

      // It should use stdout.slice(0, 500)
      expect(result.summary).toContain('data');
    });

    it('handles invalid JSON from CLI gracefully', async () => {
      setCliEnv();

      mocks.execFileAsync.mockResolvedValue({
        stdout: 'raw text output',
      } as never);

      const result = await sendToOpenClawGateway({
        agentId: 'test-agent',
        message: 'test message',
      });

      // Falls back to stdout.slice(0, 500)
      expect(result.summary).toBe('raw text output');
    });
  });

  // ── resolveRetryMax / resolveRetryBaseMs / resolveIdempotencyTtlMs edge cases ──
  describe('env resolution edge cases', () => {
    it('uses default retry max when env is NaN', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = 'not-a-number';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'in_dialogue', threadId: 't-1', summary: 'ok' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 200,
        pharmacyId: 1,
        requestText: 'env test',
      });

      expect(result.accepted).toBe(true);
    });

    it('clamps retry max to 0-5 range', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '100';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'in_dialogue', threadId: 't-2', summary: 'ok' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 201,
        pharmacyId: 1,
        requestText: 'clamp test',
      });

      expect(result.accepted).toBe(true);
    });

    it('uses default timeout when OPENCLAW_TIMEOUT_MS is NaN', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_TIMEOUT_MS = 'bad';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'in_dialogue' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 202,
        pharmacyId: 1,
        requestText: 'timeout default test',
      });

      expect(result.accepted).toBe(true);
    });

    it('uses default OPENCLAW_TIMEOUT_SECONDS when NaN', async () => {
      setCliEnv();
      process.env.OPENCLAW_TIMEOUT_SECONDS = 'bad';

      mocks.execFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ result: { payloads: [{ text: 'ok' }] } }),
      } as never);

      const result = await handoffToOpenClaw({
        requestId: 203,
        pharmacyId: 1,
        requestText: 'cli timeout test',
      });

      expect(result.accepted).toBe(true);
    });

    it('uses default OPENCLAW_RETRY_BASE_MS when NaN', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '1';
      process.env.OPENCLAW_RETRY_BASE_MS = 'bad';

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: 'in_dialogue' }),
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 204,
        pharmacyId: 1,
        requestText: 'retry base test',
      });

      expect(result.accepted).toBe(true);
    });

    it('uses default OPENCLAW_IDEMPOTENCY_TTL_MS when NaN', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_IDEMPOTENCY_TTL_MS = 'invalid';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'in_dialogue', threadId: 'tid', summary: 'ok' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 205,
        pharmacyId: 1,
        requestText: 'ttl test',
      });

      expect(result.accepted).toBe(true);
    });
  });

  // ── isRetryableStatus edge cases ──
  describe('retryable status detection', () => {
    it('retries on HTTP 408 (timeout)', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '1';

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 408,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: 'in_dialogue' }),
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 300,
        pharmacyId: 1,
        requestText: '408 retry test',
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.accepted).toBe(true);
    });

    it('retries on HTTP 429 (rate limited)', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '1';

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: 'in_dialogue' }),
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 301,
        pharmacyId: 1,
        requestText: '429 retry test',
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.accepted).toBe(true);
    });

    it('does not retry on HTTP 403 (non-retryable)', async () => {
      setLegacyEnv();
      process.env.OPENCLAW_RETRY_MAX = '1';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({}),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await handoffToOpenClaw({
        requestId: 302,
        pharmacyId: 1,
        requestText: '403 no retry test',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.accepted).toBe(false);
    });
  });

  // ── webhook replay pruning ──
  describe('webhook replay cache pruning', () => {
    it('prunes expired entries from replay cache', () => {
      process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
      process.env.OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS = '10';

      const now = 1000000000;

      // Consume a replay entry
      const consumed = consumeOpenClawWebhookReplay({
        receivedSignature: 'sig-1',
        receivedTimestamp: String(now),
        nowMs: now * 1000,
      });
      expect(consumed).toBe(true);

      // Check that it's a replay
      expect(isOpenClawWebhookReplay({
        receivedSignature: 'sig-1',
        receivedTimestamp: String(now),
        nowMs: now * 1000 + 1000,
      })).toBe(true);

      // After expiry (10 seconds * 1000ms + some time)
      expect(isOpenClawWebhookReplay({
        receivedSignature: 'sig-1',
        receivedTimestamp: String(now),
        nowMs: now * 1000 + 11_000,
      })).toBe(false);
    });
  });

  // ── releaseOpenClawWebhookReplay with empty normalized timestamp ──
  describe('releaseOpenClawWebhookReplay edge cases', () => {
    it('does nothing when timestamp is whitespace-only', () => {
      releaseOpenClawWebhookReplay({
        receivedSignature: 'sig',
        receivedTimestamp: '   ',
      });
      // Should not throw
    });
  });

  // ── normalizeBaseUrl edge cases via getOpenClawConfig ──
  describe('normalizeBaseUrl edge cases', () => {
    it('strips query and hash from base URL', () => {
      process.env.OPENCLAW_BASE_URL = 'https://example.com/api?foo=bar#section';
      const config = getOpenClawConfig();
      expect(config.baseUrl).not.toContain('?');
      expect(config.baseUrl).not.toContain('#');
      expect(config.baseUrlError).toBeNull();
    });

    it('accepts http://[::1] as localhost', () => {
      process.env.OPENCLAW_BASE_URL = 'http://[::1]:8080';
      const config = getOpenClawConfig();
      expect(config.baseUrlError).toBeNull();
    });
  });
});
