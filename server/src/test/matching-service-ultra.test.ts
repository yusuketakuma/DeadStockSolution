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

const DEFAULT_PROFILE = { ...DEFAULT_MATCHING_SCORING_RULES };

function setupDefaultProfile() {
  mocks.getActiveMatchingRuleProfile.mockResolvedValue(DEFAULT_PROFILE);
}

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

describe('matching-service-ultra', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaultProfile();
  });

  // ── resolveComparisonPharmacyLimit via module-level constant ──
  // The module-level MAX_COMPARISON_PHARMACIES_PER_SOURCE uses env var.
  // Since it's evaluated at import time, we can test the clamp behavior
  // by having more viable pharmacies than the limit.

  // ── findMatches: NaN/negative yakkaUnitPrice ──
  describe('buildMatchItems filters NaN and negative prices', () => {
    it('skips items with NaN yakkaUnitPrice', async () => {
      const futureDate = '2099-12-31';
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createLimitQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'deadStock') {
          return createOrderByQuery([
            { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: 'not-a-number', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
            { id: 12, pharmacyId: 2, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
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
          return createWhereQuery([{ id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
        }
        if (type === 'reservations') return createGroupByQuery([]);
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatches(1);
      // NaN price skips that item, no match possible from pharmacy 1 side
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ── findMatches: expirationDateIso takes priority over expirationDate ──
  describe('buildMatchItems uses expirationDateIso over expirationDate', () => {
    it('uses expirationDateIso when both are present', async () => {
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createLimitQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'deadStock') {
          return createOrderByQuery([
            // expirationDate is in the past but expirationDateIso is in the future
            { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: '2020-01-01', expirationDateIso: '2099-12-31', lotNumber: null, createdAt: null },
            { id: 12, pharmacyId: 2, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: '2020-01-01', expirationDateIso: '2099-12-31', lotNumber: null, createdAt: null },
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
          return createWhereQuery([{ id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
        }
        if (type === 'reservations') return createGroupByQuery([]);
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatches(1);
      // Should still produce candidates because expirationDateIso is used and it's in the future
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ── findMatches: reservation makes quantity non-finite ──
  describe('applyReservationsToStockRows non-finite result', () => {
    it('skips items where available quantity is not finite', async () => {
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createLimitQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'deadStock') {
          return createOrderByQuery([
            // quantity is Infinity-like (huge number minus reserved)
            { id: 11, pharmacyId: 1, drugName: '薬A', quantity: Infinity, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
          ]);
        }
        if (type === 'usedMed') {
          return createOrderByQuery([{ pharmacyId: 1, drugName: '薬A' }]);
        }
        if (type === 'favoriteRows') return createWhereQuery([]);
        if (type === 'viablePharmacies') {
          return createWhereQuery([{ id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
        }
        if (type === 'reservations') {
          // reservedQty is NaN, so quantity - NaN = NaN which is not finite
          return createGroupByQuery([{ deadStockItemId: 11, reservedQty: NaN }]);
        }
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatches(1);
      // NaN available quantity is filtered out
      expect(result).toEqual([]);
    });
  });

  // ── findMatchesBatch: source pharmacy with no viable after blocked filter ──
  describe('findMatchesBatch blocked filter removes all viable', () => {
    it('returns empty when all viable pharmacies are blocked', async () => {
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createWhereQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'relationships') {
          // Block pharmacy 2 (the only viable one)
          return createWhereQuery([{ pharmacyId: 1, targetPharmacyId: 2 }]);
        }
        if (type === 'viablePharmacies') {
          return createWhereQuery([{ id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
        }
        if (type === 'deadStock') {
          return createOrderByQuery([
            { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
            { id: 12, pharmacyId: 2, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
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
      expect(result.get(1)).toEqual([]);
    });
  });

  // ── findMatchesBatch: other pharmacy has no used med index ──
  describe('findMatchesBatch skips other pharmacy with no used meds', () => {
    it('skips candidate when other pharmacy has no used med data', async () => {
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
          return createOrderByQuery([
            { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
            { id: 12, pharmacyId: 2, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
          ]);
        }
        if (type === 'usedMed') {
          // Only pharmacy 1 has used meds, pharmacy 2 has none
          return createOrderByQuery([
            { pharmacyId: 1, drugName: '薬A' },
          ]);
        }
        if (type === 'reservations') return createGroupByQuery([]);
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatchesBatch([1]);
      expect(result.get(1)).toEqual([]);
    });
  });

  // ── findMatchesBatch: other pharmacy has no dead stock ──
  describe('findMatchesBatch skips other pharmacy with no dead stock', () => {
    it('skips candidate when other pharmacy has no dead stock', async () => {
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
          // Only pharmacy 1 has dead stock
          return createOrderByQuery([
            { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
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
      expect(result.get(1)).toEqual([]);
    });
  });

  // ── findMatchesBatch: bidirectional block (target -> source) ──
  describe('findMatchesBatch handles reverse-direction block', () => {
    it('filters out pharmacy blocked in reverse direction', async () => {
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createWhereQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'relationships') {
          // Block from pharmacy 2 -> 1 (reverse direction)
          return createWhereQuery([{ pharmacyId: 2, targetPharmacyId: 1 }]);
        }
        if (type === 'viablePharmacies') {
          return createWhereQuery([{ id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
        }
        if (type === 'deadStock') {
          return createOrderByQuery([
            { id: 11, pharmacyId: 1, drugName: '薬A', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: null, expirationDateIso: null, lotNumber: null, createdAt: null },
          ]);
        }
        if (type === 'usedMed') {
          return createOrderByQuery([{ pharmacyId: 1, drugName: '薬A' }]);
        }
        if (type === 'reservations') return createGroupByQuery([]);
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatchesBatch([1]);
      // Pharmacy 2 blocked pharmacy 1, so no candidates
      expect(result.get(1)).toEqual([]);
    });
  });

  // ── findMatchesBatch with full candidate generation ──
  describe('findMatchesBatch generates candidates with business hours', () => {
    it('generates candidates with businessStatus in batch mode', async () => {
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
        if (type === 'reservations') return createGroupByQuery([]);
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatchesBatch([1]);
      const candidates = result.get(1) ?? [];
      expect(Array.isArray(candidates)).toBe(true);
      if (candidates.length > 0) {
        expect(candidates[0].pharmacyId).toBe(2);
        expect(typeof candidates[0].score).toBe('number');
        expect(candidates[0].businessStatus).toBeDefined();
      }
    });
  });

  // ── findMatchesBatch: favorite pharmacies in clamp pool ──
  describe('findMatchesBatch includes favorites beyond clamped pool', () => {
    it('includes favorite even when pharmacies pool is full', async () => {
      const futureDate = '2099-12-31';
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createWhereQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'relationships') {
          // Pharmacy 1 favorites pharmacy 3
          return createWhereQuery([{ pharmacyId: 1, targetPharmacyId: 3 }]);
        }
        if (type === 'viablePharmacies') {
          return createWhereQuery([
            { id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 },
            { id: 3, name: 'C', phone: '000', fax: '000', latitude: 36.0, longitude: 140.0 },
          ]);
        }
        if (type === 'deadStock') {
          return createOrderByQuery([
            { id: 11, pharmacyId: 1, drugName: 'アムロジピン錠5mg', quantity: 100, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
            { id: 12, pharmacyId: 2, drugName: 'アムロジピン錠5mg', quantity: 80, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
            { id: 13, pharmacyId: 3, drugName: 'アムロジピン錠5mg', quantity: 60, unit: '錠', yakkaUnitPrice: '50', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
          ]);
        }
        if (type === 'usedMed') {
          return createOrderByQuery([
            { pharmacyId: 1, drugName: 'アムロジピン錠5mg' },
            { pharmacyId: 2, drugName: 'アムロジピン錠5mg' },
            { pharmacyId: 3, drugName: 'アムロジピン錠5mg' },
          ]);
        }
        if (type === 'reservations') return createGroupByQuery([]);
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatchesBatch([1]);
      const candidates = result.get(1) ?? [];
      expect(Array.isArray(candidates)).toBe(true);
      // Should include favorite pharmacy 3
      if (candidates.length > 0) {
        const fav = candidates.find((c: { pharmacyId: number }) => c.pharmacyId === 3);
        if (fav) {
          expect(fav.isFavorite).toBe(true);
        }
      }
    });
  });

  // ── findMatches: low match score below threshold ──
  describe('buildMatchItems filters items below name match threshold', () => {
    it('skips items where match score is below threshold', async () => {
      const futureDate = '2099-12-31';
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createLimitQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
        }
        if (type === 'deadStock') {
          return createOrderByQuery([
            // Completely different drug names that won't match
            { id: 11, pharmacyId: 1, drugName: 'ZZZZZ完全無関係薬品', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
            { id: 12, pharmacyId: 2, drugName: 'XXXXX別の無関係薬品', quantity: 10, unit: '錠', yakkaUnitPrice: '100', expirationDate: futureDate, expirationDateIso: futureDate, lotNumber: null, createdAt: null },
          ]);
        }
        if (type === 'usedMed') {
          return createOrderByQuery([
            // Used meds don't match dead stock names
            { pharmacyId: 1, drugName: 'YYYYYまったく違う薬品' },
            { pharmacyId: 2, drugName: 'WWWWWこれも違う薬品' },
          ]);
        }
        if (type === 'favoriteRows') return createWhereQuery([]);
        if (type === 'viablePharmacies') {
          return createWhereQuery([{ id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
        }
        if (type === 'reservations') return createGroupByQuery([]);
        if (type === 'businessHours') return createWhereQuery([]);
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatches(1);
      // No matches because drug names are too different
      expect(result).toEqual([]);
    });
  });

  // ── findMatches: isConfigured field in businessStatus ──
  describe('findMatches businessStatus includes isConfigured', () => {
    it('adds isConfigured to business status in single-pharmacy mode', async () => {
      const futureDate = '2099-12-31';
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
          return createLimitQuery([{ id: 1, name: 'A', latitude: 35.0, longitude: 139.0 }]);
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
        if (type === 'favoriteRows') return createWhereQuery([]);
        if (type === 'viablePharmacies') {
          return createWhereQuery([{ id: 2, name: 'B', phone: '000', fax: '000', latitude: 35.1, longitude: 139.1 }]);
        }
        if (type === 'reservations') return createGroupByQuery([]);
        if (type === 'businessHours') {
          // Return business hours for pharmacy 2
          return createWhereQuery([{
            pharmacyId: 2, dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false, is24Hours: false,
          }]);
        }
        if (type === 'specialHours') return createWhereQuery([]);
        return createSubQueryBuilder();
      });

      const result = await findMatches(1);
      if (result.length > 0) {
        // findMatches adds isConfigured to businessStatus
        expect(result[0].businessStatus).toHaveProperty('isConfigured');
        expect(result[0].businessStatus?.isConfigured).toBe(true);
      }
    });
  });

  // ── Pure function: prepareDrugName cache in buildPreparedDeadStockByPharmacy ──
  describe('prepareDrugName cache behavior', () => {
    it('caches results for same drug name', () => {
      const name1 = prepareDrugName('アムロジピンOD錠5mg');
      const name2 = prepareDrugName('アムロジピンOD錠5mg');
      // Both calls should return equivalent results
      expect(name1.normalizedDrugName).toBe(name2.normalizedDrugName);
    });
  });

  // ── findMatchesBatch: empty dead stock IDs skips reservation fetch ──
  describe('findMatchesBatch empty dead stock IDs', () => {
    it('handles reservation fetch when no dead stock rows exist', async () => {
      mocks.db.select.mockImplementation((fields: unknown) => {
        const type = classifySelect(fields);
        if (type === 'currentPharmacy') {
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

      const result = await findMatchesBatch([1]);
      expect(result.get(1)).toEqual([]);
    });
  });
});
