import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateCandidateScore,
  DEFAULT_MATCHING_SCORING_RULES,
  getNearExpiryCount,
  type MatchingScoringRules,
} from '../services/matching-score-service';
import { MatchItem } from '../types';

function createItem(expirationDate: string | null): MatchItem {
  return {
    deadStockItemId: 1,
    drugName: '薬A',
    quantity: 10,
    unit: '錠',
    yakkaUnitPrice: 100,
    yakkaValue: 1000,
    expirationDate,
    matchScore: 0.9,
  };
}

describe('matching-score-service configurable scoring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts near-expiry items with provided day threshold', () => {
    const items = [
      createItem('2026-02-05'),
      createItem('2026-02-18'),
      createItem('2026-03-10'),
      createItem(null),
    ];

    expect(getNearExpiryCount(items, 10)).toBe(1);
    expect(getNearExpiryCount(items, 20)).toBe(2);
    expect(getNearExpiryCount(items, DEFAULT_MATCHING_SCORING_RULES.nearExpiryDays)).toBe(3);
  });

  it('calculates score using profile weights instead of hardcoded constants', () => {
    const customRules: MatchingScoringRules = {
      ...DEFAULT_MATCHING_SCORING_RULES,
      valueScoreMax: 100,
      valueScoreDivisor: 100,
      balanceScoreMax: 50,
      balanceScoreDiffFactor: 0,
      distanceScoreMax: 0,
      distanceScoreDivisor: 1,
      distanceScoreFallback: 0,
      nearExpiryScoreMax: 0,
      nearExpiryItemFactor: 0,
      diversityScoreMax: 0,
      diversityItemFactor: 0,
      favoriteBonus: 5,
    };

    const score = calculateCandidateScore(
      5000,
      3000,
      0,
      100,
      [createItem('2026-02-20')],
      [createItem('2026-02-20')],
      customRules,
      true,
    );

    expect(score).toBe(85);
  });
});
