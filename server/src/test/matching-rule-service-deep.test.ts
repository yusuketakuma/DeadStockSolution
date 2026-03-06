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

// ── Helpers ──

function makeSelectChain(result: unknown[]) {
  const limit = vi.fn().mockResolvedValue(result);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where, orderBy, limit }) };
}

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

describe('matching-rule-service-deep', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetMatchingRuleProfileCacheForTest();
  });

  // ── getActiveMatchingRuleProfile additional paths ──

  describe('getActiveMatchingRuleProfile', () => {
    it('falls back to first row when no active row after insert', async () => {
      const row = makeProfileRow({ isActive: false });
      const updatedRow = makeProfileRow({ isActive: true });

      const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockReturnValue({ onConflictDoNothing });
      mocks.db.insert.mockReturnValue({ values });

      // Setup the update chain for activating first row
      const returning = vi.fn().mockResolvedValue([updatedRow]);
      const updateWhere = vi.fn().mockReturnValue({ returning });
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      mocks.db.update.mockReturnValue({ set: updateSet });

      // 1st select: no active rows
      // 2nd select: still no active rows after insert
      // 3rd select: find first row by orderBy(asc(id))
      mocks.db.select
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce(makeSelectChain([row]));

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('database');
      expect(mocks.db.update).toHaveBeenCalled();
    });

    it('returns fallback when no rows exist at all', async () => {
      const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockReturnValue({ onConflictDoNothing });
      mocks.db.insert.mockReturnValue({ values });

      // All selects return empty
      mocks.db.select
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce(makeSelectChain([]));

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('default_fallback');
      expect(profile.id).toBe(0);
    });

    it('falls back when normalizeRulesFromDbRow returns null (invalid data)', async () => {
      const invalidRow = makeProfileRow({ nameMatchThreshold: 'not-a-number' });
      mocks.db.select.mockReturnValueOnce(makeSelectChain([invalidRow]));

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('default_fallback');
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('validation failed'),
        expect.any(Object),
      );
    });

    it('handles valueScoreMax NaN from DB row', async () => {
      const invalidRow = makeProfileRow({ valueScoreMax: NaN });
      mocks.db.select.mockReturnValueOnce(makeSelectChain([invalidRow]));

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('default_fallback');
    });

    it('handles string numeric values from DB correctly', async () => {
      const row = makeProfileRow({ nameMatchThreshold: '0.8' });
      mocks.db.select.mockReturnValueOnce(makeSelectChain([row]));

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('database');
      expect(profile.nameMatchThreshold).toBe(0.8);
    });
  });

  // ── updateActiveMatchingRuleProfile additional paths ──

  describe('updateActiveMatchingRuleProfile', () => {
    function buildTx(
      currentRow: Record<string, unknown> | null,
      updatedRow: Record<string, unknown> | null,
    ) {
      const limit = vi.fn().mockResolvedValue(currentRow ? [currentRow] : []);
      const where = vi.fn().mockReturnValue({ limit });
      const txSelect = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where, limit }) });

      const returning = vi.fn().mockResolvedValue(updatedRow ? [updatedRow] : []);
      const updateWhere = vi.fn().mockReturnValue({ returning });
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      const txUpdate = vi.fn().mockReturnValue({ set: updateSet });

      const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing });
      const txInsert = vi.fn().mockReturnValue({ values: insertValues });

      const tx = { select: txSelect, update: txUpdate, insert: txInsert };
      return { tx, spies: { txSelect, txUpdate, returning, txInsert, limit } };
    }

    it('creates default row in transaction when no active row exists', async () => {
      // First select returns empty, then after insert returns the new row
      const newRow = makeProfileRow({ version: 1 });
      const updatedRow = makeProfileRow({ version: 2, balanceScoreMax: 30 });

      const txSelectImpl = vi.fn();
      // First call: no active row, second call: row exists after insert
      txSelectImpl
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([newRow]),
            }),
          }),
        });

      const returning = vi.fn().mockResolvedValue([updatedRow]);
      const updateWhere = vi.fn().mockReturnValue({ returning });
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      const txUpdate = vi.fn().mockReturnValue({ set: updateSet });

      const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing });
      const txInsert = vi.fn().mockReturnValue({ values: insertValues });

      const tx = { select: txSelectImpl, update: txUpdate, insert: txInsert };

      mocks.db.transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      );

      const result = await updateActiveMatchingRuleProfile({ balanceScoreMax: 30 });

      expect(result.source).toBe('database');
      expect(txInsert).toHaveBeenCalled();
    });

    it('throws when no profile can be found or created', async () => {
      const txSelectImpl = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing });
      const txInsert = vi.fn().mockReturnValue({ values: insertValues });

      const tx = {
        select: txSelectImpl,
        insert: txInsert,
        update: vi.fn(),
      };

      mocks.db.transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      );

      await expect(
        updateActiveMatchingRuleProfile({ valueScoreMax: 50 }),
      ).rejects.toThrow('有効なマッチングルールプロファイルが存在しません');
    });

    it('throws VersionConflictError when optimistic lock fails (update returns empty)', async () => {
      const currentRow = makeProfileRow({ version: 3 });
      const { tx } = buildTx(currentRow, null);

      mocks.db.transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      );

      await expect(
        updateActiveMatchingRuleProfile({ valueScoreMax: 50 }),
      ).rejects.toThrow(MatchingRuleVersionConflictError);
    });

    it('wraps unexpected errors in generic message', async () => {
      mocks.db.transaction.mockRejectedValue(new Error('unexpected DB error'));

      await expect(
        updateActiveMatchingRuleProfile({ valueScoreMax: 50 }),
      ).rejects.toThrow('マッチングルールの更新に失敗しました');
    });

    it('re-throws MatchingRuleValidationError without wrapping', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ nameMatchThreshold: 5.0 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('validates balanceScoreDiffFactor range', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ balanceScoreDiffFactor: -1 }),
      ).rejects.toThrow(MatchingRuleValidationError);

      await expect(
        updateActiveMatchingRuleProfile({ balanceScoreDiffFactor: 1001 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('validates distanceScoreMax range', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ distanceScoreMax: -1 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('validates distanceScoreDivisor range', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ distanceScoreDivisor: 0 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('validates distanceScoreFallback range', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ distanceScoreFallback: 201 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('validates nearExpiryScoreMax range', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ nearExpiryScoreMax: -1 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('validates nearExpiryItemFactor range', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ nearExpiryItemFactor: 101 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('validates nearExpiryDays must be integer within range', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ nearExpiryDays: 0 }),
      ).rejects.toThrow(MatchingRuleValidationError);

      await expect(
        updateActiveMatchingRuleProfile({ nearExpiryDays: 366 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('validates diversityScoreMax range', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ diversityScoreMax: 201 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('validates diversityItemFactor range', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ diversityItemFactor: -1 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('validates favoriteBonus range', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ favoriteBonus: 201 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('validates expectedVersion as positive integer', async () => {
      await expect(
        updateActiveMatchingRuleProfile({ valueScoreMax: 50, expectedVersion: 0 }),
      ).rejects.toThrow(MatchingRuleValidationError);

      await expect(
        updateActiveMatchingRuleProfile({ valueScoreMax: 50, expectedVersion: 1.5 }),
      ).rejects.toThrow(MatchingRuleValidationError);
    });

    it('updates multiple fields at once', async () => {
      const currentRow = makeProfileRow({ version: 1 });
      const updatedRow = makeProfileRow({
        version: 2,
        valueScoreMax: 60,
        balanceScoreMax: 25,
        favoriteBonus: 20,
      });
      const { tx } = buildTx(currentRow, updatedRow);

      mocks.db.transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      );

      const result = await updateActiveMatchingRuleProfile({
        valueScoreMax: 60,
        balanceScoreMax: 25,
        favoriteBonus: 20,
      });

      expect(result.valueScoreMax).toBe(60);
      expect(result.balanceScoreMax).toBe(25);
      expect(result.favoriteBonus).toBe(20);
    });

    it('updates cache after successful update', async () => {
      const currentRow = makeProfileRow({ version: 1 });
      const updatedRow = makeProfileRow({ version: 2, valueScoreMax: 70 });
      const { tx } = buildTx(currentRow, updatedRow);

      mocks.db.transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      );

      await updateActiveMatchingRuleProfile({ valueScoreMax: 70 });

      // Now getActiveMatchingRuleProfile should return cached value without DB call
      const cached = await getActiveMatchingRuleProfile();
      expect(cached.valueScoreMax).toBe(70);
      expect(cached.version).toBe(2);
      // DB select should not be called (cache hit)
      expect(mocks.db.select).not.toHaveBeenCalled();
    });
  });

  // ── toFiniteNumber and validateRange edge cases ──

  describe('normalizeRulesFromDbRow validation edge cases', () => {
    it('handles Infinity values', async () => {
      const row = makeProfileRow({ valueScoreDivisor: Infinity });
      mocks.db.select.mockReturnValueOnce(makeSelectChain([row]));

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('default_fallback');
    });

    it('handles null value fields', async () => {
      const row = makeProfileRow({ balanceScoreMax: null });
      mocks.db.select.mockReturnValueOnce(makeSelectChain([row]));

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('default_fallback');
    });

    it('handles empty string value', async () => {
      const row = makeProfileRow({ distanceScoreMax: '' });
      mocks.db.select.mockReturnValueOnce(makeSelectChain([row]));

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('default_fallback');
    });

    it('handles valid string numeric value from DB', async () => {
      const row = makeProfileRow({ favoriteBonus: '10' });
      mocks.db.select.mockReturnValueOnce(makeSelectChain([row]));

      const profile = await getActiveMatchingRuleProfile();

      expect(profile.source).toBe('database');
      expect(profile.favoriteBonus).toBe(10);
    });
  });
});
