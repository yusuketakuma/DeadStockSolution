import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

import { listTrustScores, recalculateTrustScoreForPharmacy, recalculateTrustScores } from '../services/trust-score-service';

function createTrustRowsQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockResolvedValue(rows);
  return query;
}

function createFromResolvedQuery(result: unknown) {
  const query = {
    from: vi.fn(),
  };
  query.from.mockResolvedValue(result);
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

function createGroupByQuery(result: unknown, withWhere: boolean) {
  const query = {
    from: vi.fn(),
    groupBy: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.groupBy.mockReturnValue(query);
  if (withWhere) {
    query.where.mockResolvedValue(result);
  } else {
    query.where.mockRejectedValue(new Error('where should not be called'));
    query.groupBy.mockResolvedValue(result);
  }
  return query;
}

function createInsertQuery() {
  const query = {
    values: vi.fn(),
  };
  query.values.mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  });
  return query;
}

describe('trust-score-service list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes trust score payload and applies deterministic ordering', async () => {
    const rowsQuery = createTrustRowsQuery([
      {
        id: 2,
        email: 'b@example.com',
        name: 'B薬局',
        prefecture: '東京都',
        phone: '090',
        fax: '03',
        isActive: 1,
        isAdmin: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        trustScore: null,
        ratingCount: null,
        positiveRate: null,
      },
      {
        id: 1,
        email: 'a@example.com',
        name: 'A薬局',
        prefecture: '神奈川県',
        phone: '080',
        fax: '04',
        isActive: 0,
        isAdmin: 1,
        createdAt: '2026-01-02T00:00:00.000Z',
        trustScore: '77.5',
        ratingCount: '4',
        positiveRate: '50',
      },
    ]);
    const countQuery = createFromResolvedQuery([{ count: 5 }]);

    mocks.db.select
      .mockImplementationOnce(() => rowsQuery)
      .mockImplementationOnce(() => countQuery);

    const result = await listTrustScores(2, 2);

    expect(rowsQuery.orderBy).toHaveBeenCalledTimes(1);
    expect(rowsQuery.orderBy.mock.calls[0]).toHaveLength(3);
    expect(rowsQuery.limit).toHaveBeenCalledWith(2);
    expect(rowsQuery.offset).toHaveBeenCalledWith(2);
    expect(result.total).toBe(5);
    expect(result.data).toEqual([
      expect.objectContaining({
        id: 2,
        isActive: true,
        isAdmin: false,
        trustScore: 60,
        ratingCount: 0,
        positiveRate: 0,
      }),
      expect.objectContaining({
        id: 1,
        isActive: false,
        isAdmin: true,
        trustScore: 77.5,
        ratingCount: 4,
        positiveRate: 50,
      }),
    ]);
  });

  it('recalculates trust scores for target pharmacies using aggregate rows', async () => {
    const activeQuery = createWhereQuery([{ id: 1 }, { id: 2 }]);
    const aggregateQuery = createGroupByQuery([
      { toPharmacyId: 1, avgRating: 5, ratingCount: 2, positiveCount: 2 },
    ], true);
    const insertQuery = createInsertQuery();

    mocks.db.select
      .mockImplementationOnce(() => activeQuery)
      .mockImplementationOnce(() => aggregateQuery);
    mocks.db.insert.mockReturnValue(insertQuery);

    await recalculateTrustScores([1, 1, 2]);

    expect(insertQuery.values).toHaveBeenCalledTimes(2);
    expect(insertQuery.values.mock.calls[0][0]).toEqual(expect.objectContaining({
      pharmacyId: 1,
      trustScore: '71.43',
      ratingCount: 2,
      positiveRate: '100',
    }));
    expect(insertQuery.values.mock.calls[1][0]).toEqual(expect.objectContaining({
      pharmacyId: 2,
      trustScore: '60',
      ratingCount: 0,
      positiveRate: '0',
    }));
  });

  it('recalculates single pharmacy score through wrapper API', async () => {
    const activeQuery = createWhereQuery([{ id: 3 }]);
    const aggregateQuery = createGroupByQuery([], true);
    const insertQuery = createInsertQuery();

    mocks.db.select
      .mockImplementationOnce(() => activeQuery)
      .mockImplementationOnce(() => aggregateQuery);
    mocks.db.insert.mockReturnValue(insertQuery);

    await recalculateTrustScoreForPharmacy(3);

    expect(insertQuery.values).toHaveBeenCalledWith(expect.objectContaining({
      pharmacyId: 3,
      trustScore: '60',
      ratingCount: 0,
      positiveRate: '0',
    }));
  });

  it('recalculates all pharmacies when target is omitted', async () => {
    const allPharmaciesQuery = createFromResolvedQuery([{ id: 10 }]);
    const aggregateQuery = createGroupByQuery([
      { toPharmacyId: 10, avgRating: 4, ratingCount: 5, positiveCount: 4 },
    ], false);
    const insertQuery = createInsertQuery();

    mocks.db.select
      .mockImplementationOnce(() => allPharmaciesQuery)
      .mockImplementationOnce(() => aggregateQuery);
    mocks.db.insert.mockReturnValue(insertQuery);

    await recalculateTrustScores();

    expect(insertQuery.values).toHaveBeenCalledWith(expect.objectContaining({
      pharmacyId: 10,
      trustScore: '70',
      ratingCount: 5,
      positiveRate: '80',
    }));
  });
});
