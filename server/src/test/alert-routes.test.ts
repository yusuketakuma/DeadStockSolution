import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  getAlertDetail: vi.fn(),
  resolveAlert: vi.fn(),
  getAlertStats: vi.fn(),
  requireLoginEnabled: { value: true },
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

vi.mock('../services/alert-read-service', () => ({
  listAlerts: mocks.listAlerts,
  getAlertDetail: mocks.getAlertDetail,
  resolveAlert: mocks.resolveAlert,
  getAlertStats: mocks.getAlertStats,
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

import { requireLogin } from '../middleware/auth';
import alertsRouter from '../routes/alerts';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/alerts', requireLogin as unknown as express.RequestHandler, alertsRouter);
  return app;
}

const BASE_ALERT_ITEM = {
  id: 1,
  pharmacyId: 1,
  alertType: 'near_expiry',
  title: '期限間近アラート',
  message: '5件',
  detailJson: { items: [] },
  detectedAt: '2025-01-01T00:00:00.000Z',
  resolvedAt: null,
  notificationId: null,
};

describe('alert routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireLoginEnabled.value = true;
  });

  // ── GET /api/alerts ──────────────────────────────────

  describe('GET /api/alerts', () => {
    it('200 — アラート一覧を返す', async () => {
      const listResult = {
        alerts: [BASE_ALERT_ITEM],
        total: 1,
        offset: 0,
        limit: 20,
        unresolvedCount: 1,
      };
      mocks.listAlerts.mockResolvedValue(listResult);
      const app = createApp();

      const res = await request(app).get('/api/alerts');

      expect(res.status).toBe(200);
      expect(res.body.alerts).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(mocks.listAlerts).toHaveBeenCalledWith(1, {
        resolved: undefined,
        type: undefined,
        offset: 0,
        limit: 20,
      });
    });

    it('200 — resolved=false フィルタ', async () => {
      mocks.listAlerts.mockResolvedValue({ alerts: [], total: 0, offset: 0, limit: 20, unresolvedCount: 0 });
      const app = createApp();

      await request(app).get('/api/alerts?resolved=false');

      expect(mocks.listAlerts).toHaveBeenCalledWith(1, {
        resolved: false,
        type: undefined,
        offset: 0,
        limit: 20,
      });
    });

    it('200 — resolved=true フィルタ', async () => {
      mocks.listAlerts.mockResolvedValue({ alerts: [], total: 0, offset: 0, limit: 20, unresolvedCount: 0 });
      const app = createApp();

      await request(app).get('/api/alerts?resolved=true');

      expect(mocks.listAlerts).toHaveBeenCalledWith(1, {
        resolved: true,
        type: undefined,
        offset: 0,
        limit: 20,
      });
    });

    it('200 — type フィルタ', async () => {
      mocks.listAlerts.mockResolvedValue({ alerts: [], total: 0, offset: 0, limit: 20, unresolvedCount: 0 });
      const app = createApp();

      await request(app).get('/api/alerts?type=near_expiry');

      expect(mocks.listAlerts).toHaveBeenCalledWith(1, {
        resolved: undefined,
        type: 'near_expiry',
        offset: 0,
        limit: 20,
      });
    });

    it('200 — offset/limit パラメータ', async () => {
      mocks.listAlerts.mockResolvedValue({ alerts: [], total: 0, offset: 10, limit: 5, unresolvedCount: 0 });
      const app = createApp();

      await request(app).get('/api/alerts?offset=10&limit=5');

      expect(mocks.listAlerts).toHaveBeenCalledWith(1, {
        resolved: undefined,
        type: undefined,
        offset: 10,
        limit: 5,
      });
    });

    it('400 — 不正な type', async () => {
      const app = createApp();

      const res = await request(app).get('/api/alerts?type=invalid_type');

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('500 — サービスエラー', async () => {
      mocks.listAlerts.mockRejectedValue(new Error('DB error'));
      const app = createApp();

      const res = await request(app).get('/api/alerts');

      expect(res.status).toBe(500);
    });

    it('401 — 未認証', async () => {
      mocks.requireLoginEnabled.value = false;
      const app = createApp();

      const res = await request(app).get('/api/alerts');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/alerts/stats ──────────────────────────────────

  describe('GET /api/alerts/stats', () => {
    it('200 — 統計情報を返す', async () => {
      const stats = { unresolvedCount: 5, byType: { near_expiry: 3, excess_stock: 2 } };
      mocks.getAlertStats.mockResolvedValue(stats);
      const app = createApp();

      const res = await request(app).get('/api/alerts/stats');

      expect(res.status).toBe(200);
      expect(res.body.unresolvedCount).toBe(5);
      expect(res.body.byType).toEqual({ near_expiry: 3, excess_stock: 2 });
      expect(mocks.getAlertStats).toHaveBeenCalledWith(1);
    });

    it('500 — サービスエラー', async () => {
      mocks.getAlertStats.mockRejectedValue(new Error('DB error'));
      const app = createApp();

      const res = await request(app).get('/api/alerts/stats');

      expect(res.status).toBe(500);
    });
  });

  // ── GET /api/alerts/:id ──────────────────────────────────

  describe('GET /api/alerts/:id', () => {
    it('200 — アラート詳細を返す', async () => {
      mocks.getAlertDetail.mockResolvedValue(BASE_ALERT_ITEM);
      const app = createApp();

      const res = await request(app).get('/api/alerts/1');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1);
      expect(res.body.detailJson).toEqual({ items: [] });
      expect(mocks.getAlertDetail).toHaveBeenCalledWith(1, 1);
    });

    it('404 — 存在しないアラート', async () => {
      mocks.getAlertDetail.mockResolvedValue(null);
      const app = createApp();

      const res = await request(app).get('/api/alerts/999');

      expect(res.status).toBe(404);
    });

    it('400 — 不正なID', async () => {
      const app = createApp();

      const res = await request(app).get('/api/alerts/abc');

      expect(res.status).toBe(400);
    });

    it('500 — サービスエラー', async () => {
      mocks.getAlertDetail.mockRejectedValue(new Error('DB error'));
      const app = createApp();

      const res = await request(app).get('/api/alerts/1');

      expect(res.status).toBe(500);
    });
  });

  // ── PATCH /api/alerts/:id/resolve ──────────────────────────────────

  describe('PATCH /api/alerts/:id/resolve', () => {
    it('200 — アラートを解決済みにする', async () => {
      const resolved = { ...BASE_ALERT_ITEM, resolvedAt: '2025-03-01T00:00:00.000Z' };
      mocks.resolveAlert.mockResolvedValue(resolved);
      const app = createApp();

      const res = await request(app).patch('/api/alerts/1/resolve');

      expect(res.status).toBe(200);
      expect(res.body.resolvedAt).toBe('2025-03-01T00:00:00.000Z');
      expect(mocks.resolveAlert).toHaveBeenCalledWith(1, 1);
    });

    it('404 — 存在しないアラート', async () => {
      mocks.resolveAlert.mockResolvedValue(null);
      const app = createApp();

      const res = await request(app).patch('/api/alerts/999/resolve');

      expect(res.status).toBe(404);
    });

    it('400 — 不正なID', async () => {
      const app = createApp();

      const res = await request(app).patch('/api/alerts/abc/resolve');

      expect(res.status).toBe(400);
    });

    it('500 — サービスエラー', async () => {
      mocks.resolveAlert.mockRejectedValue(new Error('DB error'));
      const app = createApp();

      const res = await request(app).patch('/api/alerts/1/resolve');

      expect(res.status).toBe(500);
    });
  });
});
