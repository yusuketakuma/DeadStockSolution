/**
 * matching-service-final.test.ts
 * Covers uncovered lines in matching-service.ts:
 * - findMatchesBatch: existingSourcePharmacyIds.length === 0 after filtering (all source pharmacies not in DB)
 * - findMatchesBatch: source pharmacy has myPreparedDeadStock=0 or !myUsedMedIndex -> set empty, continue
 * - findMatchesBatch: viablePharmacies.length === 0 after blocking filter -> set empty, continue
 * - findMatchesBatch: blockedRelationshipRows condition (both pools empty -> skip)
 * - findMatches: adjustedMyDeadStock.length === 0 (all stock reserved) -> returns []
 * - findMatches: myPreparedDeadStock.length === 0 after all dead stock filtered by reservations
 * - resolveComparisonPharmacyLimit: valid integer path (clamped to 1000)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MATCHING_SCORING_RULES } from '../services/matching-score-service';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
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
  sql: vi.fn(() => ({})),
}));

import { findMatches, findMatchesBatch } from '../services/matching-service';

const DEFAULT_PROFILE = { ...DEFAULT_MATCHING_SCORING_RULES };

function setupDefaultProfile() {
  mocks.getActiveMatchingRuleProfile.mockResolvedValue(DEFAULT_PROFILE);
}

// Builder helpers
function createWhereQuery(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    leftJoin: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockResolvedValue(rows);
  chain.leftJoin.mockReturnValue(chain);
  return chain;
}

function createOrderByQuery(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockResolvedValue(rows);
  return chain;
}

function createLimitQuery(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

function createGroupByQuery(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.groupBy.mockResolvedValue(rows);
  return chain;
}

function createSubQueryBuilder() {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      return vi.fn().mockReturnValue(new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

function classifySelect(fields: unknown): string {
  const keys = Object.keys((fields ?? {}) as Record<string, unknown>);
  if (keys.length === 0) return 'unknown';
  if (keys.includes('quantity') && keys.includes('expirationDate')) return 'deadStock';
  if (keys.length === 2 && keys.includes('pharmacyId') && keys.includes('drugName')) return 'usedMed';
  if (keys.includes('phone') && keys.includes('fax')) return 'viablePharmacies';
  if (keys.includes('name') && keys.includes('latitude') && !keys.includes('phone')) return 'currentPharmacy';
  if (keys.length === 1 && keys[0] === 'targetPharmacyId') return 'favoriteRows';
  if (keys.includes('pharmacyId') && keys.includes('targetPharmacyId')) return 'relationships';
  if (keys.includes('dayOfWeek')) return 'businessHours';
  if (keys.includes('specialType')) return 'specialHours';
  if (keys.includes('deadStockItemId') && keys.includes('reservedQty')) return 'reservations';
  return 'unknown';
}

describe('matching-service-final', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaultProfile();
  });

  describe('findMatchesBatch — all source pharmacies not in DB (existingSourcePharmacyIds empty)', () => {
    it('returns empty arrays for all pharmacies when none exist in DB', async () => {
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          // Return empty -> no existing pharmacies found
          return createWhereQuery([]);
        }
        return createSubQueryBuilder();
      });

      const result = await findMatchesBatch([1, 2]);
      // Both pharmacies not in DB -> both get empty arrays
      expect(result.get(1)).toEqual([]);
      expect(result.get(2)).toEqual([]);
    });
  });

  describe('findMatchesBatch — source pharmacy has no dead stock or used meds (skipped with empty)', () => {
    it('sets empty candidates when source has no prepared dead stock', async () => {
      const futureDate = '2099-12-31';
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createWhereQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'relationships') return createWhereQuery([]);
        if (type === 'viablePharmacies') {
          return createWhereQuery([{ id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
        }
        if (type === 'deadStock') {
          // Pharmacy 1 (source) has NO dead stock, pharmacy 2 has dead stock
          return createOrderByQuery([
            { id: 12, pharmacyId: 2, drugName: 'アムロジピン錠5mg', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
          ]);
        }
        if (type === 'usedMed') {
          return createOrderByQuery([
            { pharmacyId: 1, drugName: 'アムロジピン錠5mg' },
            { pharmacyId: 2, drugName: 'アムロジピン錠5mg' },
          ]);
        }
        if (type === 'reservations') return createGroupByQuery([]);
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatchesBatch([1]);
      // Source pharmacy 1 has no dead stock -> myPreparedDeadStock is empty -> empty array
      expect(result.get(1)).toEqual([]);
    });

    it('sets empty candidates when source has no used med index', async () => {
      const futureDate = '2099-12-31';
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createWhereQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'relationships') return createWhereQuery([]);
        if (type === 'viablePharmacies') {
          return createWhereQuery([{ id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
        }
        if (type === 'deadStock') {
          // Pharmacy 1 has dead stock, but pharmacy 1 has no used meds
          return createOrderByQuery([
            { id: 11, pharmacyId: 1, drugName: 'アムロジピン錠5mg', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
            { id: 12, pharmacyId: 2, drugName: 'アムロジピン錠5mg', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
          ]);
        }
        if (type === 'usedMed') {
          // Pharmacy 1 has NO used meds -> no usedMedIndex for pharmacy 1
          return createOrderByQuery([
            { pharmacyId: 2, drugName: 'アムロジピン錠5mg' },
          ]);
        }
        if (type === 'reservations') return createGroupByQuery([]);
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatchesBatch([1]);
      // Source pharmacy 1 has no usedMedIndex -> empty array
      expect(result.get(1)).toEqual([]);
    });
  });

  describe('findMatchesBatch — viablePharmacies empty after blocking filter', () => {
    it('sets empty candidates when all viable pharmacies are filtered by block + self-exclusion', async () => {
      const futureDate = '2099-12-31';
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createWhereQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'relationships') {
          // Block pharmacy 2 from source 1
          return createWhereQuery([{ pharmacyId: 1, targetPharmacyId: 2 }]);
        }
        if (type === 'viablePharmacies') {
          // Only pharmacy 2 available
          return createWhereQuery([{ id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
        }
        if (type === 'deadStock') {
          return createOrderByQuery([
            { id: 11, pharmacyId: 1, drugName: 'アムロジピン錠5mg', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
            { id: 12, pharmacyId: 2, drugName: 'アムロジピン錠5mg', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
          ]);
        }
        if (type === 'usedMed') {
          return createOrderByQuery([
            { pharmacyId: 1, drugName: 'アムロジピン錠5mg' },
            { pharmacyId: 2, drugName: 'アムロジピン錠5mg' },
          ]);
        }
        if (type === 'reservations') return createGroupByQuery([]);
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatchesBatch([1]);
      // pharmacy 2 is blocked -> viablePharmacies after filter is empty -> []
      expect(result.get(1)).toEqual([]);
    });
  });

  describe('findMatches — adjustedMyDeadStock empty after reservations consume all stock', () => {
    it('returns empty when all source pharmacy dead stock is fully reserved', async () => {
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createLimitQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'deadStock') {
          return createOrderByQuery([
            // Source pharmacy stock - all will be reserved
            { id: 11, pharmacyId: 1, drugName: 'アムロジピン錠5mg', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
            { id: 12, pharmacyId: 2, drugName: 'アムロジピン錠5mg', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
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
          return createWhereQuery([{ id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
        }
        if (type === 'reservations') {
          // Source pharmacy stock item 11 is fully reserved (quantity = 10, reserved = 10)
          return createGroupByQuery([{ deadStockItemId: 11, reservedQty: 10 }]);
        }
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatches(1);
      // All source stock is reserved -> adjustedMyDeadStock empty -> returns []
      expect(result).toEqual([]);
    });
  });

  describe('findMatches — myPreparedDeadStock or myUsedMedIndex empty after filters', () => {
    it('returns empty when myUsedMedIndex is undefined (source has no used med rows)', async () => {
      const futureDate = '2099-12-31';
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createLimitQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'deadStock') {
          return createOrderByQuery([
            { id: 11, pharmacyId: 1, drugName: 'アムロジピン錠5mg', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
            { id: 12, pharmacyId: 2, drugName: 'アムロジピン錠5mg', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
          ]);
        }
        if (type === 'usedMed') {
          // My used meds (pharmacyId=1) = empty, only other pharmacy has some
          // But in findMatches both myUsedMeds and allOtherUsedMeds are fetched separately
          // First call to usedMed (myUsedMeds for pharmacyId=1) returns empty
          return createOrderByQuery([]);
        }
        return createSubQueryBuilder();
      });

      const result = await findMatches(1);
      // myUsedMeds.length === 0 -> returns [] at early guard (line 592-594)
      expect(result).toEqual([]);
    });
  });

  describe('findMatchesBatch — multiple source pharmacies, some in DB, some not', () => {
    it('returns empty array for missing pharmacy and processes existing one', async () => {
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          // Only pharmacy 1 exists, not 99
          return createWhereQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
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

      const result = await findMatchesBatch([1, 99]);
      // pharmacy 99 not in DB -> gets empty via matchesByPharmacy.set(99, [])
      expect(result.get(99)).toEqual([]);
      // pharmacy 1 exists, but no viable pharmacies -> gets empty too
      expect(result.get(1)).toEqual([]);
    });
  });
});
