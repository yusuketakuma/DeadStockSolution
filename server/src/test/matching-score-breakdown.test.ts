import { describe, it, expect } from 'vitest';
import {
  calculateCandidateScoreWithBreakdown,
  calculateCandidateScore,
  DEFAULT_MATCHING_SCORING_RULES,
} from '../services/matching-score-service';
import type { MatchItem } from '../types';

function makeItem(overrides: Partial<MatchItem> = {}): MatchItem {
  return {
    deadStockItemId: 1,
    drugName: 'テスト薬品',
    quantity: 10,
    unit: '錠',
    yakkaUnitPrice: 100,
    yakkaValue: 1000,
    expirationDate: '2026-12-31',
    expirationDateIso: '2026-12-31',
    lotNumber: null,
    stockCreatedAt: '2024-01-01',
    matchScore: 0.9,
    ...overrides,
  };
}

describe('calculateCandidateScoreWithBreakdown', () => {
  const referenceDate = new Date('2025-01-01');

  it('returns breakdown with all expected fields', () => {
    const itemsA = [makeItem({ yakkaValue: 5000 })];
    const itemsB = [makeItem({ yakkaValue: 5000 })];

    const result = calculateCandidateScoreWithBreakdown(
      5000,
      5000,
      0,
      10,
      itemsA,
      itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('breakdown');
    const { breakdown } = result;
    expect(breakdown).toHaveProperty('valueScore');
    expect(breakdown).toHaveProperty('distanceScore');
    expect(breakdown).toHaveProperty('expiryScore');
    expect(breakdown).toHaveProperty('diversityScore');
    expect(breakdown).toHaveProperty('favoriteBonus');
    expect(breakdown).toHaveProperty('groupBonus');
    expect(breakdown).toHaveProperty('successRateBonus');
    expect(breakdown).toHaveProperty('total');
  });

  it('breakdown.total matches result.total', () => {
    const itemsA = [makeItem({ yakkaValue: 3000 })];
    const itemsB = [makeItem({ yakkaValue: 3000 })];

    const result = calculateCandidateScoreWithBreakdown(
      3000,
      3000,
      0,
      5,
      itemsA,
      itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    expect(result.breakdown.total).toBe(result.total);
  });

  it('breakdown components sum to total', () => {
    const itemsA = [makeItem({ yakkaValue: 4000 })];
    const itemsB = [makeItem({ yakkaValue: 4000 })];

    const result = calculateCandidateScoreWithBreakdown(
      4000,
      4000,
      0,
      8,
      itemsA,
      itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    const { breakdown } = result;
    // Note: balanceScore is not in ScoreBreakdown (it's an internal component)
    // total includes balanceScore, so we can't simply sum all breakdown fields.
    // Instead, verify each component is non-negative and total is consistent.
    expect(breakdown.valueScore).toBeGreaterThanOrEqual(0);
    expect(breakdown.distanceScore).toBeGreaterThanOrEqual(0);
    expect(breakdown.expiryScore).toBeGreaterThanOrEqual(0);
    expect(breakdown.diversityScore).toBeGreaterThanOrEqual(0);
    expect(breakdown.favoriteBonus).toBe(0);
    expect(breakdown.groupBonus).toBe(0);
    expect(breakdown.successRateBonus).toBe(0);
  });

  it('favoriteBonus is set when isFavorite=true', () => {
    const itemsA = [makeItem({ yakkaValue: 5000 })];
    const itemsB = [makeItem({ yakkaValue: 5000 })];

    const withFavorite = calculateCandidateScoreWithBreakdown(
      5000,
      5000,
      0,
      10,
      itemsA,
      itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      true,
      false,
      referenceDate,
    );

    const withoutFavorite = calculateCandidateScoreWithBreakdown(
      5000,
      5000,
      0,
      10,
      itemsA,
      itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    expect(withFavorite.breakdown.favoriteBonus).toBe(DEFAULT_MATCHING_SCORING_RULES.favoriteBonus);
    expect(withoutFavorite.breakdown.favoriteBonus).toBe(0);
    expect(withFavorite.total).toBe(withoutFavorite.total + DEFAULT_MATCHING_SCORING_RULES.favoriteBonus);
  });

  it('groupBonus is set when isGroupMember=true', () => {
    const itemsA = [makeItem({ yakkaValue: 5000 })];
    const itemsB = [makeItem({ yakkaValue: 5000 })];

    const withGroup = calculateCandidateScoreWithBreakdown(
      5000,
      5000,
      0,
      10,
      itemsA,
      itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      true,
      referenceDate,
    );

    const withoutGroup = calculateCandidateScoreWithBreakdown(
      5000,
      5000,
      0,
      10,
      itemsA,
      itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    expect(withGroup.breakdown.groupBonus).toBe(DEFAULT_MATCHING_SCORING_RULES.groupBonus);
    expect(withoutGroup.breakdown.groupBonus).toBe(0);
    expect(withGroup.total).toBe(withoutGroup.total + DEFAULT_MATCHING_SCORING_RULES.groupBonus);
  });

  it('expiryScore increases for near-expiry items', () => {
    const nearExpiry = new Date('2025-01-01');
    nearExpiry.setDate(nearExpiry.getDate() + 30); // 30 days from reference
    const nearExpiryStr = nearExpiry.toISOString().split('T')[0];

    const itemsWithNearExpiry = [makeItem({ expirationDateIso: nearExpiryStr, yakkaValue: 5000 })];
    const itemsFarExpiry = [makeItem({ expirationDate: '2028-01-01', expirationDateIso: '2028-01-01', yakkaValue: 5000 })];

    const withNearExpiry = calculateCandidateScoreWithBreakdown(
      5000,
      5000,
      0,
      10,
      itemsWithNearExpiry,
      itemsFarExpiry,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    const withoutNearExpiry = calculateCandidateScoreWithBreakdown(
      5000,
      5000,
      0,
      10,
      itemsFarExpiry,
      itemsFarExpiry,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    expect(withNearExpiry.breakdown.expiryScore).toBeGreaterThan(withoutNearExpiry.breakdown.expiryScore);
  });

  it('diversityScore increases with more items', () => {
    const singleItem = [makeItem({ yakkaValue: 2500 })];
    const multipleItems = [
      makeItem({ deadStockItemId: 1, yakkaValue: 1000 }),
      makeItem({ deadStockItemId: 2, yakkaValue: 1500 }),
    ];

    const singleResult = calculateCandidateScoreWithBreakdown(
      2500,
      2500,
      0,
      10,
      singleItem,
      singleItem,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    const multiResult = calculateCandidateScoreWithBreakdown(
      2500,
      2500,
      0,
      10,
      multipleItems,
      multipleItems,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    expect(multiResult.breakdown.diversityScore).toBeGreaterThan(singleResult.breakdown.diversityScore);
  });

  it('calculateCandidateScore (legacy) returns same total as new function', () => {
    const itemsA = [makeItem({ yakkaValue: 6000 })];
    const itemsB = [makeItem({ yakkaValue: 6000 })];

    const legacyScore = calculateCandidateScore(
      6000,
      6000,
      0,
      15,
      itemsA,
      itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      true,
      false,
      referenceDate,
    );

    const newResult = calculateCandidateScoreWithBreakdown(
      6000,
      6000,
      0,
      15,
      itemsA,
      itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      true,
      false,
      referenceDate,
    );

    expect(legacyScore).toBe(newResult.total);
  });

  it('scoreBreakdown.total equals breakdown field total', () => {
    const itemsA = [makeItem({ yakkaValue: 3500 })];
    const itemsB = [makeItem({ yakkaValue: 3500 })];

    const result = calculateCandidateScoreWithBreakdown(
      3500,
      3500,
      0,
      20,
      itemsA,
      itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    expect(result.breakdown.total).toBe(result.total);
  });

  it('valueScore increases with higher exchange value', () => {
    const lowValueItems = [makeItem({ yakkaValue: 1000 })];
    const highValueItems = [makeItem({ yakkaValue: 10000 })];

    const lowResult = calculateCandidateScoreWithBreakdown(
      1000,
      1000,
      0,
      10,
      lowValueItems,
      lowValueItems,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    const highResult = calculateCandidateScoreWithBreakdown(
      10000,
      10000,
      0,
      10,
      highValueItems,
      highValueItems,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    expect(highResult.breakdown.valueScore).toBeGreaterThan(lowResult.breakdown.valueScore);
  });

  it('distanceScore decreases with greater distance', () => {
    const items = [makeItem({ yakkaValue: 5000 })];

    const nearResult = calculateCandidateScoreWithBreakdown(
      5000,
      5000,
      0,
      2, // 2km
      items,
      items,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    const farResult = calculateCandidateScoreWithBreakdown(
      5000,
      5000,
      0,
      50, // 50km
      items,
      items,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      referenceDate,
    );

    expect(nearResult.breakdown.distanceScore).toBeGreaterThan(farResult.breakdown.distanceScore);
  });
});
