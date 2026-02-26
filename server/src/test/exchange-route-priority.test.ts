import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 2, email: 'user@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/matching-service', () => ({
  findMatches: vi.fn(),
}));

vi.mock('../services/exchange-service', () => ({
  createProposal: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  completeProposal: vi.fn(),
}));

vi.mock('../services/matching-refresh-service', () => ({
  processPendingMatchingRefreshJobs: vi.fn(),
}));

vi.mock('../services/trust-score-service', () => ({
  recalculateTrustScoreForPharmacy: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

import exchangeRouter from '../routes/exchange';

function createPriorityRowsQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  let currentLimit = rows.length;
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockImplementation((limit) => {
    currentLimit = typeof limit === 'number' ? limit : rows.length;
    return query;
  });
  query.offset.mockImplementation((offset) => Promise.resolve(rows.slice(offset, offset + currentLimit)));
  return query;
}

function createWhereQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(rows);
  return query;
}

function createLimitQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(rows);
  return query;
}

function createUpdateQuery() {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockResolvedValue(undefined);
  return query;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exchange', exchangeRouter);
  return app;
}

describe('exchange route priority sorting', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns oldest inbound-waiting proposal first for priority sort page 1', async () => {
    const app = createApp();
    const proposalRows = [
      {
        id: 3,
        pharmacyAId: 7,
        pharmacyBId: 2,
        status: 'proposed',
        totalValueA: '1000',
        totalValueB: '1000',
        valueDifference: '0',
        proposedAt: '2026-02-01T12:00:00.000Z',
      },
      {
        id: 1,
        pharmacyAId: 2,
        pharmacyBId: 9,
        status: 'completed',
        totalValueA: '1000',
        totalValueB: '1000',
        valueDifference: '0',
        proposedAt: '2026-03-01T12:00:00.000Z',
      },
      {
        id: 2,
        pharmacyAId: 2,
        pharmacyBId: 8,
        status: 'completed',
        totalValueA: '1000',
        totalValueB: '1000',
        valueDifference: '0',
        proposedAt: '2026-02-25T12:00:00.000Z',
      },
    ];

    const pharmacyRows = [
      { id: 2, name: '自薬局' },
      { id: 7, name: '相手A' },
      { id: 8, name: '相手B' },
      { id: 9, name: '相手C' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createPriorityRowsQuery(proposalRows))
      .mockImplementationOnce(() => createWhereQuery([{ count: 3 }]))
      .mockImplementationOnce(() => createWhereQuery(pharmacyRows));

    const response = await request(app)
      .get('/api/exchange/proposals')
      .query({ sort: 'priority', page: 1, limit: 1 });

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual(expect.objectContaining({
      page: 1,
      limit: 1,
      total: 3,
      totalPages: 3,
    }));
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 3,
      priorityReasons: expect.arrayContaining(['あなたの承認待ち']),
    }));
  });

  it('rejects comment update when body is empty', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([
      { id: 10, proposalId: 1, authorPharmacyId: 2, isDeleted: false },
    ]));

    const response = await request(app)
      .patch('/api/exchange/proposals/1/comments/10')
      .send({ body: '   ' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'コメント本文を入力してください' });
  });

  it('updates own comment', async () => {
    const app = createApp();
    const updateQuery = createUpdateQuery();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([
      { id: 11, proposalId: 1, authorPharmacyId: 2, isDeleted: false },
    ]));
    mocks.db.update.mockReturnValue(updateQuery);

    const response = await request(app)
      .patch('/api/exchange/proposals/1/comments/11')
      .send({ body: '更新後コメント' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'コメントを更新しました' });
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when comment is not owned by current pharmacy', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

    const response = await request(app)
      .patch('/api/exchange/proposals/1/comments/12')
      .send({ body: '更新不可' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'コメントが見つかりません' });
  });

  it('soft-deletes own comment', async () => {
    const app = createApp();
    const updateQuery = createUpdateQuery();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([
      { id: 13, proposalId: 1, authorPharmacyId: 2, isDeleted: false },
    ]));
    mocks.db.update.mockReturnValue(updateQuery);

    const response = await request(app)
      .delete('/api/exchange/proposals/1/comments/13');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'コメントを削除しました' });
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });
});
