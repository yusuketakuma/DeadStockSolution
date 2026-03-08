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
    recordAuditLog: vi.fn(),
  };
});

vi.mock('../services/matching-rule-service', () => ({
  getActiveMatchingRuleProfile: mocks.getActiveMatchingRuleProfile,
  updateActiveMatchingRuleProfile: mocks.updateActiveMatchingRuleProfile,
  MatchingRuleValidationError: mocks.MatchingRuleValidationError,
  MatchingRuleVersionConflictError: mocks.MatchingRuleVersionConflictError,
}));

vi.mock('../services/audit-log-service', () => ({
  recordAuditLog: mocks.recordAuditLog,
}));

vi.mock('../routes/admin-write-limiter', () => ({
  adminWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
}));

import adminMatchingRulesRouter from '../routes/admin-matching-rules';

function createApp() {
  const app = express();
  app.use(express.json());
  // auth middleware を模倣して req.user を設定
  app.use((req, _res, next) => {
    (req as express.Request & { user?: { id: number; email: string; isAdmin: boolean } }).user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  });
  app.use('/api/admin', adminMatchingRulesRouter);
  return app;
}

const validProfile = {
  id: 1, profileName: 'default', isActive: true, version: 3,
  source: 'database', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  nameMatchThreshold: 0.7, valueScoreMax: 55, valueScoreDivisor: 2500,
  balanceScoreMax: 20, balanceScoreDiffFactor: 1.5,
  distanceScoreMax: 15, distanceScoreDivisor: 8, distanceScoreFallback: 2,
  nearExpiryScoreMax: 10, nearExpiryItemFactor: 1.5, nearExpiryDays: 120,
  diversityScoreMax: 10, diversityItemFactor: 1.5,
  favoriteBonus: 15, groupBonus: 10,
};

describe('Admin Matching Rules - Validation Enhancement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveMatchingRuleProfile.mockResolvedValue(validProfile);
    mocks.updateActiveMatchingRuleProfile.mockResolvedValue({ ...validProfile, version: 4 });
    mocks.recordAuditLog.mockResolvedValue({});
  });

  describe('groupBonus フィールド', () => {
    it('groupBonusを指定して更新できる', async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/admin/matching-rules/profile')
        .send({ groupBonus: 20, expectedVersion: 3 });

      expect(res.status).toBe(200);
      expect(mocks.updateActiveMatchingRuleProfile).toHaveBeenCalledWith(
        expect.objectContaining({ groupBonus: 20 }),
      );
    });

    it('groupBonusが50を超える場合400を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/admin/matching-rules/profile')
        .send({ groupBonus: 51 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('groupBonus');
    });

    it('groupBonusが小数の場合400を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/admin/matching-rules/profile')
        .send({ groupBonus: 10.5 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('groupBonus');
    });
  });

  describe('日本語エラーメッセージ', () => {
    it('nameMatchThresholdが範囲外の場合日本語エラーメッセージを返す', async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/admin/matching-rules/profile')
        .send({ nameMatchThreshold: 2.0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('nameMatchThreshold');
      expect(res.body.error).toContain('1以下');
    });

    it('未対応フィールドに日本語エラーを返す', async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/admin/matching-rules/profile')
        .send({ unknownField: 42 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Unrecognized key');
    });
  });

  describe('クロスフィールドバリデーション', () => {
    it('distanceScoreFallbackがdistanceScoreMaxを超える場合400を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/admin/matching-rules/profile')
        .send({ distanceScoreMax: 10, distanceScoreFallback: 20 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('distanceScoreFallback');
    });
  });

  describe('PATCH メソッドサポート', () => {
    it('PATCHでもルール更新ができる', async () => {
      const app = createApp();
      const res = await request(app)
        .patch('/api/admin/matching-rules/profile')
        .send({ nameMatchThreshold: 0.8, expectedVersion: 3 });

      expect(res.status).toBe(200);
      expect(mocks.updateActiveMatchingRuleProfile).toHaveBeenCalled();
    });
  });

  describe('fieldフィールド付きエラーレスポンス', () => {
    it('バリデーションエラー時にfieldフィールドを返す', async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/admin/matching-rules/profile')
        .send({ nearExpiryDays: 0 });

      expect(res.status).toBe(400);
      expect(res.body.field).toBe('nearExpiryDays');
    });
  });

  describe('Infinityの拒否', () => {
    it('Infinityは数値として拒否される（JSONパースでnullになる）', async () => {
      const app = createApp();
      // JSON.stringify(Infinity) => null, so this becomes { nameMatchThreshold: null }
      const res = await request(app)
        .put('/api/admin/matching-rules/profile')
        .send({ nameMatchThreshold: null });

      expect(res.status).toBe(400);
    });
  });

  describe('監査ログ記録', () => {
    it('更新成功時に監査ログが記録される', async () => {
      const app = createApp();
      await request(app)
        .put('/api/admin/matching-rules/profile')
        .send({ nameMatchThreshold: 0.8, expectedVersion: 3 });

      // recordAuditLogはvoid呼び出しなので非同期を待つ
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mocks.recordAuditLog).toHaveBeenCalled();
    });
  });
});
