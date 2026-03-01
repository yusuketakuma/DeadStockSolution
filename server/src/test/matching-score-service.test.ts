import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateCandidateScore,
  DEFAULT_MATCHING_SCORING_RULES,
  getNearExpiryCount,
  isExpiredDate,
  type MatchingScoringRules,
} from '../services/matching-score-service';
import { MatchItem } from '../types';

function createItem(expirationDate: string | null, expirationDateIso?: string | null): MatchItem {
  return {
    deadStockItemId: 1,
    drugName: '薬A',
    quantity: 10,
    unit: '錠',
    yakkaUnitPrice: 100,
    yakkaValue: 1000,
    expirationDate,
    expirationDateIso: expirationDateIso ?? null,
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
      createItem(null, '2026-02-03'),
      createItem(null),
    ];

    const now = new Date('2026-02-01T00:00:00.000Z');
    expect(getNearExpiryCount(items, 10, now)).toBe(2);
    expect(getNearExpiryCount(items, 20, now)).toBe(3);
    expect(getNearExpiryCount(items, DEFAULT_MATCHING_SCORING_RULES.nearExpiryDays, now)).toBe(4);
  });

  it('treats dates before today as expired', () => {
    expect(isExpiredDate('2026-01-31')).toBe(true);
    expect(isExpiredDate('2026-02-01')).toBe(false);
    expect(isExpiredDate('2026-02-15')).toBe(false);
    expect(isExpiredDate(null)).toBe(false);
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
