import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
  },
  createNotification: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ipKeyGenerator: vi.fn((ip: string) => ip),
}));

vi.mock('../services/matching-service', () => ({
  findMatches: vi.fn(),
}));

vi.mock('../services/exchange-execution-service', () => ({
  createProposal: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  completeProposal: vi.fn(),
}));

vi.mock('../services/proposal-priority-service', () => ({
  getProposalPriority: vi.fn(),
}));

vi.mock('../services/proposal-timeline-service', () => ({
  fetchProposalTimelineActionRows: vi.fn(),
  buildProposalTimeline: vi.fn(),
}));

vi.mock('../services/notification-service', () => ({
  createNotification: mocks.createNotification,
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
  },
}));

let exchangeProposalsRouter: (typeof import('../routes/exchange-proposals'))['default'];

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exchange', (
    req: express.Request & { user?: { id: number; email: string; isAdmin: boolean } },
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.user = { id: 2, email: 'responder@example.com', isAdmin: false };
    next();
  }, exchangeProposalsRouter);
  return app;
}

function limitQuery(rows: unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.from = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.limit = vi.fn(async () => rows);
  return query;
}

function joinWhereQuery(rows: unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.where = vi.fn(async () => rows);
  return query;
}

function whereQuery(rows: unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.from = vi.fn(() => query);
  query.where = vi.fn(async () => rows);
  return query;
}

function groupByQuery(rows: unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.groupBy = vi.fn(async () => rows);
  return query;
}

function setupTransaction(selectQueries: Array<Record<string, ReturnType<typeof vi.fn>>>) {
  const updates: Array<Record<string, unknown>> = [];
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => {
      const query = selectQueries.shift();
      if (!query) throw new Error('Unexpected select call');
      return query;
    }),
    update: vi.fn(() => {
      const query: Record<string, ReturnType<typeof vi.fn>> = {};
      query.set = vi.fn((value: Record<string, unknown>) => {
        updates.push(value);
        return query;
      });
      query.where = vi.fn(() => query);
      query.returning = vi.fn(async () => [{ id: 1 }]);
      return query;
    }),
    insert: vi.fn(() => {
      const query: Record<string, ReturnType<typeof vi.fn>> = {};
      query.values = vi.fn(() => query);
      query.returning = vi.fn(async () => [{ id: 99, status: 'pending' }]);
      return query;
    }),
  };

  mocks.db.transaction.mockImplementation(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx));
  return { tx, updates };
}

const proposal = {
  id: 20,
  pharmacyAId: 1,
  pharmacyBId: 2,
  status: 'proposed',
};

beforeEach(async () => {
  vi.clearAllMocks();
  ({ default: exchangeProposalsRouter } = await import('../routes/exchange-proposals'));
  mocks.createNotification.mockResolvedValue(true);
});

describe('counter-offer acceptance security', () => {
  it('rejects creating a counter-offer item without proposalItemId before DB mutation', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/exchange/proposals/20/counter-offers')
      .send({
        summary: '数量を調整してください',
        items: [{ drugName: '包装なし薬', quantity: 100 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('対象項目ID');
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it('rejects accepting a counter-offer when a modified item lacks package master data', async () => {
    const app = createApp();
    const { tx } = setupTransaction([
      limitQuery([{
        id: 10,
        proposalId: 20,
        proposerPharmacyId: 1,
        responderPharmacyId: 2,
        status: 'pending',
        itemsJson: JSON.stringify([{ proposalItemId: 101, drugName: '包装なし薬', quantity: 100 }]),
      }]),
      limitQuery([proposal]),
      joinWhereQuery([
        { id: 101, deadStockItemId: 301, fromPharmacyId: 1, toPharmacyId: 2, quantity: 100, yakkaValue: '10000', drugName: '包装なし薬' },
        { id: 201, deadStockItemId: 401, fromPharmacyId: 2, toPharmacyId: 1, quantity: 100, yakkaValue: '10000', drugName: '相手薬' },
      ]),
      whereQuery([
        { id: 301, pharmacyId: 1, quantity: 200, unit: '錠', drugMasterPackageId: null, packageQuantity: null, packageUnit: null, isLoosePackage: false, yakkaUnitPrice: '100', isAvailable: true },
        { id: 401, pharmacyId: 2, quantity: 200, unit: '錠', drugMasterPackageId: 501, packageQuantity: 100, packageUnit: '錠', isLoosePackage: false, yakkaUnitPrice: '100', isAvailable: true },
      ]),
      groupByQuery([]),
    ]);

    const response = await request(app)
      .post('/api/exchange/proposals/20/counter-offers/10/respond')
      .send({ decision: 'accepted', responseNote: '患者名 山田太郎 の処方相談を含む返答' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('包装単位マスター');
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it('rejects accepting a counter-offer that exceeds availability after active reservations', async () => {
    const app = createApp();
    const { tx } = setupTransaction([
      limitQuery([{
        id: 10,
        proposalId: 20,
        proposerPharmacyId: 1,
        responderPharmacyId: 2,
        status: 'pending',
        itemsJson: JSON.stringify([{ proposalItemId: 102, drugName: '予約済み薬', quantity: 50 }]),
      }]),
      limitQuery([proposal]),
      joinWhereQuery([
        { id: 102, deadStockItemId: 302, fromPharmacyId: 1, toPharmacyId: 2, quantity: 30, yakkaValue: '3000', drugName: '予約済み薬' },
        { id: 202, deadStockItemId: 402, fromPharmacyId: 2, toPharmacyId: 1, quantity: 50, yakkaValue: '5000', drugName: '相手薬' },
      ]),
      whereQuery([
        { id: 302, pharmacyId: 1, quantity: 100, unit: '錠', drugMasterPackageId: 502, packageQuantity: 10, packageUnit: '錠', isLoosePackage: false, yakkaUnitPrice: '100', isAvailable: true },
        { id: 402, pharmacyId: 2, quantity: 100, unit: '錠', drugMasterPackageId: 503, packageQuantity: 10, packageUnit: '錠', isLoosePackage: false, yakkaUnitPrice: '100', isAvailable: true },
      ]),
      groupByQuery([{ deadStockItemId: 302, reservedQty: 60 }]),
    ]);

    const response = await request(app)
      .post('/api/exchange/proposals/20/counter-offers/10/respond')
      .send({ decision: 'accepted' });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('利用可能在庫数');
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it('accepts a valid counter-offer and updates item, totals, and reservation together', async () => {
    const app = createApp();
    const { tx, updates } = setupTransaction([
      limitQuery([{
        id: 10,
        proposalId: 20,
        proposerPharmacyId: 1,
        responderPharmacyId: 2,
        status: 'pending',
        itemsJson: JSON.stringify([{ proposalItemId: 103, drugName: '箱単位薬', quantity: 200 }]),
      }]),
      limitQuery([proposal]),
      joinWhereQuery([
        { id: 103, deadStockItemId: 303, fromPharmacyId: 1, toPharmacyId: 2, quantity: 100, yakkaValue: '10000', drugName: '箱単位薬' },
        { id: 203, deadStockItemId: 403, fromPharmacyId: 2, toPharmacyId: 1, quantity: 200, yakkaValue: '20000', drugName: '相手薬' },
      ]),
      whereQuery([
        { id: 303, pharmacyId: 1, quantity: 300, unit: '錠', drugMasterPackageId: 504, packageQuantity: 100, packageUnit: '錠', isLoosePackage: false, yakkaUnitPrice: '100', isAvailable: true },
        { id: 403, pharmacyId: 2, quantity: 300, unit: '錠', drugMasterPackageId: 505, packageQuantity: 100, packageUnit: '錠', isLoosePackage: false, yakkaUnitPrice: '100', isAvailable: true },
      ]),
      groupByQuery([]),
    ]);

    const response = await request(app)
      .post('/api/exchange/proposals/20/counter-offers/10/respond')
      .send({ decision: 'accepted' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '反対提案を承認しました' });
    expect(tx.update).toHaveBeenCalledTimes(4);
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'accepted' }),
      expect.objectContaining({ quantity: 200, yakkaValue: '20000' }),
      expect.objectContaining({ reservedQuantity: 200 }),
      expect.objectContaining({ totalValueA: '20000', totalValueB: '20000', valueDifference: '0' }),
    ]));
    expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      pharmacyId: 1,
      type: 'proposal_status_changed',
      message: '相手薬局が反対提案を承認しました。',
      referenceId: 20,
    }));
    expect(mocks.createNotification).not.toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('山田太郎'),
    }));
  });
});
