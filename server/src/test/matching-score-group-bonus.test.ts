import { describe, expect, it } from 'vitest';
import {
  calculateCandidateScore,
  DEFAULT_MATCHING_SCORING_RULES,
  type MatchingScoringRules,
} from '../services/matching-score-service';
import { MatchItem } from '../types';

function createItem(): MatchItem {
  return {
    deadStockItemId: 1,
    drugName: '薬A',
    quantity: 10,
    unit: '錠',
    yakkaUnitPrice: 100,
    yakkaValue: 1000,
    expirationDate: '2099-12-31',
    expirationDateIso: '2099-12-31',
    lotNumber: null,
    matchScore: 0.9,
  };
}

function createRules(groupBonus: number): MatchingScoringRules {
  return {
    ...DEFAULT_MATCHING_SCORING_RULES,
    valueScoreMax: 0,
    valueScoreDivisor: 1,
    balanceScoreMax: 0,
    balanceScoreDiffFactor: 0,
    distanceScoreMax: 0,
    distanceScoreDivisor: 1,
    distanceScoreFallback: 0,
    nearExpiryScoreMax: 0,
    nearExpiryItemFactor: 0,
    diversityScoreMax: 0,
    diversityItemFactor: 0,
    favoriteBonus: 0,
    groupBonus,
  };
}

describe('matching-score-service group bonus', () => {
  it('adds groupBonus when candidate is in the same group', () => {
    const score = calculateCandidateScore(
      1000,
      1000,
      0,
      1,
      [createItem()],
      [createItem()],
      createRules(12),
      false,
      true,
    );

    expect(score).toBe(12);
  });

  it('does not add groupBonus when candidate is not in the same group', () => {
    const score = calculateCandidateScore(
      1000,
      1000,
      0,
      1,
      [createItem()],
      [createItem()],
      createRules(12),
      false,
      false,
    );

    expect(score).toBe(0);
  });
});
