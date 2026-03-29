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
  'APP_BASE_URL',
  'VERCEL_URL',
  'OPENCLAW_IMPLEMENT_BRANCH',
  'OPENCLAW_TIMEOUT_MS',
  'OPENCLAW_RETRY_MAX',
  'OPENCLAW_RETRY_BASE_MS',
  'OPENCLAW_IDEMPOTENCY_TTL_MS',
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

  it('accepts HTTP for IPv6 localhost loopback', () => {
    setConnectorEnv('http://[::1]:9000');
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

  it('accepts managed_remote_agent mode without legacy connector fields', () => {
    process.env.OPENCLAW_CONNECTOR_MODE = 'managed_remote_agent';
    delete process.env.OPENCLAW_BASE_URL;
    delete process.env.OPENCLAW_API_KEY;
    delete process.env.OPENCLAW_AGENT_ID;

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
    expect(payload.task).toEqual(expect.objectContaining({
      sourceSystem: 'DeadStockSolution',
      source: 'user_request',
      taskKind: 'user_report',
      execution: expect.objectContaining({
        owner: 'openclaw',
        mode: 'task_managed',
        useTaskManager: true,
        useCodingWorkflow: true,
        openPullRequestWhenNeeded: true,
        implementationBranch: 'review',
      }),
    }));
  });

  it('includes callback command contract and follow-up thread metadata in task payload', async () => {
    setConnectorEnv('https://openclaw.example.com');
    process.env.APP_BASE_URL = 'https://dead-stock-solution.example.com';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'in_dialogue',
        threadId: 'thread-follow-up',
        summary: 'follow-up accepted',
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const context = {
      source: 'user_request_follow_up',
      threadId: 'thread-existing',
      followUp: {
        type: 'user_reply',
        messageId: 44,
        resumePolicy: 'continue_existing_case_without_reset',
      },
    };

    await handoffToOpenClaw({
      requestId: 56,
      pharmacyId: 10,
      requestText: '追加情報を受け取ったので続きから対応してください',
      context,
    });

    const fetchCall = fetchMock.mock.calls[0];
    const requestInit = fetchCall[1] as RequestInit;
    const payload = JSON.parse(String(requestInit.body));
    expect(payload.task.request.threadId).toBe('thread-existing');
    expect(payload.task.context.followUp).toEqual(context.followUp);
    expect(payload.task.callbacks).toEqual(expect.objectContaining({
      callbackUrl: 'https://dead-stock-solution.example.com/api/openclaw/callback',
      reportUrl: 'https://dead-stock-solution.example.com/api/openclaw/report',
      commandsUrl: 'https://dead-stock-solution.example.com/api/openclaw/commands',
      auth: 'openclaw_webhook_hmac',
    }));
  });


  it('retries legacy_http handoff on transient server error', async () => {
    setConnectorEnv('https://openclaw.example.com');
    process.env.OPENCLAW_RETRY_MAX = '1';
    process.env.OPENCLAW_RETRY_BASE_MS = '100';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'in_dialogue',
          threadId: 'thread-retry',
          summary: 'retried',
        }),
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await handoffToOpenClaw({
      requestId: 77,
      pharmacyId: 9,
      requestText: 'リトライ確認',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.accepted).toBe(true);
    expect(result.threadId).toBe('thread-retry');
  });

  it('deduplicates in-flight handoff calls by idempotency key', async () => {
    setConnectorEnv('https://openclaw.example.com');
    process.env.OPENCLAW_RETRY_MAX = '0';

    let resolveFetch: ((value: unknown) => void) | undefined;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    const fetchMock = vi.fn().mockReturnValue(fetchPromise);
    global.fetch = fetchMock as unknown as typeof fetch;

    const payload = {
      requestId: 88,
      pharmacyId: 9,
      requestText: '同時呼び出しテスト',
    };

    const first = handoffToOpenClaw(payload);
    const second = handoffToOpenClaw(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'in_dialogue',
        threadId: 'thread-dedupe',
        summary: 'ok',
      }),
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.threadId).toBe('thread-dedupe');
    expect(secondResult.threadId).toBe('thread-dedupe');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns cached handoff result for duplicate sequential calls', async () => {
    setConnectorEnv('https://openclaw.example.com');
    process.env.OPENCLAW_RETRY_MAX = '0';
    process.env.OPENCLAW_IDEMPOTENCY_TTL_MS = '60000';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'in_dialogue',
        threadId: 'thread-cache',
        summary: 'cached',
      }),
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const payload = {
      requestId: 99,
      pharmacyId: 3,
      requestText: 'キャッシュ確認',
    };

    const firstResult = await handoffToOpenClaw(payload);
    const secondResult = await handoffToOpenClaw(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResult.threadId).toBe('thread-cache');
    expect(secondResult.threadId).toBe('thread-cache');
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
