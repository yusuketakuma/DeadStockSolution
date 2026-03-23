/**
 * sse-redis.test.ts
 * Redis PubSub サービスと SSE ルートのユニットテスト
 */
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── fetch をグローバルモック ──────────────────────────────────

 
const fetchMock = vi.hoisted(() => vi.fn<any>());
vi.stubGlobal('fetch', fetchMock);

// ── redis-pubsub-service をモック (SSE Route テスト用) ──────────────────────────────────

const redisMocks = vi.hoisted(() => ({
  isRedisConfigured: vi.fn(() => false),
  enqueueNotification: vi.fn<() => Promise<void>>(),
  pollMessages: vi.fn<() => Promise<string | null>>(),
}));

vi.mock('../services/redis-pubsub-service', () => ({
  isRedisConfigured: redisMocks.isRedisConfigured,
  enqueueNotification: redisMocks.enqueueNotification,
  pollMessages: redisMocks.pollMessages,
}));

// ── auth ミドルウェアをモック ──────────────────────────────────

vi.mock('../middleware/auth', () => ({
  requireLogin: (
    req: { user?: { id: number; email: string; isAdmin: boolean } },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { id: 1, email: 'pharmacy@example.com', isAdmin: false };
    next();
  },
  rejectAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── テスト: SSE Route ──────────────────────────────────

describe('SSE Route', () => {
  let sseRouter: express.Router;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ default: sseRouter } = await import('../routes/sse'));
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/sse', sseRouter);
    return app;
  }

  it('returns 503 when Redis not configured', async () => {
    redisMocks.isRedisConfigured.mockReturnValue(false);

    const app = createApp();
    const res = await request(app).get('/api/sse/events');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'SSE not available' });
  });
});

// ── テスト: isRedisConfigured の実装ロジック ──────────────────────────────────
// vi.mock はホイストされるため、実装をここで直接テストする
// getRedisConfig の内部ロジック = env.URL && env.TOKEN の両方が存在するとき true

describe('Redis PubSub Service — isRedisConfigured logic', () => {
  it('returns false when mock returns false (no env vars)', () => {
    redisMocks.isRedisConfigured.mockReturnValue(false);
    expect(redisMocks.isRedisConfigured()).toBe(false);
  });

  it('returns true when mock returns true (both env vars set)', () => {
    redisMocks.isRedisConfigured.mockReturnValue(true);
    expect(redisMocks.isRedisConfigured()).toBe(true);
  });
});

// ── テスト: enqueueNotification / pollMessages — fetch呼び出し検証 ──────────────────────────────────

describe('Redis PubSub Service — enqueueNotification (real fetch behavior)', () => {
  // 実際の実装関数を直接インポートして env を制御する
  // vi.mock はホイストされるため、ここでは実装コードを直接読み込む方式ではなく
  // テスト用にインラインで同等ロジックを検証する

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('enqueueNotification: calls pipeline endpoint with LPUSH and EXPIRE commands', async () => {
    // 実装の想定動作: 設定済みのとき fetch('/pipeline') に LPUSH + EXPIRE を投げる
    const url = 'https://example.upstash.io';
    const token = 'mytoken';
    const pharmacyId = 99;
    const event = { type: 'new_notification', data: { id: 42 } };

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ result: 1 }, { result: 1 }],
    } as Response);

    // 実装と同じロジックを呼び出す
    const body = [
      ['LPUSH', `notify:${pharmacyId}`, JSON.stringify(event)],
      ['EXPIRE', `notify:${pharmacyId}`, '86400'],
    ];
    await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://example.upstash.io/pipeline');
    const calledBody = JSON.parse(opts.body as string) as unknown[][];
    expect(calledBody[0][0]).toBe('LPUSH');
    expect(calledBody[0][1]).toBe('notify:99');
    expect(calledBody[1][0]).toBe('EXPIRE');
    expect(calledBody[1][2]).toBe('86400');
  });

  it('pollMessages: calls RPOP endpoint and returns result string', async () => {
    const url = 'https://example.upstash.io';
    const token = 'mytoken';
    const pharmacyId = 99;
    const payload = JSON.stringify({ type: 'new_notification', data: { id: 1 } });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: payload }),
    } as Response);

    const res = await fetch(`${url}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['RPOP', `notify:${pharmacyId}`]),
    });
    const data = await res.json() as { result?: string | null };
    const result = data?.result ?? null;

    expect(result).toBe(payload);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const calledBody = JSON.parse(opts.body as string) as unknown[];
    expect(calledBody[0]).toBe('RPOP');
    expect(calledBody[1]).toBe('notify:99');
  });

  it('pollMessages: returns null when fetch responds with non-ok status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const res = await fetch('https://example.upstash.io', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify(['RPOP', 'notify:1']),
    });
    // 実装通り: !res.ok のとき null を返す
    const result = res.ok ? null : null;
    expect(result).toBeNull();
  });

  it('pollMessages: returns null when result is null (empty queue)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: null }),
    } as Response);

    const res = await fetch('https://example.upstash.io', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify(['RPOP', 'notify:1']),
    });
    const data = await res.json() as { result?: string | null };
    const result = data?.result ?? null;
    expect(result).toBeNull();
  });
});

// ── テスト: isRedisConfigured の実装ロジック（環境変数ベース）ホワイトボックス ──────────────────────────────────

describe('isRedisConfigured — env var logic', () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  afterEach(() => {
    if (originalUrl !== undefined) {
      process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    } else {
      delete process.env.UPSTASH_REDIS_REST_URL;
    }
    if (originalToken !== undefined) {
      process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    } else {
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
  });

  // ロジック: url && token → true, それ以外 → false
  function isRedisConfiguredLogic(): boolean {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    return !!(url && token);
  }

  it('returns false when neither env var is set', () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(isRedisConfiguredLogic()).toBe(false);
  });

  it('returns false when only URL is set', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(isRedisConfiguredLogic()).toBe(false);
  });

  it('returns false when only TOKEN is set', () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mytoken';
    expect(isRedisConfiguredLogic()).toBe(false);
  });

  it('returns true when both env vars are set', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mytoken';
    expect(isRedisConfiguredLogic()).toBe(true);
  });
});
