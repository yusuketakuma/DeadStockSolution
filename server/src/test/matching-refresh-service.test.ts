import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  exists: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  notInArray: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
}));

vi.mock('../services/matching-service', () => ({
  findMatches: vi.fn(),
  findMatchesBatch: vi.fn(),
}));

vi.mock('../services/matching-snapshot-service', () => ({
  saveMatchSnapshotAndNotifyOnChange: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { __testables } from '../services/matching-refresh-service';

function createSelectQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createUpdateQuery(result: unknown) {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.returning.mockResolvedValue(result);
  return query;
}

describe('matching-refresh-service claim retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries claim when first update loses race', async () => {
    const candidate = {
      id: 10,
      triggerPharmacyId: 1,
      uploadType: 'dead_stock' as const,
      attempts: 0,
    };

    mocks.db.select
      .mockImplementationOnce(() => createSelectQuery([candidate]))
      .mockImplementationOnce(() => createSelectQuery([candidate]));
    mocks.db.update
      .mockImplementationOnce(() => createUpdateQuery([]))
      .mockImplementationOnce(() => createUpdateQuery([candidate]));

    const claimed = await __testables.claimNextRefreshJob();

    expect(claimed).toEqual(candidate);
    expect(mocks.db.select).toHaveBeenCalledTimes(2);
    expect(mocks.db.update).toHaveBeenCalledTimes(2);
  });

  it('returns null when no claimable job exists', async () => {
    mocks.db.select.mockImplementationOnce(() => createSelectQuery([]));

    const claimed = await __testables.claimNextRefreshJob();

    expect(claimed).toBeNull();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });
});
