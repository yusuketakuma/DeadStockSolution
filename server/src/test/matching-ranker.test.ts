import { describe, expect, it } from 'vitest';
import { sortAndLimitCandidates } from '../services/matching/matching-ranker';
import { MatchCandidate } from '../types';
import { DEFAULT_MATCHING_SCORING_RULES } from '../services/matching-score-service';

function makeCandidate(score: number): MatchCandidate {
  return {
    pharmacyId: 2,
    pharmacyName: 'B薬局',
    distance: 5,
    itemsFromA: [],
    itemsFromB: [],
    totalValueA: 10000,
    totalValueB: 10000,
    valueDifference: 0,
    score,
    matchRate: 0.5,
  };
}

function makeProfile(overrides: Partial<typeof DEFAULT_MATCHING_SCORING_RULES> = {}) {
  return {
    id: 1,
    profileName: 'test',
    isActive: true,
    version: 1,
    createdAt: null,
    updatedAt: null,
    source: 'database' as const,
    ...DEFAULT_MATCHING_SCORING_RULES,
    ...overrides,
  };
}

describe('sortAndLimitCandidates', () => {
  const now = new Date('2025-01-01');

  it('デフォルトのmaxCandidates=30で候補を制限する', () => {
    const candidates = Array.from({ length: 50 }, (_, i) => makeCandidate(100 - i));
    const profile = makeProfile();
    const result = sortAndLimitCandidates(candidates, profile, now);
    expect(result).toHaveLength(30);
  });

  it('maxCandidates=10で候補を10件に制限する', () => {
    const candidates = Array.from({ length: 50 }, (_, i) => makeCandidate(100 - i));
    const profile = makeProfile({ maxCandidates: 10 });
    const result = sortAndLimitCandidates(candidates, profile, now);
    expect(result).toHaveLength(10);
  });

  it('maxCandidates=100で候補が50件の場合、50件を返す', () => {
    const candidates = Array.from({ length: 50 }, (_, i) => makeCandidate(100 - i));
    const profile = makeProfile({ maxCandidates: 100 });
    const result = sortAndLimitCandidates(candidates, profile, now);
    expect(result).toHaveLength(50);
  });

  it('maxCandidates=1で最高スコアの候補のみ返す', () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(100 - i));
    const profile = makeProfile({ maxCandidates: 1 });
    const result = sortAndLimitCandidates(candidates, profile, now);
    expect(result).toHaveLength(1);
  });

  it('空の候補リストの場合、空配列を返す', () => {
    const profile = makeProfile({ maxCandidates: 10 });
    const result = sortAndLimitCandidates([], profile, now);
    expect(result).toHaveLength(0);
  });
});
