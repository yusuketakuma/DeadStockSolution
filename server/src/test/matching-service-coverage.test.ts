import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_MATCHING_SCORING_RULES,
} from '../services/matching-score-service';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  getActiveMatchingRuleProfile: vi.fn(),
  findMatchesBatch: null as unknown,
  findMatches: null as unknown,
  sortMatchCandidatesByPriority: vi.fn((candidates: unknown[]) => candidates),
  getBusinessHoursStatus: vi.fn(() => ({
    isOpen: true,
    closingSoon: false,
    is24Hours: false,
    todayHours: null,
  })),
  haversineDistance: vi.fn(() => 5.0),
  drizzle: {
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
  },
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
  eq: mocks.drizzle.eq,
  and: mocks.drizzle.and,
  or: mocks.drizzle.or,
  exists: mocks.drizzle.exists,
  notExists: mocks.drizzle.notExists,
  gte: mocks.drizzle.gte,
  inArray: mocks.drizzle.inArray,
  ne: mocks.drizzle.ne,
  sql: mocks.drizzle.sql,
}));

import { findMatches, findMatchesBatch } from '../services/matching-service';
import {
  createLimitQuery,
  createOrderByQuery,
  createSubQueryBuilder,
  createWhereQuery,
} from './helpers/mock-builders';

const DEFAULT_PROFILE = {
  ...DEFAULT_MATCHING_SCORING_RULES,
};

function setupDefaultProfile() {
  mocks.getActiveMatchingRuleProfile.mockResolvedValue(DEFAULT_PROFILE);
}

/** Classify which select() call is being made based on field keys */
function classifySelect(fields: unknown): string {
  const keys = Object.keys((fields ?? {}) as Record<string, unknown>);
  if (keys.length === 0) return 'unknown';
  if (keys.includes('quantity') && keys.includes('expirationDate')) return 'deadStock';
  if (keys.length === 2 && keys.includes('pharmacyId') && keys.includes('drugName')) return 'usedMed';
  if (keys.includes('phone') && keys.includes('fax') && keys.includes('latitude')) return 'viablePharmacies';
  if (keys.includes('phone') && keys.includes('fax') && !keys.includes('latitude')) return 'viablePharmacies';
  if (keys.includes('name') && keys.includes('latitude') && !keys.includes('phone')) return 'currentPharmacy';
  if (keys.length === 1 && keys[0] === 'targetPharmacyId') return 'favoriteRows';
  if (keys.includes('dayOfWeek')) return 'businessHours';
  if (keys.includes('specialType')) return 'specialHours';
  if (keys.includes('deadStockItemId') && keys.includes('reservedQty')) return 'reservations';
  return 'unknown';
}

describe('matching-service coverage: findMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfile();
  });

  it('returns empty array when pharmacy not found', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') return createLimitQuery([]);
      return createSubQueryBuilder();
    });

    await expect(findMatches(999)).rejects.toThrow('薬局が見つかりません');
  });

  it('returns empty array when pharmacy has no dead stock', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createLimitQuery([{ id: 1, name: 'テスト薬局', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'deadStock') return createOrderByQuery([]);
      if (type === 'usedMed') return createOrderByQuery([{ pharmacyId: 1, drugName: '薬A' }]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    expect(result).toEqual([]);
  });

  it('returns empty array when pharmacy has no used medication data', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createLimitQuery([{ id: 1, name: 'テスト薬局', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([{
          id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10,
          unit: '錠', yakkaUnitPrice: '100', expirationDate: null,
          expirationDateIso: null, lotNumber: null, createdAt: null,
        }]);
      }
      if (type === 'usedMed') return createOrderByQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    expect(result).toEqual([]);
  });

  it('returns empty array when no viable pharmacies exist', async () => {
    let selectCallCount = 0;
    mocks.db.select.mockImplementation((fields: unknown) => {
      selectCallCount++;
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createLimitQuery([{ id: 1, name: 'テスト薬局', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([{
          id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10,
          unit: '錠', yakkaUnitPrice: '100', expirationDate: null,
          expirationDateIso: null, lotNumber: null, createdAt: null,
        }]);
      }
      if (type === 'usedMed') {
        return createOrderByQuery([{ pharmacyId: 1, drugName: '薬A' }]);
      }
      if (type === 'favoriteRows') return createWhereQuery([]);
      if (type === 'viablePharmacies') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    expect(result).toEqual([]);
  });

  it('returns empty when all reservations consume available stock', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const type = classifySelect(fields);
      if (type === 'currentPharmacy') {
        return createLimitQuery([{ id: 1, name: 'テスト薬局', latitude: 35.0, longitude: 139.0 }]);
      }
      if (type === 'deadStock') {
        return createOrderByQuery([{
          id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10,
          unit: '錠', yakkaUnitPrice: '100', expirationDate: null,
          expirationDateIso: null, lotNumber: null, createdAt: null,
        }]);
      }
      if (type === 'usedMed') {
        return createOrderByQuery([{ pharmacyId: 1, drugName: '薬A' }]);
      }
      if (type === 'favoriteRows') return createWhereQuery([]);
      if (type === 'viablePharmacies') return createWhereQuery([
        { id: 2, name: '相手薬局', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 },
      ]);
      // Reservations that consume all stock
      if (type === 'reservations') {
        const groupByQuery = {
          from: vi.fn(),
          innerJoin: vi.fn(),
          where: vi.fn(),
          groupBy: vi.fn(),
        };
        groupByQuery.from.mockReturnValue(groupByQuery);
        groupByQuery.innerJoin.mockReturnValue(groupByQuery);
        groupByQuery.where.mockReturnValue(groupByQuery);
        groupByQuery.groupBy.mockResolvedValue([{ deadStockItemId: 11, reservedQty: 10 }]);
        return groupByQuery;
      }
      if (type === 'businessHours') return createWhereQuery([]);
      if (type === 'specialHours') return createWhereQuery([]);
      return createSubQueryBuilder();
    });

    const result = await findMatches(1);
    expect(result).toEqual([]);
  });
});

describe('matching-service coverage: findMatchesBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultProfile();
  });

  it('returns empty map for empty pharmacy array', async () => {
    const result = await findMatchesBatch([]);
    expect(result).toEqual(new Map());
  });

  it('returns empty candidates for non-existent pharmacies', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const keys = Object.keys((fields ?? {}) as Record<string, unknown>);
      // First call: get current pharmacies by ID - return nothing
      if (keys.includes('name') && keys.includes('latitude') && !keys.includes('phone')) {
        return createWhereQuery([]);
      }
      return createSubQueryBuilder();
    });

    const result = await findMatchesBatch([999]);
    expect(result.get(999)).toEqual([]);
  });

  it('deduplicates input pharmacy IDs', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const keys = Object.keys((fields ?? {}) as Record<string, unknown>);
      if (keys.includes('name') && keys.includes('latitude') && !keys.includes('phone')) {
        return createWhereQuery([]);
      }
      return createSubQueryBuilder();
    });

    const result = await findMatchesBatch([1, 1, 1]);
    // Even though duplicated, only one entry expected
    expect(result.get(1)).toEqual([]);
  });

  it('returns empty candidates when source pharmacy has no dead stock', async () => {
    let selectCallIndex = 0;
    mocks.db.select.mockImplementation((fields: unknown) => {
      selectCallIndex++;
      const keys = Object.keys((fields ?? {}) as Record<string, unknown>);

      // currentPharmacies query
      if (keys.includes('name') && keys.includes('latitude') && !keys.includes('phone')) {
        return createWhereQuery([{ id: 1, name: 'テスト', latitude: 35.0, longitude: 139.0 }]);
      }
      // favoriteRows
      if (keys.length === 2 && keys.includes('pharmacyId') && keys.includes('targetPharmacyId')) {
        return createWhereQuery([]);
      }
      // viablePharmacyPool
      if (keys.includes('phone') && keys.includes('fax')) {
        return createWhereQuery([]);
      }
      // blockedRelationshipRows
      if (keys.includes('pharmacyId') && keys.includes('targetPharmacyId') && keys.length === 2) {
        return createWhereQuery([]);
      }
      // deadStock
      if (keys.includes('quantity') && keys.includes('expirationDate')) {
        return createOrderByQuery([]);
      }
      // usedMed
      if (keys.length === 2 && keys.includes('pharmacyId') && keys.includes('drugName')) {
        return createOrderByQuery([]);
      }
      // reservations
      if (keys.includes('deadStockItemId') && keys.includes('reservedQty')) {
        const groupByQuery = {
          from: vi.fn(),
          innerJoin: vi.fn(),
          where: vi.fn(),
          groupBy: vi.fn(),
        };
        groupByQuery.from.mockReturnValue(groupByQuery);
        groupByQuery.innerJoin.mockReturnValue(groupByQuery);
        groupByQuery.where.mockReturnValue(groupByQuery);
        groupByQuery.groupBy.mockResolvedValue([]);
        return groupByQuery;
      }
      // businessHours / specialHours
      if (keys.includes('dayOfWeek') || keys.includes('specialType')) {
        return createWhereQuery([]);
      }
      return createSubQueryBuilder();
    });

    const result = await findMatchesBatch([1]);
    expect(result.get(1)).toEqual([]);
  });
});
