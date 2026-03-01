import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MatchingRuleValidationError extends Error {}
  class MatchingRuleVersionConflictError extends Error {}

  return {
    getActiveMatchingRuleProfile: vi.fn(),
    updateActiveMatchingRuleProfile: vi.fn(),
    MatchingRuleValidationError,
    MatchingRuleVersionConflictError,
  };
});

vi.mock('../services/matching-rule-service', () => ({
  getActiveMatchingRuleProfile: mocks.getActiveMatchingRuleProfile,
  updateActiveMatchingRuleProfile: mocks.updateActiveMatchingRuleProfile,
  MatchingRuleValidationError: mocks.MatchingRuleValidationError,
  MatchingRuleVersionConflictError: mocks.MatchingRuleVersionConflictError,
}));

vi.mock('../routes/admin-write-limiter', () => ({
  adminWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import adminMatchingRulesRouter from '../routes/admin-matching-rules';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminMatchingRulesRouter);
  return app;
}

describe('admin matching rules routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveMatchingRuleProfile.mockResolvedValue({
      id: 1,
      profileName: 'default',
      isActive: true,
      version: 3,
      source: 'database',
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:00:00.000Z',
      nameMatchThreshold: 0.7,
      valueScoreMax: 55,
      valueScoreDivisor: 2500,
      balanceScoreMax: 20,
      balanceScoreDiffFactor: 1.5,
      distanceScoreMax: 15,
      distanceScoreDivisor: 8,
      distanceScoreFallback: 2,
      nearExpiryScoreMax: 10,
      nearExpiryItemFactor: 1.5,
      nearExpiryDays: 120,
      diversityScoreMax: 10,
      diversityItemFactor: 1.5,
      favoriteBonus: 15,
    });
  });

  it('GET /matching-rules/profile returns active profile', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/admin/matching-rules/profile');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: 1,
      profileName: 'default',
      version: 3,
      nameMatchThreshold: 0.7,
    }));
  });

  it('PUT /matching-rules/profile returns 400 when no update fields are provided', async () => {
    const app = createApp();

    const response = await request(app)
      .put('/api/admin/matching-rules/profile')
      .send({ expectedVersion: 3 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: '更新対象のスコア設定を1つ以上指定してください',
    });
    expect(mocks.updateActiveMatchingRuleProfile).not.toHaveBeenCalled();
  });

  it('PUT /matching-rules/profile updates profile when payload is valid', async () => {
    mocks.updateActiveMatchingRuleProfile.mockResolvedValue({
      id: 1,
      profileName: 'default',
      isActive: true,
      version: 4,
      source: 'database',
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T01:00:00.000Z',
      nameMatchThreshold: 0.8,
      valueScoreMax: 55,
      valueScoreDivisor: 2500,
      balanceScoreMax: 20,
      balanceScoreDiffFactor: 1.5,
      distanceScoreMax: 15,
      distanceScoreDivisor: 8,
      distanceScoreFallback: 2,
      nearExpiryScoreMax: 10,
      nearExpiryItemFactor: 1.5,
      nearExpiryDays: 120,
      diversityScoreMax: 10,
      diversityItemFactor: 1.5,
      favoriteBonus: 15,
    });

    const app = createApp();

    const response = await request(app)
      .put('/api/admin/matching-rules/profile')
      .send({ expectedVersion: 3, nameMatchThreshold: 0.8, distanceScoreFallback: 4 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      message: 'マッチングルールプロファイルを更新しました',
      data: expect.objectContaining({
        version: 4,
        nameMatchThreshold: 0.8,
      }),
    }));
    expect(mocks.updateActiveMatchingRuleProfile).toHaveBeenCalledWith({
      expectedVersion: 3,
      nameMatchThreshold: 0.8,
      distanceScoreFallback: 4,
    });
  });

  it('PUT /matching-rules/profile returns 409 on version conflict', async () => {
    mocks.updateActiveMatchingRuleProfile.mockRejectedValue(
      new mocks.MatchingRuleVersionConflictError('マッチングルールが更新済みです。再取得してから再実行してください'),
    );
    const app = createApp();

    const response = await request(app)
      .put('/api/admin/matching-rules/profile')
      .send({ expectedVersion: 1, nameMatchThreshold: 0.9 });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'マッチングルールが更新済みです。再取得してから再実行してください',
    });
  });
});
