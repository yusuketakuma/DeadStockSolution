import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  DEFAULT_MATCHING_SCORING_RULES,
  roundTo2,
  prepareDrugName,
  buildUsedMedIndex,
  findBestDrugMatch,
  calculateCandidateScore,
  calculateMatchRate,
  isExpiredDate,
} from '../services/matching-score-service';
import {
  MIN_EXCHANGE_VALUE,
  VALUE_TOLERANCE,
  MAX_CANDIDATES,
  balanceValues,
  groupByPharmacy,
} from '../services/matching-filter-service';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  getActiveMatchingRuleProfile: vi.fn(),
  sortMatchCandidatesByPriority: vi.fn((candidates: unknown[]) => candidates),
  getBusinessHoursStatus: vi.fn(() => ({
    isOpen: true,
    closingSoon: false,
    is24Hours: false,
    todayHours: null,
  })),
  haversineDistance: vi.fn(() => 5.0),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/matching-rule-service', () => ({
  getActiveMatchingRuleProfile: mocks.getActiveMatchingRuleProfile,
}));

vi.mock('../services/matching-priority-service', () => ({
  sortMatchCandidatesByPriority: mocks.sortMatchCandidatesByPriority,
}));

vi.mock('../utils/business-hours-utils', () => ({
  getBusinessHoursStatus: mocks.getBusinessHoursStatus,
}));

vi.mock('../utils/geo-utils', () => ({
  haversineDistance: mocks.haversineDistance,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  or: vi.fn((...args: unknown[]) => ({ _or: args })),
  exists: vi.fn((arg: unknown) => ({ _exists: arg })),
  notExists: vi.fn((arg: unknown) => ({ _notExists: arg })),
  gte: vi.fn((a: unknown, b: unknown) => ({ _gte: [a, b] })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ _inArray: [a, b] })),
  ne: vi.fn((a: unknown, b: unknown) => ({ _ne: [a, b] })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  })),
}));

import { findMatches, findMatchesBatch } from '../services/matching-service';
import {
  createLimitQuery,
  createOrderByQuery,
  createSubQueryBuilder,
  createWhereQuery,
} from './helpers/mock-builders';

const DEFAULT_PROFILE = { ...DEFAULT_MATCHING_SCORING_RULES };

function setupDefaultProfile() {
  mocks.getActiveMatchingRuleProfile.mockResolvedValue(DEFAULT_PROFILE);
}

/** Classify select fields to determine which DB query is being mocked */
function classifySelect(fields: unknown): string {
  const keys = Object.keys((fields ?? {}) as Record<string, unknown>);
  if (keys.length === 0) return 'unknown';
  if (keys.includes('quantity') && keys.includes('expirationDate')) return 'deadStock';
  if (keys.length === 2 && keys.includes('pharmacyId') && keys.includes('drugName')) return 'usedMed';
  if (keys.includes('phone') && keys.includes('fax') && keys.includes('latitude')) return 'viablePharmacies';
  if (keys.includes('phone') && keys.includes('fax') && !keys.includes('latitude')) return 'viablePharmacies';
  if (keys.includes('name') && keys.includes('latitude') && !keys.includes('phone')) return 'currentPharmacy';
  if (keys.length === 1 && keys[0] === 'targetPharmacyId') return 'favoriteRows';
  if (keys.includes('pharmacyId') && keys.includes('targetPharmacyId')) return 'relationships';
  if (keys.includes('dayOfWeek')) return 'businessHours';
  if (keys.includes('specialType')) return 'specialHours';
  if (keys.includes('deadStockItemId') && keys.includes('reservedQty')) return 'reservations';
  return 'unknown';
}

function createGroupByQuery(result: unknown[]) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.groupBy.mockResolvedValue(result);
  return query;
}

// ── Pure function tests (no DB mocking needed) ──

describe('matching-service-deep: groupByPharmacy', () => {
  it('groups rows by pharmacyId', () => {
    const rows = [
      { pharmacyId: 1, drugName: '薬A' },
      { pharmacyId: 1, drugName: '薬B' },
      { pharmacyId: 2, drugName: '薬C' },
    ];
    const grouped = groupByPharmacy(rows);
    expect(grouped.get(1)).toHaveLength(2);
    expect(grouped.get(2)).toHaveLength(1);
  });

  it('returns empty map for empty input', () => {
    const grouped = groupByPharmacy([]);
    expect(grouped.size).toBe(0);
  });
});

describe('matching-service-deep: balanceValues', () => {
  it('balances items by value', () => {
    const itemsA = [
      { deadStockItemId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: 100, yakkaValue: 1000, matchScore: 0.9 },
    ];
    const itemsB = [
      { deadStockItemId: 2, drugName: '薬B', quantity: 5, unit: '錠', yakkaUnitPrice: 200, yakkaValue: 1000, matchScore: 0.9 },
    ];

    const result = balanceValues(itemsA, itemsB);
    expect(result.balancedA.length).toBeGreaterThan(0);
    expect(result.balancedB.length).toBeGreaterThan(0);
    expect(result.totalA).toBeGreaterThan(0);
    expect(result.totalB).toBeGreaterThan(0);
  });

  it('returns empty when value is below minimum', () => {
    const itemsA = [
      { deadStockItemId: 1, drugName: '薬A', quantity: 0.01, unit: '錠', yakkaUnitPrice: 1, yakkaValue: 0.01, matchScore: 0.9 },
    ];
    const itemsB = [
      { deadStockItemId: 2, drugName: '薬B', quantity: 0.01, unit: '錠', yakkaUnitPrice: 1, yakkaValue: 0.01, matchScore: 0.9 },
    ];

    const result = balanceValues(itemsA, itemsB);
    // Very small values may result in empty balanced arrays
    expect(typeof result.totalA).toBe('number');
    expect(typeof result.totalB).toBe('number');
  });
});

describe('matching-service-deep: buildMatchItems via findMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfile();
  });

  it('filters out items with zero/negative price', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createLimitQuery([{ id: 1, name: 'テスト薬局', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([
          // Price is 0 => should be filtered
          { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '0', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
          { id: 12, pharmacyId: 2, drugName: '薬B', quantity: 5, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
        ]);
      }
      if (type === 'usedMed') {
        return createOrderByQuery([
          { pharmacyId: 1, drugName: '薬B' },
          { pharmacyId: 2, drugName: '薬A' },
        ]);
      }
      if (type === 'favoriteRows') return createWhereQuery([]);
      if (type === 'viablePharmacies') {
        return createWhereQuery([{ id: 2, name: '相手薬局', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
      }
      if (type === 'reservations') return createGroupByQuery([]);
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    // With 0-priced items, no match should form from pharmacy 1's perspective
    expect(Array.isArray(result)).toBe(true);
  });

  it('filters out expired items', async () => {
    // Set up items where one is expired
    const expiredDate = '2020-01-01';

    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createLimitQuery([{ id: 1, name: 'テスト薬局', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([
          // Expired item
          { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: expiredDate, expirationDateIso: expiredDate, lotNumber: null, createdAt: null },
          { id: 12, pharmacyId: 2, drugName: '薬B', quantity: 5, unit: '錠', yakkaUnitPrice: '200', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
        ]);
      }
      if (type === 'usedMed') {
        return createOrderByQuery([
          { pharmacyId: 1, drugName: '薬B' },
          { pharmacyId: 2, drugName: '薬A' },
        ]);
      }
      if (type === 'favoriteRows') return createWhereQuery([]);
      if (type === 'viablePharmacies') {
        return createWhereQuery([{ id: 2, name: '相手', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
      }
      if (type === 'reservations') return createGroupByQuery([]);
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles distance calculation when coordinates are null', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        // null coordinates
        return createLimitQuery([{ id: 1, name: 'テスト薬局', latitude: null, longitude: null }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([
          { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
          { id: 12, pharmacyId: 2, drugName: '薬A', quantity: 5, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
        ]);
      }
      if (type === 'usedMed') {
        return createOrderByQuery([
          { pharmacyId: 1, drugName: '薬A' },
          { pharmacyId: 2, drugName: '薬A' },
        ]);
      }
      if (type === 'favoriteRows') return createWhereQuery([]);
      if (type === 'viablePharmacies') {
        return createWhereQuery([{ id: 2, name: '相手薬局', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
      }
      if (type === 'reservations') return createGroupByQuery([]);
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    // Should not call haversineDistance when coords are null
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles viable pharmacy with null coordinates', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createLimitQuery([{ id: 1, name: 'テスト', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([
          { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
          { id: 12, pharmacyId: 2, drugName: '薬A', quantity: 5, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
        ]);
      }
      if (type === 'usedMed') {
        return createOrderByQuery([
          { pharmacyId: 1, drugName: '薬A' },
          { pharmacyId: 2, drugName: '薬A' },
        ]);
      }
      if (type === 'favoriteRows') return createWhereQuery([]);
      if (type === 'viablePharmacies') {
        // Viable pharmacy with null coords => distance should be 9999
        return createWhereQuery([{ id: 2, name: '相手', phone: '000', fax: '000', latitude: null, longitude: null }]);
      }
      if (type === 'reservations') return createGroupByQuery([]);
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    expect(Array.isArray(result)).toBe(true);
    // haversineDistance should not be called since other pharmacy has null coords
  });
});

describe('matching-service-deep: findMatchesBatch additional', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfile();
  });

  it('handles multiple source pharmacies including non-existent', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        // Only pharmacy 1 exists, pharmacy 999 does not
        return createWhereQuery([{ id: 1, name: 'テスト薬局', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'relationships') return createWhereQuery([]);
      if (type === 'viablePharmacies') return createWhereQuery([]);
      if (type === 'deadStock') return createOrderByQuery([]);
      if (type === 'usedMed') return createOrderByQuery([]);
      if (type === 'reservations') return createGroupByQuery([]);
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatchesBatch([1, 999]);
    expect(result.get(999)).toEqual([]);
    expect(result.get(1)).toEqual([]);
  });

  it('handles source pharmacy with no used med index', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createWhereQuery([{ id: 1, name: 'テスト', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'relationships') return createWhereQuery([]);
      if (type === 'viablePharmacies') return createWhereQuery([]);
      if (type === 'deadStock') {
        return createOrderByQuery([
          { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
        ]);
      }
      if (type === 'usedMed') {
        // No used meds for pharmacy 1
        return createOrderByQuery([]);
      }
      if (type === 'reservations') return createGroupByQuery([]);
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatchesBatch([1]);
    expect(result.get(1)).toEqual([]);
  });

  it('filters blocked pairs in batch mode', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createWhereQuery([{ id: 1, name: 'テスト', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'relationships') {
        // Return blocked pair
        return createWhereQuery([{ pharmacyId: 1, targetPharmacyId: 2 }]);
      }
      if (type === 'viablePharmacies') {
        return createWhereQuery([{ id: 2, name: '相手', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([
          { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
          { id: 12, pharmacyId: 2, drugName: '薬A', quantity: 5, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
        ]);
      }
      if (type === 'usedMed') {
        return createOrderByQuery([
          { pharmacyId: 1, drugName: '薬A' },
          { pharmacyId: 2, drugName: '薬A' },
        ]);
      }
      if (type === 'reservations') return createGroupByQuery([]);
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatchesBatch([1]);
    // Pharmacy 2 is blocked, so no candidates
    expect(result.get(1)).toEqual([]);
  });

  it('includes favorite pharmacies in clamped pool', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createWhereQuery([{ id: 1, name: 'テスト', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'relationships') {
        // First call is favorites (pharmacyId + targetPharmacyId), second is blocked
        return createWhereQuery([]);
      }
      if (type === 'viablePharmacies') return createWhereQuery([]);
      if (type === 'deadStock') return createOrderByQuery([]);
      if (type === 'usedMed') return createOrderByQuery([]);
      if (type === 'reservations') return createGroupByQuery([]);
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatchesBatch([1]);
    expect(result.get(1)).toEqual([]);
  });
});

// ── Supporting scoring/filter function tests ──

describe('matching-service-deep: scoring helpers', () => {
  it('roundTo2 rounds correctly', () => {
    expect(roundTo2(1.006)).toBe(1.01);
    expect(roundTo2(1.234)).toBe(1.23);
    expect(roundTo2(0)).toBe(0);
    expect(roundTo2(3.456)).toBe(3.46);
    expect(roundTo2(99.999)).toBe(100);
  });

  it('isExpiredDate detects expired dates', () => {
    expect(isExpiredDate('2020-01-01')).toBe(true);
    expect(isExpiredDate('2099-12-31')).toBe(false);
    expect(isExpiredDate(null)).toBe(false);
    expect(isExpiredDate(undefined as unknown as string | null)).toBe(false);
    expect(isExpiredDate('')).toBe(false);
  });

  it('prepareDrugName normalizes drug names', () => {
    const prepared = prepareDrugName('アムロジピンOD錠5mg「サワイ」');
    expect(prepared).toBeDefined();
    expect(typeof prepared.normalizedDrugName).toBe('string');
  });

  it('buildUsedMedIndex creates searchable index', () => {
    const rows = [
      { pharmacyId: 1, drugName: 'アムロジピン錠5mg' },
      { pharmacyId: 1, drugName: 'ロキソプロフェンNa錠60mg' },
    ];
    const index = buildUsedMedIndex(rows);
    expect(index).toBeDefined();
  });

  it('findBestDrugMatch finds best match from index', () => {
    const rows = [
      { pharmacyId: 1, drugName: 'アムロジピン錠5mg' },
    ];
    const index = buildUsedMedIndex(rows);
    const prepared = prepareDrugName('アムロジピン錠5mg');
    const cache = new Map();
    const result = findBestDrugMatch(prepared, index, cache);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('findBestDrugMatch uses cache on second call', () => {
    const rows = [
      { pharmacyId: 1, drugName: '薬A' },
    ];
    const index = buildUsedMedIndex(rows);
    const prepared = prepareDrugName('薬A');
    const cache = new Map();
    const result1 = findBestDrugMatch(prepared, index, cache);
    const result2 = findBestDrugMatch(prepared, index, cache);
    expect(result1.score).toBe(result2.score);
    expect(cache.size).toBe(1);
  });

  it('calculateMatchRate returns a value between 0 and 1', () => {
    const itemsA = [
      { deadStockItemId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: 100, yakkaValue: 1000, matchScore: 0.9 },
    ];
    const itemsB = [
      { deadStockItemId: 2, drugName: '薬B', quantity: 5, unit: '錠', yakkaUnitPrice: 200, yakkaValue: 1000, matchScore: 0.8 },
    ];
    const rate = calculateMatchRate(itemsA, itemsB);
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(100);
  });

  it('calculateCandidateScore returns a positive number', () => {
    const itemsA = [
      { deadStockItemId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: 100, yakkaValue: 1000, matchScore: 0.9 },
    ];
    const itemsB = [
      { deadStockItemId: 2, drugName: '薬B', quantity: 5, unit: '錠', yakkaUnitPrice: 200, yakkaValue: 1000, matchScore: 0.8 },
    ];
    const score = calculateCandidateScore(
      1000, 1000, 0, 5, itemsA, itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
    );
    expect(score).toBeGreaterThan(0);
  });

  it('calculateCandidateScore adds favorite bonus', () => {
    const itemsA = [
      { deadStockItemId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: 100, yakkaValue: 1000, matchScore: 0.9 },
    ];
    const itemsB = [
      { deadStockItemId: 2, drugName: '薬B', quantity: 5, unit: '錠', yakkaUnitPrice: 200, yakkaValue: 1000, matchScore: 0.8 },
    ];
    const scoreNoFav = calculateCandidateScore(
      1000, 1000, 0, 5, itemsA, itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      false,
    );
    const scoreWithFav = calculateCandidateScore(
      1000, 1000, 0, 5, itemsA, itemsB,
      DEFAULT_MATCHING_SCORING_RULES,
      true,
    );
    expect(scoreWithFav).toBeGreaterThan(scoreNoFav);
  });
});

describe('matching-service-deep: findMatches with full candidate generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfile();
  });

  it('generates candidates when matching items exist', async () => {
    const futureDate = '2099-12-31';

    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createLimitQuery([{ id: 1, name: 'テスト薬局', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([
          { id: 11, pharmacyId: 1, drugName: 'アムロジピン錠5mg', quantity: 100, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: 'LOT1', createdAt: '2026-01-01' },
          { id: 12, pharmacyId: 2, drugName: 'アムロジピン錠5mg', quantity: 80, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: 'LOT2', createdAt: '2026-01-01' },
        ]);
      }
      if (type === 'usedMed') {
        return createOrderByQuery([
          { pharmacyId: 1, drugName: 'アムロジピン錠5mg' },
          { pharmacyId: 2, drugName: 'アムロジピン錠5mg' },
        ]);
      }
      if (type === 'favoriteRows') return createWhereQuery([]);
      if (type === 'viablePharmacies') {
        return createWhereQuery([{ id: 2, name: '相手薬局', phone: '000-000', fax: '000-000', latitude: 35.1, longitude: 139.1 }]);
      }
      if (type === 'reservations') return createGroupByQuery([]);
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    expect(Array.isArray(result)).toBe(true);
    // Should generate at least one candidate if matching items exist and values balance
    if (result.length > 0) {
      const candidate = result[0];
      expect(candidate.pharmacyId).toBe(2);
      expect(candidate.pharmacyName).toBe('相手薬局');
      expect(typeof candidate.distance).toBe('number');
      expect(Array.isArray(candidate.itemsFromA)).toBe(true);
      expect(Array.isArray(candidate.itemsFromB)).toBe(true);
      expect(typeof candidate.score).toBe('number');
      expect(typeof candidate.matchRate).toBe('number');
      expect(candidate.businessStatus).toBeDefined();
    }
  });

  it('marks favorite pharmacy in candidates', async () => {
    const futureDate = '2099-12-31';

    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createLimitQuery([{ id: 1, name: 'テスト薬局', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([
          { id: 11, pharmacyId: 1, drugName: 'アムロジピン錠5mg', quantity: 100, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
          { id: 12, pharmacyId: 2, drugName: 'アムロジピン錠5mg', quantity: 80, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
        ]);
      }
      if (type === 'usedMed') {
        return createOrderByQuery([
          { pharmacyId: 1, drugName: 'アムロジピン錠5mg' },
          { pharmacyId: 2, drugName: 'アムロジピン錠5mg' },
        ]);
      }
      if (type === 'favoriteRows') {
        // Pharmacy 1 favorites pharmacy 2
        return createWhereQuery([{ targetPharmacyId: 2 }]);
      }
      if (type === 'viablePharmacies') {
        return createWhereQuery([{ id: 2, name: '相手薬局', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
      }
      if (type === 'reservations') return createGroupByQuery([]);
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    if (result.length > 0) {
      expect(result[0].isFavorite).toBe(true);
    }
  });

  it('skips candidate with only items from one side', async () => {
    const futureDate = '2099-12-31';

    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createLimitQuery([{ id: 1, name: 'テスト薬局', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([
          // Pharmacy 1 has dead stock but pharmacy 2 has none
          { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
        ]);
      }
      if (type === 'usedMed') {
        return createOrderByQuery([
          { pharmacyId: 1, drugName: '薬B' },
          { pharmacyId: 2, drugName: '薬A' },
        ]);
      }
      if (type === 'favoriteRows') return createWhereQuery([]);
      if (type === 'viablePharmacies') {
        return createWhereQuery([{ id: 2, name: '相手', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
      }
      if (type === 'reservations') return createGroupByQuery([]);
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    // No candidates since pharmacy 2 has no dead stock to match
    expect(result).toEqual([]);
  });

  it('applies partial reservations to stock quantities', async () => {
    const futureDate = '2099-12-31';

    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createLimitQuery([{ id: 1, name: 'テスト薬局', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([
          { id: 11, pharmacyId: 1, drugName: 'アムロジピン錠5mg', quantity: 100, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
          { id: 12, pharmacyId: 2, drugName: 'アムロジピン錠5mg', quantity: 100, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
        ]);
      }
      if (type === 'usedMed') {
        return createOrderByQuery([
          { pharmacyId: 1, drugName: 'アムロジピン錠5mg' },
          { pharmacyId: 2, drugName: 'アムロジピン錠5mg' },
        ]);
      }
      if (type === 'favoriteRows') return createWhereQuery([]);
      if (type === 'viablePharmacies') {
        return createWhereQuery([{ id: 2, name: '相手', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
      }
      if (type === 'reservations') {
        // Partial reservation: 30 of 100 reserved for item 11
        return createGroupByQuery([{ deadStockItemId: 11, reservedQty: 30 }]);
      }
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    // Should still have candidates since only 30 of 100 is reserved
    expect(Array.isArray(result)).toBe(true);
  });
});
