import crypto from 'crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumeOpenClawWebhookReplay,
  getOpenClawImplementationBranch,
  handoffToOpenClaw,
  isImplementationBranchAllowed,
  isOpenClawWebhookReplay,
  isOpenClawConnectorConfigured,
  releaseOpenClawWebhookReplay,
  resetOpenClawWebhookReplayCacheForTests,
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
  'OPENCLAW_WEBHOOK_SECRET',
  'OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS',
] as const;

const originalEnv: Partial<Record<(typeof OPENCLAW_ENV_KEYS)[number], string | undefined>> = {};
for (const key of OPENCLAW_ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

function resetOpenClawEnv(): void {
  for (const key of OPENCLAW_ENV_KEYS) {
    const value = originalEnv[key];
    if (typeof value === 'string') {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

function setConnectorEnv(baseUrl: string): void {
  process.env.OPENCLAW_BASE_URL = baseUrl;
  process.env.OPENCLAW_API_KEY = 'dummy-api-key';
  process.env.OPENCLAW_AGENT_ID = 'dummy-agent-id';
}

function createWebhookSignature(secret: string, timestamp: number, rawBody: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

const originalFetch = global.fetch;

describe('openclaw-service', () => {
  afterEach(() => {
    resetOpenClawEnv();
    resetOpenClawWebhookReplayCacheForTests();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('always uses review as implementation branch', () => {
    process.env.OPENCLAW_IMPLEMENT_BRANCH = 'main';

    expect(getOpenClawImplementationBranch()).toBe('review');
    expect(isImplementationBranchAllowed('review')).toBe(true);
    expect(isImplementationBranchAllowed('main')).toBe(false);
  });

  it('accepts HTTPS connector base URL', () => {
    setConnectorEnv('https://openclaw.example.com/');
    expect(isOpenClawConnectorConfigured()).toBe(true);
  });

  it('accepts HTTP only for localhost', () => {
    setConnectorEnv('http://localhost:9000');
    expect(isOpenClawConnectorConfigured()).toBe(true);
  });

  it('requires OPENCLAW_CLI_PATH in gateway_cli mode', () => {
    process.env.OPENCLAW_CONNECTOR_MODE = 'gateway_cli';
    process.env.OPENCLAW_AGENT_ID = 'gateway-agent';
    delete process.env.OPENCLAW_CLI_PATH;

    expect(isOpenClawConnectorConfigured()).toBe(false);
  });

  it('accepts gateway_cli mode when both cli path and agent id are configured', () => {
    process.env.OPENCLAW_CONNECTOR_MODE = 'gateway_cli';
    process.env.OPENCLAW_CLI_PATH = '/usr/local/bin/openclaw';
    process.env.OPENCLAW_AGENT_ID = 'gateway-agent';

    expect(isOpenClawConnectorConfigured()).toBe(true);
  });

  it('rejects non-localhost HTTP base URL', () => {
    setConnectorEnv('http://openclaw.example.com');
    expect(isOpenClawConnectorConfigured()).toBe(false);
  });

  it('rejects invalid base URL', () => {
    setConnectorEnv('not-a-valid-url');
    expect(isOpenClawConnectorConfigured()).toBe(false);
  });

  it('returns secure setup guidance when insecure URL is configured', async () => {
    setConnectorEnv('http://openclaw.example.com');

    const result = await handoffToOpenClaw({
      requestId: 1,
      pharmacyId: 1,
      requestText: 'テスト要望',
    });

    expect(result.accepted).toBe(false);
    expect(result.connectorConfigured).toBe(false);
    expect(result.note).toContain('HTTPS');
  });

  it('sends handoff context payload when provided', async () => {
    setConnectorEnv('https://openclaw.example.com');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'in_dialogue',
        threadId: 'thread-abc',
        summary: 'connected',
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const context = {
      operationLogs: {
        importFailures: {
          total: 2,
        },
      },
    };

    const result = await handoffToOpenClaw({
      requestId: 55,
      pharmacyId: 9,
      requestText: '最近のログを見て自動で修正してください',
      context,
    });

    expect(result.accepted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const fetchCall = fetchMock.mock.calls[0];
    const requestInit = fetchCall[1] as RequestInit;
    const payload = JSON.parse(String(requestInit.body));
    expect(payload.context).toEqual(context);
    expect(payload.constraints.implementationBranch).toBe('review');
  });

  it('verifies OpenClaw webhook signature and timestamp', () => {
    process.env.OPENCLAW_WEBHOOK_SECRET = 'webhook-secret';
    process.env.OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS = '300';
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000);
    const rawBody = JSON.stringify({ requestId: 1, status: 'in_dialogue' });
    const signature = createWebhookSignature('webhook-secret', timestamp, rawBody);

    expect(verifyOpenClawWebhookSignature({
      receivedSignature: signature,
      receivedTimestamp: String(timestamp),
      rawBody,
      nowMs,
    })).toBe(true);
  });

  it('rejects OpenClaw webhook signature when request is too old', () => {
    process.env.OPENCLAW_WEBHOOK_SECRET = 'webhook-secret';
    process.env.OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS = '60';
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000) - 120;
    const rawBody = JSON.stringify({ requestId: 1, status: 'in_dialogue' });
    const signature = createWebhookSignature('webhook-secret', timestamp, rawBody);

    expect(verifyOpenClawWebhookSignature({
      receivedSignature: signature,
      receivedTimestamp: String(timestamp),
      rawBody,
      nowMs,
    })).toBe(false);
  });

  it('consumes and releases OpenClaw webhook replay key', () => {
    process.env.OPENCLAW_WEBHOOK_SECRET = 'webhook-secret';
    process.env.OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS = '300';
    const nowMs = Date.parse('2026-02-25T12:00:00.000Z');
    const timestamp = Math.floor(nowMs / 1000);
    const rawBody = JSON.stringify({ requestId: 1, status: 'in_dialogue' });
    const signature = createWebhookSignature('webhook-secret', timestamp, rawBody);

    expect(verifyOpenClawWebhookSignature({
      receivedSignature: signature,
      receivedTimestamp: String(timestamp),
      rawBody,
      nowMs,
    })).toBe(true);

    expect(verifyOpenClawWebhookSignature({
      receivedSignature: signature,
      receivedTimestamp: String(timestamp),
      rawBody,
      nowMs: nowMs + 5_000,
    })).toBe(true);

    expect(consumeOpenClawWebhookReplay({
      receivedSignature: signature,
      receivedTimestamp: String(timestamp),
      nowMs,
    })).toBe(true);
    expect(isOpenClawWebhookReplay({
      receivedSignature: signature,
      receivedTimestamp: String(timestamp),
      nowMs: nowMs + 1_000,
    })).toBe(true);

    expect(consumeOpenClawWebhookReplay({
      receivedSignature: signature,
      receivedTimestamp: String(timestamp),
      nowMs: nowMs + 5_000,
    })).toBe(false);

    releaseOpenClawWebhookReplay({
      receivedSignature: signature,
      receivedTimestamp: String(timestamp),
    });
    expect(isOpenClawWebhookReplay({
      receivedSignature: signature,
      receivedTimestamp: String(timestamp),
      nowMs: nowMs + 6_000,
    })).toBe(false);

    expect(consumeOpenClawWebhookReplay({
      receivedSignature: signature,
      receivedTimestamp: String(timestamp),
      nowMs: nowMs + 6_000,
    })).toBe(true);
  });
});
