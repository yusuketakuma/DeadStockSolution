import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listTrustScores: vi.fn(),
  triggerTrustScoreRecalculation: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/trust-score-service', () => ({
  listTrustScores: mocks.listTrustScores,
  triggerTrustScoreRecalculation: mocks.triggerTrustScoreRecalculation,
}));

import adminTrustRouter from '../routes/admin-trust';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminTrustRouter);
  return app;
}

describe('admin trust routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns trust scores with pagination', async () => {
    const app = createApp();
    mocks.listTrustScores.mockResolvedValue({
      data: [{ id: 1, name: 'A薬局', email: 'a@example.com', prefecture: '東京都', phone: '03', fax: '03', isActive: true, isAdmin: false, createdAt: null, trustScore: 60, ratingCount: 0, positiveRate: 0 }],
      total: 1,
    });

    const response = await request(app).get('/api/admin/pharmacies/trust').query({ page: 1, limit: 20 });

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('returns 202 for trust recalculation start and already-running states', async () => {
    const app = createApp();

    mocks.triggerTrustScoreRecalculation.mockReturnValueOnce({
      started: true,
      startedAt: '2026-03-01T00:00:00.000Z',
    });
    const started = await request(app).post('/api/admin/pharmacies/trust/recalculate');
    expect(started.status).toBe(202);
    expect(started.body).toEqual({
      message: '信頼スコア再計算を開始しました',
      started: true,
      startedAt: '2026-03-01T00:00:00.000Z',
    });

    mocks.triggerTrustScoreRecalculation.mockReturnValueOnce({
      started: false,
      startedAt: '2026-03-01T00:00:00.000Z',
    });
    const running = await request(app).post('/api/admin/pharmacies/trust/recalculate');
    expect(running.status).toBe(202);
    expect(running.body).toEqual({
      message: '信頼スコア再計算は既に実行中です',
      started: false,
      startedAt: '2026-03-01T00:00:00.000Z',
    });
  });
});
