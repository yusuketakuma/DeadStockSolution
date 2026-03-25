/**
 * push-routes.test.ts
 * TDD: プッシュ購読管理ルートのテスト
 * - GET /api/push/vapid-public-key — 認証不要
 * - POST /api/push/subscribe — 認証必要
 * - DELETE /api/push/subscribe — 認証必要
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  listSubscriptions: vi.fn(),
  cleanupStale: vi.fn(),
  requireLoginEnabled: { value: true },
  vapidPublicKey: { value: 'test-vapid-public-key' },
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (
    req: { user?: { id: number; email: string; isAdmin: boolean } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (!mocks.requireLoginEnabled.value) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }
    req.user = { id: 1, email: 'pharmacy@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../services/push-subscription-service', () => ({
  subscribe: mocks.subscribe,
  unsubscribe: mocks.unsubscribe,
  listSubscriptions: mocks.listSubscriptions,
  cleanupStale: mocks.cleanupStale,
}));

vi.mock('../config/database', () => ({
  db: {},
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/system-event-service', () => ({
  recordHttpUnhandledError: vi.fn(),
}));

let pushRouter: express.Router;

function createApp() {
  const app = express();
  app.use(express.json());
  // vapid-public-key は認証不要、subscribe/unsubscribe は認証必要
  app.use('/api/push', pushRouter);
  return app;
}

beforeEach(async () => {
  vi.resetModules();
  const { default: router } = await import('../routes/push');
  pushRouter = router;
});

const BASE_SUBSCRIPTION_RECORD = {
  id: 1,
  pharmacyId: 1,
  endpoint: 'https://push.example.com/sub1',
  p256dh: 'test-p256dh',
  auth: 'test-auth',
  userAgent: 'TestBrowser/1.0',
  createdAt: '2025-01-01T00:00:00.000Z',
  lastUsedAt: null,
};

describe('push routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireLoginEnabled.value = true;
    mocks.vapidPublicKey.value = 'test-vapid-public-key';
    vi.stubEnv('VAPID_PUBLIC_KEY', 'test-vapid-public-key');
  });

  // ── GET /api/push/vapid-public-key ──────────────────────────────────

  describe('GET /api/push/vapid-public-key', () => {
    it('200 — VAPID公開鍵を返す（認証不要）', async () => {
      mocks.requireLoginEnabled.value = false; // 認証不要でもアクセスできることを確認
      const app = createApp();

      const res = await request(app).get('/api/push/vapid-public-key');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ publicKey: 'test-vapid-public-key' });
    });

    it('200 — 認証済みユーザーでもアクセス可能', async () => {
      const app = createApp();

      const res = await request(app).get('/api/push/vapid-public-key');

      expect(res.status).toBe(200);
      expect(res.body.publicKey).toBe('test-vapid-public-key');
    });

    it('404 — VAPID_PUBLIC_KEY 未設定', async () => {
      vi.stubEnv('VAPID_PUBLIC_KEY', '');
      const app = createApp();

      const res = await request(app).get('/api/push/vapid-public-key');

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });
  });

  // ── POST /api/push/subscribe ──────────────────────────────────

  describe('POST /api/push/subscribe', () => {
    it('201 — 購読を登録', async () => {
      mocks.subscribe.mockResolvedValue(BASE_SUBSCRIPTION_RECORD);
      const app = createApp();

      const res = await request(app)
        .post('/api/push/subscribe')
        .send({
          endpoint: 'https://push.example.com/sub1',
          keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(1);
      expect(res.body.endpoint).toBe('https://push.example.com/sub1');
      expect(mocks.subscribe).toHaveBeenCalledWith(
        1,
        {
          endpoint: 'https://push.example.com/sub1',
          keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
        },
        expect.any(String), // userAgent
      );
    });

    it('400 — endpoint がない', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/push/subscribe')
        .send({ keys: { p256dh: 'test', auth: 'test' } });

      expect(res.status).toBe(400);
      expect(mocks.subscribe).not.toHaveBeenCalled();
    });

    it('400 — keys がない', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/push/subscribe')
        .send({ endpoint: 'https://push.example.com/sub1' });

      expect(res.status).toBe(400);
      expect(mocks.subscribe).not.toHaveBeenCalled();
    });

    it('400 — keys.p256dh がない', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/push/subscribe')
        .send({
          endpoint: 'https://push.example.com/sub1',
          keys: { auth: 'test' },
        });

      expect(res.status).toBe(400);
      expect(mocks.subscribe).not.toHaveBeenCalled();
    });

    it('400 — keys.auth がない', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/push/subscribe')
        .send({
          endpoint: 'https://push.example.com/sub1',
          keys: { p256dh: 'test' },
        });

      expect(res.status).toBe(400);
      expect(mocks.subscribe).not.toHaveBeenCalled();
    });

    it('401 — 未認証', async () => {
      mocks.requireLoginEnabled.value = false;
      const app = createApp();

      const res = await request(app)
        .post('/api/push/subscribe')
        .send({
          endpoint: 'https://push.example.com/sub1',
          keys: { p256dh: 'test', auth: 'test' },
        });

      expect(res.status).toBe(401);
      expect(mocks.subscribe).not.toHaveBeenCalled();
    });

    it('500 — サービスエラー', async () => {
      mocks.subscribe.mockRejectedValue(new Error('DB error'));
      const app = createApp();

      const res = await request(app)
        .post('/api/push/subscribe')
        .send({
          endpoint: 'https://push.example.com/sub1',
          keys: { p256dh: 'test', auth: 'test' },
        });

      expect(res.status).toBe(500);
    });
  });

  // ── DELETE /api/push/subscribe ──────────────────────────────────

  describe('DELETE /api/push/subscribe', () => {
    it('204 — 購読を解除', async () => {
      mocks.unsubscribe.mockResolvedValue(true);
      const app = createApp();

      const res = await request(app)
        .delete('/api/push/subscribe')
        .send({ endpoint: 'https://push.example.com/sub1' });

      expect(res.status).toBe(204);
      expect(mocks.unsubscribe).toHaveBeenCalledWith(1, 'https://push.example.com/sub1');
    });

    it('404 — 存在しない購読', async () => {
      mocks.unsubscribe.mockResolvedValue(false);
      const app = createApp();

      const res = await request(app)
        .delete('/api/push/subscribe')
        .send({ endpoint: 'https://push.example.com/nonexistent' });

      expect(res.status).toBe(404);
    });

    it('400 — endpoint がない', async () => {
      const app = createApp();

      const res = await request(app)
        .delete('/api/push/subscribe')
        .send({});

      expect(res.status).toBe(400);
      expect(mocks.unsubscribe).not.toHaveBeenCalled();
    });

    it('401 — 未認証', async () => {
      mocks.requireLoginEnabled.value = false;
      const app = createApp();

      const res = await request(app)
        .delete('/api/push/subscribe')
        .send({ endpoint: 'https://push.example.com/sub1' });

      expect(res.status).toBe(401);
      expect(mocks.unsubscribe).not.toHaveBeenCalled();
    });

    it('500 — サービスエラー', async () => {
      mocks.unsubscribe.mockRejectedValue(new Error('DB error'));
      const app = createApp();

      const res = await request(app)
        .delete('/api/push/subscribe')
        .send({ endpoint: 'https://push.example.com/sub1' });

      expect(res.status).toBe(500);
    });
  });
});
