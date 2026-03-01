import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

import {
  getAdminPharmacyRiskPage,
  getAdminRiskOverview,
  getPharmacyRiskDetail,
  invalidateAdminRiskSnapshotCache,
} from '../services/expiry-risk-service';

function createWhereQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

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

describe('expiry-risk-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
    invalidateAdminRiskSnapshotCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('classifies risk buckets for a pharmacy detail view', async () => {
    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([{ id: 1, name: '青葉薬局' }]))
      .mockImplementationOnce(() => createWhereQuery([
        { id: 1, pharmacyId: 1, drugName: 'A', quantity: 1, unit: '錠', yakkaTotal: '100', expirationDate: null, expirationDateIso: '2026-02-28' },
        { id: 2, pharmacyId: 1, drugName: 'B', quantity: 1, unit: '錠', yakkaTotal: '100', expirationDate: null, expirationDateIso: '2026-03-31' },
        { id: 3, pharmacyId: 1, drugName: 'C', quantity: 1, unit: '錠', yakkaTotal: '100', expirationDate: null, expirationDateIso: '2026-04-30' },
        { id: 4, pharmacyId: 1, drugName: 'D', quantity: 1, unit: '錠', yakkaTotal: '100', expirationDate: null, expirationDateIso: '2026-05-30' },
        { id: 5, pharmacyId: 1, drugName: 'E', quantity: 1, unit: '錠', yakkaTotal: '100', expirationDate: null, expirationDateIso: '2026-06-29' },
        { id: 6, pharmacyId: 1, drugName: 'F', quantity: 1, unit: '錠', yakkaTotal: '100', expirationDate: null, expirationDateIso: '2026-06-30' },
        { id: 7, pharmacyId: 1, drugName: 'G', quantity: 1, unit: '錠', yakkaTotal: '100', expirationDate: null, expirationDateIso: null },
      ]));

    const result = await getPharmacyRiskDetail(1);

    expect(result.totalItems).toBe(7);
    expect(result.bucketCounts).toEqual({
      expired: 1,
      within30: 1,
      within60: 1,
      within90: 1,
      within120: 1,
      over120: 1,
      unknown: 1,
    });
    expect(result.topRiskItems[0].bucket).toBe('expired');
  });

  it('aggregates admin overview and paginated high-risk list', async () => {
    const pharmacies = [
      { id: 1, name: '高リスク薬局' },
      { id: 2, name: '低リスク薬局' },
      { id: 3, name: '在庫なし薬局' },
    ];
    const stockRows = [
      { id: 1, pharmacyId: 1, drugName: 'A', quantity: 1, unit: '錠', yakkaTotal: '100', expirationDate: null, expirationDateIso: '2026-02-20' },
      { id: 2, pharmacyId: 2, drugName: 'B', quantity: 1, unit: '錠', yakkaTotal: '100', expirationDate: null, expirationDateIso: '2026-09-01' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createWhereQuery(pharmacies))
      .mockImplementationOnce(() => createWhereQuery(stockRows));

    const overview = await getAdminRiskOverview();
    expect(overview.totalPharmacies).toBe(3);
    expect(overview.highRiskPharmacies).toBe(1);
    expect(overview.lowRiskPharmacies).toBe(2);
    expect(overview.topHighRiskPharmacies[0].pharmacyId).toBe(1);

    const page = await getAdminPharmacyRiskPage(1, 2);
    expect(page.total).toBe(3);
    expect(page.data.map((row) => row.pharmacyId)).toEqual([1, 2]);
    expect(mocks.db.select).toHaveBeenCalledTimes(2);
  });
});
