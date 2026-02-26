import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: mocks.and,
  desc: mocks.desc,
  eq: mocks.eq,
  gte: mocks.gte,
  lt: mocks.lt,
  lte: mocks.lte,
  sql: mocks.sql,
}));

import {
  buildMonthlyReportMetrics,
  getMonthlyReportById,
  listMonthlyReports,
  monthlyReportToCsv,
  resolveDefaultTargetMonth,
  validateYearMonth,
} from '../services/monthly-report-service';

function createWhereQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

function createListQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockResolvedValue(rows);
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

function createFromResolvedQuery(result: unknown) {
  const query = {
    from: vi.fn(),
  };
  query.from.mockResolvedValue(result);
  return query;
}

describe('monthly-report-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds metrics and counts near-expiry items up to day 120 (inclusive)', async () => {
    vi.setSystemTime(new Date('2026-03-01T15:00:00.000Z'));

    mocks.db.select
      .mockImplementationOnce(() => createWhereQuery([{ count: 10 }])) // proposals
      .mockImplementationOnce(() => createWhereQuery([{ count: 2 }])) // rejected
      .mockImplementationOnce(() => createWhereQuery([{ count: 3 }])) // confirmed
      .mockImplementationOnce(() => createWhereQuery([{ count: 4 }])) // completed
      .mockImplementationOnce(() => createWhereQuery([{ total: 12345.67 }])) // exchange total
      .mockImplementationOnce(() => createWhereQuery([{ count: 5 }])) // upload
      .mockImplementationOnce(() => createWhereQuery([{ count: 6 }])) // dead stock upload
      .mockImplementationOnce(() => createWhereQuery([{ count: 7 }])) // used med upload
      .mockImplementationOnce(() => createWhereQuery([{ count: 8 }])) // near expiry
      .mockImplementationOnce(() => createWhereQuery([{ count: 1 }])) // expired
    ;

    const metrics = await buildMonthlyReportMetrics(2026, 2);
    const todayDate = new Date(Date.UTC(2026, 2, 1));
    const expectedNearExpiryLimit = new Date(
      todayDate.getTime() + (120 * 24 * 60 * 60 * 1000),
    ).toISOString().slice(0, 10);

    expect(mocks.lte).toHaveBeenCalledWith(expect.anything(), expectedNearExpiryLimit);
    expect(metrics).toEqual(expect.objectContaining({
      year: 2026,
      month: 2,
      proposalCount: 10,
      rejectedProposalCount: 2,
      confirmedProposalCount: 3,
      completedExchangeCount: 4,
      totalExchangeValue: 12345.67,
      uploadCount: 5,
      deadStockUploadCount: 6,
      usedMedicationUploadCount: 7,
      nearExpiryItemCount: 8,
      expiredItemCount: 1,
    }));
  });

  it('validates year/month boundaries and resolves default target month', () => {
    expect(resolveDefaultTargetMonth(new Date('2026-01-05T00:00:00.000Z'))).toEqual({ year: 2025, month: 12 });
    expect(resolveDefaultTargetMonth(new Date('2026-04-05T00:00:00.000Z'))).toEqual({ year: 2026, month: 3 });

    expect(() => validateYearMonth(1999, 12)).toThrow('年の指定が不正です');
    expect(() => validateYearMonth(2026, 13)).toThrow('月の指定が不正です');
  });

  it('exports csv with proper escaping', () => {
    const csv = monthlyReportToCsv({
      year: 2026,
      month: 2,
      periodStart: '2026-02-01T00:00:00.000Z',
      periodEnd: '2026-03-01T00:00:00.000Z',
      proposalCount: 1,
      completedExchangeCount: 2,
      rejectedProposalCount: 3,
      confirmedProposalCount: 4,
      totalExchangeValue: 5,
      uploadCount: 6,
      deadStockUploadCount: 7,
      usedMedicationUploadCount: 8,
      nearExpiryItemCount: 9,
      expiredItemCount: 10,
    });

    expect(csv.startsWith('key,value')).toBe(true);
    expect(csv).toContain('nearExpiryItemCount,9');
    expect(csv).toContain('periodStart,2026-02-01T00:00:00.000Z');
  });

  it('lists reports with pagination and finds report by id', async () => {
    const rows = [{
      id: 10,
      year: 2026,
      month: 2,
      status: 'success',
      generatedBy: 1,
      generatedAt: '2026-03-01T00:00:00.000Z',
    }];
    mocks.db.select
      .mockImplementationOnce(() => createListQuery(rows))
      .mockImplementationOnce(() => createFromResolvedQuery([{ count: 3 }]));

    const list = await listMonthlyReports(2, 1);
    expect(list).toEqual({
      data: rows,
      total: 3,
    });

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([
      {
        id: 10,
        year: 2026,
        month: 2,
        status: 'success',
        generatedAt: '2026-03-01T00:00:00.000Z',
        reportJson: '{"k":"v"}',
      },
    ]));
    const report = await getMonthlyReportById(10);
    expect(report).toEqual(expect.objectContaining({
      id: 10,
      reportJson: '{"k":"v"}',
    }));
  });
});
