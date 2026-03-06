import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  sanitizeInternalPath: vi.fn((path: string) => path),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number } }, _res: unknown, next: () => void) => {
    req.user = { id: 1 };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../config/database', () => ({
  db: {
    select: mocks.dbSelect,
  },
}));

vi.mock('../utils/path-utils', () => ({
  sanitizeInternalPath: mocks.sanitizeInternalPath,
}));

vi.mock('../routes/admin-utils', () => ({
  parseListPagination: () => ({ page: 1, limit: 20, offset: 0 }),
  sendPaginated: (res: express.Response, rows: unknown[], page: number, limit: number, total: number, extra?: Record<string, unknown>) => {
    res.json({ data: rows, pagination: { page, limit, total }, ...(extra ?? {}) });
  },
  handleAdminError: (_err: unknown, _log: string, message: string, res: express.Response) => {
    res.status(500).json({ error: message });
  },
}));

vi.mock('../services/openclaw-service', () => ({
  getOpenClawImplementationBranch: () => 'main',
  isOpenClawConnectorConfigured: () => true,
  isOpenClawWebhookConfigured: () => true,
}));

vi.mock('../utils/db-utils', () => ({ rowCount: 1 }));

vi.mock('drizzle-orm', () => ({
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
}));

import router from '../routes/admin-pharmacies-list';

function createApp() {
  const app = express();
  app.use('/api/admin', router);
  return app;
}

function paginatedQuery(rows: unknown[]) {
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

function fromQuery(rows: unknown[]) {
  return {
    from: vi.fn().mockResolvedValue(rows),
  };
}

function whereQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(rows);
  return query;
}

describe('admin-pharmacies-list extra branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sanitizeInternalPath.mockImplementation((path: string) => path);
  });

  it('GET /history handles empty history without pharmacy lookup query', async () => {
    const app = createApp();
    mocks.dbSelect
      .mockImplementationOnce(() => paginatedQuery([]))
      .mockImplementationOnce(() => fromQuery([{ count: 0 }]));

    const res = await request(app).get('/api/admin/history');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(mocks.dbSelect).toHaveBeenCalledTimes(2);
  });

  it('GET /messages maps unsafe actionPath to null', async () => {
    const app = createApp();
    mocks.sanitizeInternalPath.mockImplementationOnce(() => null as unknown as string);
    mocks.dbSelect
      .mockImplementationOnce(() => paginatedQuery([
        { id: 1, actionPath: '/unsafe', createdAt: '2026-01-01' },
      ]))
      .mockImplementationOnce(() => fromQuery([{ count: 1 }]));

    const res = await request(app).get('/api/admin/messages');

    expect(res.status).toBe(200);
    expect(res.body.data[0].actionPath).toBeNull();
  });

  it('GET /history falls back to empty string when pharmacy name is missing', async () => {
    const app = createApp();
    mocks.dbSelect
      .mockImplementationOnce(() => paginatedQuery([
        { id: 9, proposalId: 11, pharmacyAId: 2, pharmacyBId: 3, totalValue: '0', completedAt: '2026-01-01' },
      ]))
      .mockImplementationOnce(() => whereQuery([
        { id: 2, name: '薬局A' },
      ]))
      .mockImplementationOnce(() => fromQuery([{ count: 1 }]));

    const res = await request(app).get('/api/admin/history');

    expect(res.status).toBe(200);
    expect(res.body.data[0].pharmacyAName).toBe('薬局A');
    expect(res.body.data[0].pharmacyBName).toBe('');
  });
});
