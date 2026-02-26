import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRequest } from '../types';

const mocks = vi.hoisted(() => ({
  listMonthlyReports: vi.fn(),
  generateMonthlyReport: vi.fn(),
  getMonthlyReportById: vi.fn(),
  monthlyReportToCsv: vi.fn(),
  resolveDefaultTargetMonth: vi.fn(),
  validateYearMonth: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../services/monthly-report-service', () => ({
  listMonthlyReports: mocks.listMonthlyReports,
  generateMonthlyReport: mocks.generateMonthlyReport,
  getMonthlyReportById: mocks.getMonthlyReportById,
  monthlyReportToCsv: mocks.monthlyReportToCsv,
  resolveDefaultTargetMonth: mocks.resolveDefaultTargetMonth,
  validateYearMonth: mocks.validateYearMonth,
}));

vi.mock('../services/logger', () => ({
  logger: {
    error: mocks.loggerError,
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import adminReportsRouter from '../routes/admin-reports';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(((req, _res, next) => {
    (req as AuthRequest).user = { id: 77, email: 'admin@example.com', isAdmin: true };
    next();
  }) as express.RequestHandler);
  app.use('/api/admin', adminReportsRouter);
  return app;
}

describe('admin reports routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveDefaultTargetMonth.mockReturnValue({ year: 2026, month: 2 });
    mocks.validateYearMonth.mockReturnValue(undefined);
    mocks.monthlyReportToCsv.mockReturnValue('key,value\nmonth,2');
  });

  it('lists monthly reports with pagination payload', async () => {
    const app = createApp();
    mocks.listMonthlyReports.mockResolvedValue({
      data: [{ id: 1, year: 2026, month: 2, status: 'success', generatedBy: 77, generatedAt: '2026-03-01T00:00:00.000Z' }],
      total: 1,
    });

    const response = await request(app).get('/api/admin/reports/monthly').query({ page: 1, limit: 20 });

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('returns 400 for invalid generate params', async () => {
    const app = createApp();
    mocks.validateYearMonth.mockImplementation(() => {
      throw new Error('月の指定が不正です');
    });

    const response = await request(app)
      .post('/api/admin/reports/monthly/generate')
      .send({ year: 2026, month: 99 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '月の指定が不正です' });
  });

  it('generates monthly report with defaults and actor id', async () => {
    const app = createApp();
    mocks.generateMonthlyReport.mockResolvedValue({
      id: 12,
      year: 2026,
      month: 2,
      generatedAt: '2026-03-01T00:00:00.000Z',
      metrics: { proposalCount: 1 },
    });

    const response = await request(app)
      .post('/api/admin/reports/monthly/generate')
      .send({});

    expect(response.status).toBe(201);
    expect(mocks.generateMonthlyReport).toHaveBeenCalledWith(2026, 2, 77);
    expect(response.body.report).toEqual(expect.objectContaining({
      id: 12,
      year: 2026,
      month: 2,
    }));
  });

  it('downloads csv and json format and handles not found/id errors', async () => {
    const app = createApp();

    const invalid = await request(app).get('/api/admin/reports/monthly/abc/download');
    expect(invalid.status).toBe(400);

    mocks.getMonthlyReportById.mockResolvedValueOnce(null);
    const missing = await request(app).get('/api/admin/reports/monthly/5/download');
    expect(missing.status).toBe(404);

    mocks.getMonthlyReportById.mockResolvedValueOnce({
      id: 5,
      year: 2026,
      month: 2,
      status: 'success',
      generatedAt: '2026-03-01T00:00:00.000Z',
      reportJson: '{"year":2026,"month":2}',
    });
    const csv = await request(app).get('/api/admin/reports/monthly/5/download').query({ format: 'csv' });
    expect(csv.status).toBe(200);
    expect(csv.header['content-type']).toContain('text/csv');
    expect(String(csv.text)).toContain('key,value');

    mocks.getMonthlyReportById.mockResolvedValueOnce({
      id: 6,
      year: 2026,
      month: 3,
      status: 'success',
      generatedAt: '2026-04-01T00:00:00.000Z',
      reportJson: '{"year":2026,"month":3}',
    });
    const json = await request(app).get('/api/admin/reports/monthly/6/download');
    expect(json.status).toBe(200);
    expect(json.header['content-type']).toContain('application/json');
    expect(json.text).toBe('{"year":2026,"month":3}');
  });
});
