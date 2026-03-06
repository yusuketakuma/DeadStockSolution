import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── モック設定（vi.hoisted でインポートより前に初期化） ──────────────────

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: { select: mocks.dbSelect },
}));

vi.mock('../services/observability-service', () => ({
  getObservabilitySnapshot: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  sql: vi.fn(),
}));

vi.mock('../utils/db-utils', () => ({
  rowCount: {},
}));

import { getMonitoringKpiSnapshot } from '../services/monitoring-kpi-service';
import { getObservabilitySnapshot } from '../services/observability-service';

// ── ヘルパー ──────────────────────────────────────────

function makeDefaultObservability(overrides: Partial<{
  errorRate5xx: number;
  windowMinutes: number;
}> = {}) {
  return {
    windowMinutes: 60,
    totalRequests: 100,
    totalErrors5xx: 2,
    errorRate5xx: 2,
    authFailures401: 0,
    forbidden403: 0,
    avgLatencyMs: 50,
    p95LatencyMs: 200,
    topSlowPaths: [],
    ...overrides,
  };
}

function setupDbCounts(failedCount: number, completedCount: number, pendingStaleCount: number) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockResolvedValue([{
    failed: failedCount,
    completed: completedCount,
    pendingStale: pendingStaleCount,
  }]);
  mocks.dbSelect.mockReturnValue(chain);
}

function expectSingleDbAggregateQuery(): void {
  expect(mocks.dbSelect).toHaveBeenCalledTimes(1);
  const chain = mocks.dbSelect.mock.results[0]?.value as {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
  };
  expect(chain.from).toHaveBeenCalledTimes(1);
  expect(chain.where).toHaveBeenCalledTimes(1);
}

describe('getMonitoringKpiSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getObservabilitySnapshot).mockReturnValue(makeDefaultObservability());
  });

  describe('uploadFailureRate 算出', () => {
    it('failed=2, completed=8 のとき uploadFailureRate = 20', async () => {
      setupDbCounts(2, 8, 0);
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.metrics.uploadFailureRate).toBe(20);
      expectSingleDbAggregateQuery();
    });

    it('failed=0, completed=0 のとき uploadFailureRate = 0（ゼロ除算ガード）', async () => {
      setupDbCounts(0, 0, 0);
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.metrics.uploadFailureRate).toBe(0);
    });

    it('failed=1, completed=3 のとき uploadFailureRate = 25', async () => {
      setupDbCounts(1, 3, 0);
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.metrics.uploadFailureRate).toBe(25);
    });

    it('小数点2桁で丸められる（failed=1, completed=6 → 14.29%）', async () => {
      setupDbCounts(1, 6, 0);
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.metrics.uploadFailureRate).toBe(14.29);
    });
  });

  describe('status 判定', () => {
    it('すべての指標が閾値未満のとき status = healthy', async () => {
      vi.mocked(getObservabilitySnapshot).mockReturnValue(makeDefaultObservability({ errorRate5xx: 1 }));
      setupDbCounts(0, 10, 0);
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.status).toBe('healthy');
    });

    it('errorRate5xx が閾値（2%）以上のとき status = warning', async () => {
      vi.mocked(getObservabilitySnapshot).mockReturnValue(makeDefaultObservability({ errorRate5xx: 5 }));
      setupDbCounts(0, 10, 0);
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.status).toBe('warning');
      expect(snapshot.breaches.errorRate5xx).toBe(true);
    });

    it('uploadFailureRate が閾値（10%）以上のとき status = warning', async () => {
      vi.mocked(getObservabilitySnapshot).mockReturnValue(makeDefaultObservability({ errorRate5xx: 0 }));
      setupDbCounts(2, 8, 0); // 20% ≥ 10%
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.status).toBe('warning');
      expect(snapshot.breaches.uploadFailureRate).toBe(true);
    });

    it('pendingStaleCount が閾値（5件）以上のとき status = warning', async () => {
      vi.mocked(getObservabilitySnapshot).mockReturnValue(makeDefaultObservability({ errorRate5xx: 0 }));
      setupDbCounts(0, 10, 5); // 5 ≥ 5
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.status).toBe('warning');
      expect(snapshot.breaches.pendingStaleCount).toBe(true);
    });

    it('複数の breach がある場合も status = warning', async () => {
      vi.mocked(getObservabilitySnapshot).mockReturnValue(makeDefaultObservability({ errorRate5xx: 10 }));
      setupDbCounts(5, 5, 10);
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.status).toBe('warning');
      expect(snapshot.breaches.errorRate5xx).toBe(true);
      expect(snapshot.breaches.uploadFailureRate).toBe(true);
      expect(snapshot.breaches.pendingStaleCount).toBe(true);
    });
  });

  describe('レスポンス構造', () => {
    it('必要なフィールドがすべて含まれる', async () => {
      setupDbCounts(0, 5, 0);
      const snapshot = await getMonitoringKpiSnapshot();

      expect(snapshot).toHaveProperty('status');
      expect(snapshot).toHaveProperty('metrics');
      expect(snapshot).toHaveProperty('thresholds');
      expect(snapshot).toHaveProperty('breaches');
      expect(snapshot).toHaveProperty('context');
      expect(snapshot.context.uploadWindowHours).toBe(24);
    });

    it('metrics.errorRate5xx が observability から取得される', async () => {
      vi.mocked(getObservabilitySnapshot).mockReturnValue(makeDefaultObservability({ errorRate5xx: 3.5 }));
      setupDbCounts(0, 10, 0);
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.metrics.errorRate5xx).toBe(3.5);
    });

    it('metrics.pendingUploadStaleCount が DB の pending stale カウントを反映する', async () => {
      setupDbCounts(0, 0, 7);
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.metrics.pendingUploadStaleCount).toBe(7);
    });

    it('context.windowMinutes が observability から取得される', async () => {
      vi.mocked(getObservabilitySnapshot).mockReturnValue(makeDefaultObservability({ windowMinutes: 30 }));
      setupDbCounts(0, 0, 0);
      const snapshot = await getMonitoringKpiSnapshot();
      expect(snapshot.context.windowMinutes).toBe(30);
    });

    it('DB 集約クエリを 1 回だけ実行する', async () => {
      setupDbCounts(3, 7, 2);
      await getMonitoringKpiSnapshot();
      expectSingleDbAggregateQuery();
    });
  });
});
