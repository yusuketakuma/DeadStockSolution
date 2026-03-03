/**
 * expiry-risk-service-final.test.ts
 * Covers uncovered lines in expiry-risk-service.ts:
 * - sortTopRiskItems: daysUntilExpiry = null path (line 185: ?? Number.POSITIVE_INFINITY)
 * - sortTopRiskItems: tie-breaking by yakkaTotal and id (line 189)
 * - getPharmacyRiskDetail: cache hit path (line 290)
 * - getPharmacyRiskDetail: pharmacy not found throws (line 302)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
}));

import {
  getPharmacyRiskDetail,
  invalidateAdminRiskSnapshotCache,
} from '../services/expiry-risk-service';

function createLimitQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createWhereQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

describe('expiry-risk-service-final', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
    invalidateAdminRiskSnapshotCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getPharmacyRiskDetail — pharmacy not found (line 302)', () => {
    it('throws when pharmacy does not exist', async () => {
      // First select: pharmacies.where.limit → [] (not found)
      mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

      await expect(getPharmacyRiskDetail(999)).rejects.toThrow('薬局が見つかりません');
    });
  });

  describe('getPharmacyRiskDetail — userRiskCache hit (line 290)', () => {
    it('returns cached result on second call within TTL', async () => {
      // First call: DB queries succeed
      mocks.db.select
        .mockImplementationOnce(() => createLimitQuery([{ id: 2, name: 'テスト薬局' }]))
        .mockImplementationOnce(() => createWhereQuery([
          {
            id: 10,
            pharmacyId: 2,
            drugName: 'テスト薬',
            quantity: 5,
            unit: '錠',
            yakkaTotal: '500',
            expirationDate: null,
            expirationDateIso: '2026-06-01',
          },
        ]));

      const first = await getPharmacyRiskDetail(2);
      expect(first.totalItems).toBe(1);
      expect(mocks.db.select).toHaveBeenCalledTimes(2);

      // Second call: cache hit (within 30s TTL with fake timers)
      const selectCallCount = mocks.db.select.mock.calls.length;
      const second = await getPharmacyRiskDetail(2);

      // No additional DB calls — cache hit
      expect(mocks.db.select).toHaveBeenCalledTimes(selectCallCount);
      expect(second).toBe(first); // same object from cache
    });
  });

  describe('sortTopRiskItems — daysUntilExpiry null path and tie-breaking', () => {
    it('handles items with null expirationDateIso (daysUntilExpiry = null → Infinity)', async () => {
      mocks.db.select
        .mockImplementationOnce(() => createLimitQuery([{ id: 3, name: '薬局C' }]))
        .mockImplementationOnce(() => createWhereQuery([
          // Item with null expiry → daysUntilExpiry = null → sorted as Infinity
          {
            id: 1,
            pharmacyId: 3,
            drugName: '不明期限薬',
            quantity: 1,
            unit: '錠',
            yakkaTotal: '1000',
            expirationDate: null,
            expirationDateIso: null, // null → daysUntilExpiry = null → POSITIVE_INFINITY
          },
          // Item with known expiry
          {
            id: 2,
            pharmacyId: 3,
            drugName: '近期限薬',
            quantity: 1,
            unit: '錠',
            yakkaTotal: '500',
            expirationDate: null,
            expirationDateIso: '2026-03-15', // 14 days from 2026-03-01
          },
        ]));

      const result = await getPharmacyRiskDetail(3);

      // Item with null expiry should be sorted after item with near expiry
      // (null → Infinity > 14 → sorted later in topRiskItems)
      expect(result.totalItems).toBe(2);
      // The near-expiry item should appear first (lower daysUntilExpiry)
      const firstItem = result.topRiskItems[0];
      expect(firstItem.drugName).toBe('近期限薬');
    });

    it('breaks ties by yakkaTotal then id when weight and daysUntilExpiry are equal', async () => {
      mocks.db.select
        .mockImplementationOnce(() => createLimitQuery([{ id: 4, name: '薬局D' }]))
        .mockImplementationOnce(() => createWhereQuery([
          // Two items with same expirationDateIso (same daysUntilExpiry) and same bucket weight
          // Tie-break: higher yakkaTotal comes first
          {
            id: 10,
            pharmacyId: 4,
            drugName: '高薬価薬',
            quantity: 1,
            unit: '錠',
            yakkaTotal: '2000',
            expirationDate: null,
            expirationDateIso: '2026-03-20', // same date
          },
          {
            id: 11,
            pharmacyId: 4,
            drugName: '低薬価薬',
            quantity: 1,
            unit: '錠',
            yakkaTotal: '100',
            expirationDate: null,
            expirationDateIso: '2026-03-20', // same date → same daysUntilExpiry = 19
          },
        ]));

      const result = await getPharmacyRiskDetail(4);

      // Items have same date → same daysUntilExpiry → tie-break by yakkaTotal (descending)
      expect(result.topRiskItems).toHaveLength(2);
      // Higher yakkaTotal (2000) should come first (b.yakkaTotal - a.yakkaTotal sorts descending)
      expect(result.topRiskItems[0].drugName).toBe('高薬価薬');
      expect(result.topRiskItems[1].drugName).toBe('低薬価薬');
    });
  });
});
