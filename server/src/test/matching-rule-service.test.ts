import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/logger', () => ({ logger: mocks.logger }));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
}));

import {
  getActiveMatchingRuleProfile,
  updateActiveMatchingRuleProfile,
  resetMatchingRuleProfileCacheForTest,
  MatchingRuleValidationError,
  MatchingRuleVersionConflictError,
} from '../services/matching-rule-service';
import { DEFAULT_MATCHING_SCORING_RULES } from '../services/matching-score-service';

// ---- ヘルパー ----------------------------------------------------------------

function makeSelectChain(result: unknown[]) {
  const limit = vi.fn().mockResolvedValue(result);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where, orderBy, limit }) };
}

/** DB からの有効な matchingRuleProfiles 行モック */
function makeProfileRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    profileName: 'default',
    isActive: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...DEFAULT_MATCHING_SCORING_RULES,
    ...overrides,
  };
}

// ---- テスト ------------------------------------------------------------------

describe('matching-rule-service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetMatchingRuleProfileCacheForTest();
  });

  // ── getActiveMatchingRuleProfile ──────────────────────────────────────────

  describe('getActiveMatchingRuleProfile', () => {
    it('DB にアクティブプロファイルがある場合それを返す', async () => {
      const row = makeProfileRow();
      mocks.db.select.mockReturnValueOnce(makeSelectChain([row]));

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('database');
      expect(profile.id).toBe(1);
      expect(profile.nameMatchThreshold).toBe(DEFAULT_MATCHING_SCORING_RULES.nameMatchThreshold);
    });

    it('DB に行がない場合デフォルト行を INSERT して再取得する', async () => {
      const row = makeProfileRow();
      const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockReturnValue({ onConflictDoNothing });
      mocks.db.insert.mockReturnValue({ values });

      // 1回目: アクティブ行なし、2回目: INSERT後にアクティブ行あり
      mocks.db.select
        .mockReturnValueOnce(makeSelectChain([]))   // ensureActiveProfileRow: 最初の select
        .mockReturnValueOnce(makeSelectChain([row])); // INSERT後の select

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('database');
      expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    });

    it('DB エラー時はデフォルトフォールバックを返す', async () => {
      mocks.db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('connection error')),
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('connection error')),
          }),
          limit: vi.fn().mockRejectedValue(new Error('connection error')),
        }),
      });

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('default_fallback');
      expect(profile.id).toBe(0);
      expect(mocks.logger.error).toHaveBeenCalledTimes(1);
    });

    it('テーブルが存在しない場合（42P01）warn を記録してフォールバックを返す', async () => {
      const tableError = Object.assign(new Error('table not found'), { code: '42P01' });
      mocks.db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(tableError),
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(tableError),
          }),
          limit: vi.fn().mockRejectedValue(tableError),
        }),
      });

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('default_fallback');
      expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
      expect(mocks.logger.error).not.toHaveBeenCalled();
    });

    it('TTL 内の 2回目呼び出しはキャッシュを返す', async () => {
      const row = makeProfileRow();
      mocks.db.select.mockReturnValueOnce(makeSelectChain([row]));

      await getActiveMatchingRuleProfile();
      await getActiveMatchingRuleProfile();

      // DB.select は最初の 1回だけ呼ばれる（キャッシュヒット）
      expect(mocks.db.select).toHaveBeenCalledTimes(1);
    });

    it('forceRefresh=true のとき強制的に DB を再読み込みする', async () => {
      const row = makeProfileRow();
      mocks.db.select
        .mockReturnValueOnce(makeSelectChain([row]))
        .mockReturnValueOnce(makeSelectChain([row]));

      await getActiveMatchingRuleProfile(false);
      await getActiveMatchingRuleProfile(true);

      // 2回 DB が呼ばれる
      expect(mocks.db.select).toHaveBeenCalledTimes(2);
    });

    it('フォールバックプロファイルはデフォルトスコアルールを持つ', async () => {
      mocks.db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('fail')),
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('fail')),
          }),
          limit: vi.fn().mockRejectedValue(new Error('fail')),
        }),
      });

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.nameMatchThreshold).toBe(DEFAULT_MATCHING_SCORING_RULES.nameMatchThreshold);
      expect(profile.valueScoreMax).toBe(DEFAULT_MATCHING_SCORING_RULES.valueScoreMax);
      expect(profile.isActive).toBe(true);
    });
  });

  // ── updateActiveMatchingRuleProfile ──────────────────────────────────────

  describe('updateActiveMatchingRuleProfile', () => {
    function buildTx(currentRow: Record<string, unknown>, updatedRow: Record<string, unknown>) {
      const limit = vi.fn().mockResolvedValue([currentRow]);
      const where = vi.fn().mockReturnValue({ limit });
      const txSelect = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where, limit }) });

      const returning = vi.fn().mockResolvedValue([updatedRow]);
      const updateWhere = vi.fn().mockReturnValue({ returning });
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      const txUpdate = vi.fn().mockReturnValue({ set: updateSet });

      const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing });
      const txInsert = vi.fn().mockReturnValue({ values: insertValues });

      const tx = { select: txSelect, update: txUpdate, insert: txInsert };
      return { tx, spies: { txSelect, txUpdate, returning } };
    }

    it('ルールフィールドが指定されていない場合 MatchingRuleValidationError を投げる', async () => {
      await expect(updateActiveMatchingRuleProfile({}))
        .rejects.toThrow(MatchingRuleValidationError);
    });

    it('有効な更新を行うとバージョンがインクリメントされたプロファイルを返す', async () => {
      const currentRow = makeProfileRow({ version: 3 });
      const updatedRow = makeProfileRow({ version: 4, valueScoreMax: 60 });
      const { tx } = buildTx(currentRow, updatedRow);

      mocks.db.transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      );

      const result = await updateActiveMatchingRuleProfile({ valueScoreMax: 60 });

      expect(result.source).toBe('database');
      expect(result.version).toBe(4);
      expect(result.valueScoreMax).toBe(60);
    });

    it('expectedVersion が一致しない場合 MatchingRuleVersionConflictError を投げる', async () => {
      const currentRow = makeProfileRow({ version: 5 });

      const limit = vi.fn().mockResolvedValue([currentRow]);
      const where = vi.fn().mockReturnValue({ limit });
      const txSelect = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where, limit }) });

      const tx = {
        select: txSelect,
        update: vi.fn(),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
        }),
      };
      mocks.db.transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      );

      await expect(
        updateActiveMatchingRuleProfile({ valueScoreMax: 50, expectedVersion: 3 }),
      ).rejects.toThrow(MatchingRuleVersionConflictError);
    });

    it('nameMatchThreshold が 0〜1 の境界外なら MatchingRuleValidationError を投げる', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ nameMatchThreshold: 1.1 }),
      ).rejects.toThrow(MatchingRuleValidationError);

      await expect(
        updateActiveMatchingRuleProfile({ nameMatchThreshold: -0.1 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('nearExpiryDays は整数でなければ MatchingRuleValidationError を投げる', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ nearExpiryDays: 90.5 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('valueScoreDivisor の最小値境界（0.0001）は有効', async () => {
      const currentRow = makeProfileRow({ version: 1 });
      const updatedRow = makeProfileRow({ version: 2, valueScoreDivisor: 0.0001 });
      const { tx } = buildTx(currentRow, updatedRow);

      mocks.db.transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      );

      const result = await updateActiveMatchingRuleProfile({ valueScoreDivisor: 0.0001 });
      expect(result.valueScoreDivisor).toBe(0.0001);
    });
  });
});
