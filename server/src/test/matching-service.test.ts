import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getActiveMatchingRuleProfile: vi.fn(),
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

import { findMatches } from '../services/matching-service';
import { pharmacies, pharmacyRelationships } from '../db/schema';
import {
  createLimitQuery,
  createOrderByQuery,
  createSubQueryBuilder,
  createWhereQuery,
} from './helpers/mock-builders';
import { setupVitestMocks } from './helpers/setup';

describe('matching-service block filtering', () => {
  setupVitestMocks();

  mocks.getActiveMatchingRuleProfile.mockResolvedValue({
    nameMatchThreshold: 0.7,
    valueScoreMax: 55,
    valueScoreDivisor: 2500,
    balanceScoreMax: 20,
    balanceScoreDiffFactor: 1.5,
    distanceScoreMax: 15,
    distanceScoreDivisor: 8,
    distanceScoreFallback: 2,
    nearExpiryScoreMax: 10,
    nearExpiryItemFactor: 1.5,
    nearExpiryDays: 120,
    diversityScoreMax: 10,
    diversityItemFactor: 1.5,
    favoriteBonus: 15,
  });

  it('builds viable pharmacy filter with bidirectional block checks', async () => {
    mocks.db.select.mockImplementation((fields: unknown) => {
      const keys = Object.keys((fields ?? {}) as Record<string, unknown>);

      if (keys.includes('name') && keys.includes('latitude') && !keys.includes('phone')) {
        return createLimitQuery([
          { id: 1, name: '自薬局', latitude: 35.0, longitude: 139.0 },
        ]);
      }

      if (keys.includes('quantity') && keys.includes('expirationDate')) {
        return createOrderByQuery([
          {
            id: 11,
            pharmacyId: 1,
            drugName: '薬A',
            quantity: 10,
            unit: '錠',
            yakkaUnitPrice: '10',
            expirationDate: null,
          },
        ]);
      }

      if (keys.length === 2 && keys.includes('pharmacyId') && keys.includes('drugName')) {
        return createOrderByQuery([
          { pharmacyId: 1, drugName: '薬B' },
        ]);
      }

      if (keys.length === 1 && keys[0] === 'targetPharmacyId') {
        return createWhereQuery([]);
      }

      if (keys.includes('phone') && keys.includes('fax')) {
        return createWhereQuery([]);
      }

      return createSubQueryBuilder();
    });

    const result = await findMatches(1);

    expect(result).toEqual([]);

    expect(mocks.drizzle.eq).toHaveBeenCalledWith(pharmacyRelationships.pharmacyId, pharmacies.id);
    expect(mocks.drizzle.eq).toHaveBeenCalledWith(pharmacyRelationships.targetPharmacyId, 1);
    expect(mocks.drizzle.or).toHaveBeenCalled();
  });
});
