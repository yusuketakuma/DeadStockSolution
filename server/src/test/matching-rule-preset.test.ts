/**
 * T963: matchingRuleProfiles の2層設計（グローバル + 薬局別 override）テスト
 *
 * - 薬局別プロファイルが返ること
 * - 薬局別がなければグローバルにフォールバック
 * - 実験が優先されること
 * - 後方互換: 引数なしでグローバルが返ること
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MatchingRuleProfile } from '../types/matching';
import { DEFAULT_MATCHING_SCORING_RULES } from '../services/matching-score-service';

// ---------------------------------------------------------------------------
// モック設定
// ---------------------------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock('../config/database', () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        select: mockDbSelect,
        insert: mockDbInsert,
        update: mockDbUpdate,
      });
    }),
  },
}));

vi.mock('../services/matching-experiment-service', () => ({
  getProfileForPharmacy: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// cache-service をパススルーでモック（実際のキャッシュロジックを使わず常に miss させる）
vi.mock('../services/cache-service', () => ({
  createCache: vi.fn(() => ({
    get: vi.fn(() => undefined),
    set: vi.fn(),
    invalidate: vi.fn(),
    invalidateAll: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// テスト用プロファイル行ファクトリ
// ---------------------------------------------------------------------------

function makeProfileRow(overrides: {
  id?: number;
  profileName?: string;
  pharmacyId?: number | null;
  isActive?: boolean;
} = {}) {
  return {
    id: overrides.id ?? 1,
    profileName: overrides.profileName ?? 'default',
    pharmacyId: overrides.pharmacyId ?? null,
    isActive: overrides.isActive ?? true,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...DEFAULT_MATCHING_SCORING_RULES,
  };
}

// ---------------------------------------------------------------------------
// DB select チェーンヘルパー
// ---------------------------------------------------------------------------

function setupSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  mockDbSelect.mockReturnValue(chain);
  return chain;
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe('getActiveMatchingRuleProfile — 2層プロファイル解決', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // デフォルト: experimentService は null を返す（実験なし）
    const { getProfileForPharmacy } = await import('../services/matching-experiment-service');
    vi.mocked(getProfileForPharmacy).mockResolvedValue(null);
  });

  it('後方互換: 引数なし → グローバルプロファイル (pharmacyId IS NULL) を返す', async () => {
    const globalRow = makeProfileRow({ id: 1, profileName: 'global', pharmacyId: null });
    setupSelectChain([globalRow]);

    const { getActiveMatchingRuleProfile, resetMatchingRuleProfileCacheForTest } = await import('../services/matching-rule-service');
    resetMatchingRuleProfileCacheForTest();

    const result = await getActiveMatchingRuleProfile();

    expect(result.profileName).toBe('global');
    expect(result.source).toBe('database');
  });

  it('pharmacyId あり + 薬局別プロファイルあり → 薬局別を返す', async () => {
    // 1回目: 薬局別プロファイル取得
    // 2回目以降: グローバルプロファイル取得（今回は呼ばれない想定）
    const pharmacyRow = makeProfileRow({ id: 10, profileName: 'pharmacy-42', pharmacyId: 42 });

    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([pharmacyRow]),
    };
    mockDbSelect.mockReturnValue(chain);

    const { getActiveMatchingRuleProfile, resetMatchingRuleProfileCacheForTest } = await import('../services/matching-rule-service');
    resetMatchingRuleProfileCacheForTest();

    const result = await getActiveMatchingRuleProfile({ pharmacyId: 42 });

    expect(result.profileName).toBe('pharmacy-42');
    expect(result.source).toBe('database');
  });

  it('pharmacyId あり + 薬局別なし → グローバルプロファイルにフォールバック', async () => {
    const globalRow = makeProfileRow({ id: 1, profileName: 'global', pharmacyId: null });

    // 1回目呼び出し (薬局別) → 空
    // 2回目呼び出し (グローバル) → globalRow
    let callCount = 0;
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(async () => {
        callCount++;
        // 1回目は薬局別検索 → 空
        if (callCount === 1) return [];
        // 2回目はグローバル検索 → globalRow
        return [globalRow];
      }),
    };
    mockDbSelect.mockReturnValue(chain);

    const { getActiveMatchingRuleProfile, resetMatchingRuleProfileCacheForTest } = await import('../services/matching-rule-service');
    resetMatchingRuleProfileCacheForTest();

    const result = await getActiveMatchingRuleProfile({ pharmacyId: 99 });

    expect(result.profileName).toBe('global');
    expect(result.source).toBe('database');
  });

  it('pharmacyId あり + 薬局別なし + グローバルなし → DEFAULT にフォールバック', async () => {
    // 全検索が空を返す
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDbSelect.mockReturnValue(chain);
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const { getActiveMatchingRuleProfile, resetMatchingRuleProfileCacheForTest } = await import('../services/matching-rule-service');
    resetMatchingRuleProfileCacheForTest();

    const result = await getActiveMatchingRuleProfile({ pharmacyId: 99 });

    expect(result.source).toBe('default_fallback');
    expect(result.nameMatchThreshold).toBe(DEFAULT_MATCHING_SCORING_RULES.nameMatchThreshold);
  });

  it('実験が優先される: 薬局別プロファイルより実験プロファイルが先に返る', async () => {
    const experimentProfile: MatchingRuleProfile = {
      id: 999,
      profileName: 'experiment-treatment',
      isActive: true,
      version: 1,
      createdAt: null,
      updatedAt: null,
      source: 'database',
      ...DEFAULT_MATCHING_SCORING_RULES,
      nameMatchThreshold: 0.9, // 実験プロファイル固有の値
    };

    const { getProfileForPharmacy } = await import('../services/matching-experiment-service');
    vi.mocked(getProfileForPharmacy).mockResolvedValue(experimentProfile);

    // 薬局別プロファイルも存在する (呼ばれないはず)
    const pharmacyRow = makeProfileRow({ id: 10, profileName: 'pharmacy-42', pharmacyId: 42 });
    setupSelectChain([pharmacyRow]);

    const { getActiveMatchingRuleProfile, resetMatchingRuleProfileCacheForTest } = await import('../services/matching-rule-service');
    resetMatchingRuleProfileCacheForTest();

    const result = await getActiveMatchingRuleProfile({ pharmacyId: 42 });

    expect(result.profileName).toBe('experiment-treatment');
    expect(result.nameMatchThreshold).toBe(0.9);
    // DB select は呼ばれていない (実験が先に解決)
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it('boolean true (旧 forceRefresh) を渡してもクラッシュしない (後方互換)', async () => {
    const globalRow = makeProfileRow({ id: 1, profileName: 'global', pharmacyId: null });
    setupSelectChain([globalRow]);

    const { getActiveMatchingRuleProfile, resetMatchingRuleProfileCacheForTest } = await import('../services/matching-rule-service');
    resetMatchingRuleProfileCacheForTest();

    // boolean を渡す (T1010 前の呼び出しパターン)
    const result = await getActiveMatchingRuleProfile(true as unknown as { pharmacyId?: number; forceRefresh?: boolean });

    expect(result).toBeDefined();
    expect(result.source).toBe('database');
  });
});
