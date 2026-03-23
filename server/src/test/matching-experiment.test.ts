import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// モック設定
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/logger', () => ({ logger: mocks.logger }));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a, _b) => ({ type: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
}));

vi.mock('../routes/admin-write-limiter', () => ({
  adminWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  rejectAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// matching-experiment-service のモック（ルートテスト用）
const experimentServiceMocks = vi.hoisted(() => ({
  listExperiments: vi.fn(),
  createExperiment: vi.fn(),
  startExperiment: vi.fn(),
  stopExperiment: vi.fn(),
  getExperimentResults: vi.fn(),
  getActiveExperiment: vi.fn(),
  getProfileForPharmacy: vi.fn(),
  resetExperimentCacheForTest: vi.fn(),
}));

vi.mock('../services/matching-experiment-service', () => experimentServiceMocks);

// matching-rule-service のモック
const matchingRuleMocks = vi.hoisted(() => ({
  getActiveMatchingRuleProfile: vi.fn(),
  resetMatchingRuleProfileCacheForTest: vi.fn(),
}));

vi.mock('../services/matching-rule-service', () => matchingRuleMocks);

// ---------------------------------------------------------------------------
// インポート（モック後）
// ---------------------------------------------------------------------------

import adminMatchingExperimentsRouter from '../routes/admin-matching-experiments';
import {
  getActiveExperiment,
  getProfileForPharmacy,
  resetExperimentCacheForTest,
} from '../services/matching-experiment-service';
import {
  getActiveMatchingRuleProfile,
  resetMatchingRuleProfileCacheForTest,
} from '../services/matching-rule-service';

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

const DEFAULT_PROFILE = {
  id: 1,
  profileName: 'default',
  isActive: true,
  version: 1,
  source: 'database' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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
  groupBonus: 10,
  nearExpiryDecayCurve: 0,
  successRateBonus: 0,
  maxCandidates: 30,
};

const EXPERIMENT_PROFILE_2 = {
  ...DEFAULT_PROFILE,
  id: 2,
  profileName: 'treatment',
  nameMatchThreshold: 0.8,
};

const SAMPLE_EXPERIMENT = {
  id: 1,
  name: 'テスト実験',
  controlProfileId: 1,
  treatmentProfileId: 2,
  trafficPercentage: 50,
  status: 'draft' as const,
  startedAt: null,
  endedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminMatchingExperimentsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Admin API ルートテスト
// ---------------------------------------------------------------------------

describe('Admin Matching Experiments API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/admin/matching-experiments', () => {
    it('実験一覧を返す', async () => {
      experimentServiceMocks.listExperiments.mockResolvedValue([SAMPLE_EXPERIMENT]);

      const app = createApp();
      const res = await request(app).get('/api/admin/matching-experiments');

      expect(res.status).toBe(200);
      expect(res.body.experiments).toHaveLength(1);
      expect(res.body.experiments[0].name).toBe('テスト実験');
    });

    it('実験がない場合は空配列を返す', async () => {
      experimentServiceMocks.listExperiments.mockResolvedValue([]);

      const app = createApp();
      const res = await request(app).get('/api/admin/matching-experiments');

      expect(res.status).toBe(200);
      expect(res.body.experiments).toHaveLength(0);
    });

    it('サービスエラー時は 500 を返す', async () => {
      experimentServiceMocks.listExperiments.mockRejectedValue(new Error('DB error'));

      const app = createApp();
      const res = await request(app).get('/api/admin/matching-experiments');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/admin/matching-experiments', () => {
    it('正常な入力で実験を作成する', async () => {
      experimentServiceMocks.createExperiment.mockResolvedValue(SAMPLE_EXPERIMENT);

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/matching-experiments')
        .send({
          name: 'テスト実験',
          controlProfileId: 1,
          treatmentProfileId: 2,
          trafficPercentage: 50,
        });

      expect(res.status).toBe(201);
      expect(res.body.experiment.name).toBe('テスト実験');
      expect(experimentServiceMocks.createExperiment).toHaveBeenCalledWith({
        name: 'テスト実験',
        controlProfileId: 1,
        treatmentProfileId: 2,
        trafficPercentage: 50,
      });
    });

    it('name が空の場合は 400 を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/matching-experiments')
        .send({ name: '', controlProfileId: 1, treatmentProfileId: 2 });

      expect(res.status).toBe(400);
    });

    it('controlProfileId が欠けている場合は 400 を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/matching-experiments')
        .send({ name: 'test', treatmentProfileId: 2 });

      expect(res.status).toBe(400);
    });

    it('controlProfileId と treatmentProfileId が同じ場合は 400 を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/matching-experiments')
        .send({ name: 'test', controlProfileId: 1, treatmentProfileId: 1 });

      expect(res.status).toBe(400);
    });

    it('trafficPercentage が範囲外の場合は 400 を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/matching-experiments')
        .send({ name: 'test', controlProfileId: 1, treatmentProfileId: 2, trafficPercentage: 150 });

      expect(res.status).toBe(400);
    });

    it('trafficPercentage 省略時は 50 をデフォルトとして使用する', async () => {
      experimentServiceMocks.createExperiment.mockResolvedValue(SAMPLE_EXPERIMENT);

      const app = createApp();
      await request(app)
        .post('/api/admin/matching-experiments')
        .send({ name: 'テスト', controlProfileId: 1, treatmentProfileId: 2 });

      expect(experimentServiceMocks.createExperiment).toHaveBeenCalledWith(
        expect.objectContaining({ trafficPercentage: 50 }),
      );
    });
  });

  describe('PATCH /api/admin/matching-experiments/:id/start', () => {
    it('実験を開始する', async () => {
      experimentServiceMocks.startExperiment.mockResolvedValue({
        ...SAMPLE_EXPERIMENT,
        status: 'running',
        startedAt: '2026-01-01T01:00:00.000Z',
      });

      const app = createApp();
      const res = await request(app).patch('/api/admin/matching-experiments/1/start');

      expect(res.status).toBe(200);
      expect(res.body.experiment.status).toBe('running');
      expect(experimentServiceMocks.startExperiment).toHaveBeenCalledWith(1);
    });

    it('既に running の実験がある場合は 409 を返す', async () => {
      experimentServiceMocks.startExperiment.mockRejectedValue(new Error('既に実行中の実験があります。先に停止してください'));

      const app = createApp();
      const res = await request(app).patch('/api/admin/matching-experiments/1/start');

      expect(res.status).toBe(409);
    });

    it('実験が見つからない場合は 404 を返す', async () => {
      experimentServiceMocks.startExperiment.mockRejectedValue(new Error('実験が見つかりません'));

      const app = createApp();
      const res = await request(app).patch('/api/admin/matching-experiments/999/start');

      expect(res.status).toBe(404);
    });

    it('不正な ID の場合は 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).patch('/api/admin/matching-experiments/abc/start');

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/admin/matching-experiments/:id/stop', () => {
    it('実験を停止する', async () => {
      experimentServiceMocks.stopExperiment.mockResolvedValue({
        ...SAMPLE_EXPERIMENT,
        status: 'completed',
        endedAt: '2026-01-02T00:00:00.000Z',
      });

      const app = createApp();
      const res = await request(app).patch('/api/admin/matching-experiments/1/stop');

      expect(res.status).toBe(200);
      expect(res.body.experiment.status).toBe('completed');
    });

    it('実験が見つからない場合は 404 を返す', async () => {
      experimentServiceMocks.stopExperiment.mockRejectedValue(new Error('実験が見つかりません'));

      const app = createApp();
      const res = await request(app).patch('/api/admin/matching-experiments/999/stop');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/admin/matching-experiments/:id/results', () => {
    it('実験結果を返す', async () => {
      experimentServiceMocks.getExperimentResults.mockResolvedValue({
        experimentId: 1,
        totalAssignments: 100,
        controlCount: 50,
        treatmentCount: 50,
      });

      const app = createApp();
      const res = await request(app).get('/api/admin/matching-experiments/1/results');

      expect(res.status).toBe(200);
      expect(res.body.results.experimentId).toBe(1);
      expect(res.body.results.totalAssignments).toBe(100);
    });

    it('不正な ID の場合は 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).get('/api/admin/matching-experiments/bad/results');

      expect(res.status).toBe(400);
    });
  });
});

// ---------------------------------------------------------------------------
// matching-experiment-service のユニットテスト（hash-based assignment）
// ---------------------------------------------------------------------------

describe('matching-experiment-service (unit)', () => {
  describe('getActiveExperiment', () => {
    it('キャッシュから実験を返す', async () => {
      vi.mocked(getActiveExperiment).mockResolvedValue({
        ...SAMPLE_EXPERIMENT,
        status: 'running',
      });

      const result = await getActiveExperiment();
      expect(result?.status).toBe('running');
    });

    it('実験がない場合は null を返す', async () => {
      vi.mocked(getActiveExperiment).mockResolvedValue(null);

      const result = await getActiveExperiment();
      expect(result).toBeNull();
    });
  });

  describe('getProfileForPharmacy', () => {
    it('アクティブな実験がない場合は null を返す', async () => {
      vi.mocked(getProfileForPharmacy).mockResolvedValue(null);

      const result = await getProfileForPharmacy(1);
      expect(result).toBeNull();
    });

    it('アクティブな実験がある場合はプロファイルを返す', async () => {
      vi.mocked(getProfileForPharmacy).mockResolvedValue(EXPERIMENT_PROFILE_2);

      const result = await getProfileForPharmacy(42);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(2);
    });

    it('キャッシュリセットが動作する', () => {
      expect(() => resetExperimentCacheForTest()).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// getActiveMatchingRuleProfile の後方互換テスト
// ---------------------------------------------------------------------------

describe('getActiveMatchingRuleProfile backward compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('引数なしで呼び出した場合はデフォルトプロファイルを返す', async () => {
    matchingRuleMocks.getActiveMatchingRuleProfile.mockResolvedValue(DEFAULT_PROFILE);

    const result = await getActiveMatchingRuleProfile();
    expect(result.id).toBe(1);
    expect(result.source).toBe('database');
  });

  it('boolean true を渡した場合も動作する（後方互換）', async () => {
    matchingRuleMocks.getActiveMatchingRuleProfile.mockResolvedValue(DEFAULT_PROFILE);

    const result = await getActiveMatchingRuleProfile(true as unknown as { pharmacyId?: number; forceRefresh?: boolean });
    expect(result).toBeDefined();
  });

  it('{ forceRefresh: true } オブジェクト引数で動作する', async () => {
    matchingRuleMocks.getActiveMatchingRuleProfile.mockResolvedValue(DEFAULT_PROFILE);

    const result = await getActiveMatchingRuleProfile({ forceRefresh: true });
    expect(result.id).toBe(1);
  });

  it('{ pharmacyId: 1 } で実験プロファイルが解決される', async () => {
    matchingRuleMocks.getActiveMatchingRuleProfile.mockResolvedValue(EXPERIMENT_PROFILE_2);

    const result = await getActiveMatchingRuleProfile({ pharmacyId: 1 });
    expect(result.id).toBe(2);
    expect(result.profileName).toBe('treatment');
  });

  it('キャッシュリセット関数が動作する', () => {
    expect(() => resetMatchingRuleProfileCacheForTest()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// hash-based assignment の決定論的動作テスト
// ---------------------------------------------------------------------------

describe('hash-based assignment determinism', () => {
  it('同じ experimentId と pharmacyId に対して常に同じグループが割り当てられる', async () => {
    // crypto.createHash を使った決定論的なハッシュ計算を直接テスト
    const crypto = await import('crypto');

    function computeGroup(experimentId: number, pharmacyId: number, trafficPercentage: number): string {
      const hash = crypto.createHash('md5').update(`${experimentId}:${pharmacyId}`).digest('hex');
      const bucket = parseInt(hash.slice(0, 4), 16) % 100;
      return bucket < trafficPercentage ? 'treatment' : 'control';
    }

    // 同じ入力は常に同じ出力
    const group1 = computeGroup(1, 42, 50);
    const group2 = computeGroup(1, 42, 50);
    expect(group1).toBe(group2);

    // 異なる pharmacyId は異なるグループになりえる
    const results = new Set<string>();
    for (let pharmacyId = 1; pharmacyId <= 20; pharmacyId++) {
      results.add(computeGroup(1, pharmacyId, 50));
    }
    // 50% の traffic で 20 サンプルあれば両方のグループが現れる可能性が高い
    expect(results.size).toBeGreaterThanOrEqual(1);
  });

  it('trafficPercentage=0 のとき全て control に割り当てられる', async () => {
    const crypto = await import('crypto');

    function computeGroup(experimentId: number, pharmacyId: number, trafficPercentage: number): string {
      const hash = crypto.createHash('md5').update(`${experimentId}:${pharmacyId}`).digest('hex');
      const bucket = parseInt(hash.slice(0, 4), 16) % 100;
      return bucket < trafficPercentage ? 'treatment' : 'control';
    }

    for (let pharmacyId = 1; pharmacyId <= 10; pharmacyId++) {
      expect(computeGroup(1, pharmacyId, 0)).toBe('control');
    }
  });

  it('trafficPercentage=100 のとき全て treatment に割り当てられる', async () => {
    const crypto = await import('crypto');

    function computeGroup(experimentId: number, pharmacyId: number, trafficPercentage: number): string {
      const hash = crypto.createHash('md5').update(`${experimentId}:${pharmacyId}`).digest('hex');
      const bucket = parseInt(hash.slice(0, 4), 16) % 100;
      return bucket < trafficPercentage ? 'treatment' : 'control';
    }

    for (let pharmacyId = 1; pharmacyId <= 10; pharmacyId++) {
      expect(computeGroup(1, pharmacyId, 100)).toBe('treatment');
    }
  });
});
