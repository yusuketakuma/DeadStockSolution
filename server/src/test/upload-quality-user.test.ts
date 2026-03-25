import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
}));

function mockUploadQualityRouteDependencies() {
  vi.doMock('../middleware/auth', () => ({
    requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
      req.user = { id: 1, email: 'test@example.com', isAdmin: false };
      next();
    },
    rejectAdmin: (_req: unknown, _res: unknown, next: () => void) => {
      next();
    },
  }));

  vi.doMock('../config/database', () => ({ db: mocks.db }));

  vi.doMock('../services/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));

  vi.doMock('drizzle-orm', () => {
    const sqlExpr = { as: (_alias: string) => ({}) };
    const sqlFn = Object.assign(
      (..._args: unknown[]) => sqlExpr,
      { raw: (..._args: unknown[]) => sqlExpr },
    );
    return {
      eq: vi.fn(() => ({})),
      and: vi.fn(() => ({})),
      desc: vi.fn(() => ({})),
      sql: sqlFn,
    };
  });

  vi.doMock('../utils/db-utils', () => ({
    rowCount: {},
  }));

  vi.doMock('../db/schema', () => ({
    uploadRowIssues: {
      id: 'id',
      jobId: 'jobId',
      pharmacyId: 'pharmacyId',
      uploadType: 'uploadType',
      rowNumber: 'rowNumber',
      issueCode: 'issueCode',
      issueMessage: 'issueMessage',
      createdAt: 'createdAt',
    },
  }));
}

/**
 * Build a chainable query mock where every known chain method returns itself,
 * and the last method resolves with the given result.
 * finalMethod: the name of the method that should return a Promise
 */
function chainableSelect(result: unknown, finalMethod = 'orderBy') {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainMethods = ['from', 'where', 'groupBy', 'orderBy', 'limit', 'offset'];
  for (const m of chainMethods) {
    if (m === finalMethod) {
      q[m] = vi.fn().mockResolvedValue(result);
    } else {
      q[m] = vi.fn().mockReturnValue(q);
    }
  }
  return q;
}

let uploadQualityRouter: express.Router;

beforeEach(async () => {
  vi.resetModules();
  mockUploadQualityRouteDependencies();
  ({ default: uploadQualityRouter } = await import('../routes/upload-quality'));
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/upload-quality', uploadQualityRouter);
  return app;
}

describe('upload-quality user routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /my-summary', () => {
    it('returns 200 with totalIssues and issuesByCode', async () => {
      const app = createApp();

      const issuesByCode = [
        { issueCode: 'MISSING_EXPIRY', count: 5 },
        { issueCode: 'INVALID_QUANTITY', count: 3 },
      ];

      // First select: issuesByCode — terminal is orderBy
      mocks.db.select.mockReturnValueOnce(chainableSelect(issuesByCode, 'orderBy'));
      // Second select: count — terminal is where
      mocks.db.select.mockReturnValueOnce(chainableSelect([{ count: 8 }], 'where'));

      const res = await request(app).get('/api/upload-quality/my-summary');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalIssues', 8);
      expect(res.body).toHaveProperty('issuesByCode');
      expect(Array.isArray(res.body.issuesByCode)).toBe(true);
      expect(res.body.issuesByCode).toHaveLength(2);
      expect(res.body.issuesByCode[0].issueCode).toBe('MISSING_EXPIRY');
    });

    it('returns 500 when db throws', async () => {
      const app = createApp();
      mocks.db.select.mockImplementationOnce(() => {
        throw new Error('DB error');
      });

      const res = await request(app).get('/api/upload-quality/my-summary');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /my-issues', () => {
    const sampleIssues = [
      {
        id: 1,
        jobId: 10,
        uploadType: 'dead_stock',
        rowNumber: 2,
        issueCode: 'MISSING_EXPIRY',
        issueMessage: '有効期限が未設定です',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        jobId: 10,
        uploadType: 'dead_stock',
        rowNumber: 3,
        issueCode: 'INVALID_QUANTITY',
        issueMessage: '数量が不正です',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    it('returns 200 with issues, total, page, limit', async () => {
      const app = createApp();

      // First select: issues — terminal is offset
      mocks.db.select.mockReturnValueOnce(chainableSelect(sampleIssues, 'offset'));
      // Second select: count — terminal is where
      mocks.db.select.mockReturnValueOnce(chainableSelect([{ count: 2 }], 'where'));

      const res = await request(app).get('/api/upload-quality/my-issues');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('issues');
      expect(Array.isArray(res.body.issues)).toBe(true);
      expect(res.body.issues).toHaveLength(2);
      expect(res.body).toHaveProperty('total', 2);
      expect(res.body).toHaveProperty('page', 1);
      expect(res.body).toHaveProperty('limit', 20);
    });

    it('returns correct pagination with custom page and limit', async () => {
      const app = createApp();

      mocks.db.select.mockReturnValueOnce(chainableSelect([sampleIssues[0]], 'offset'));
      mocks.db.select.mockReturnValueOnce(chainableSelect([{ count: 5 }], 'where'));

      const res = await request(app).get('/api/upload-quality/my-issues?page=2&limit=1');

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(2);
      expect(res.body.limit).toBe(1);
      expect(res.body.total).toBe(5);
    });

    it('filters by issueCode when provided', async () => {
      const app = createApp();

      const filtered = [sampleIssues[0]];
      mocks.db.select.mockReturnValueOnce(chainableSelect(filtered, 'offset'));
      mocks.db.select.mockReturnValueOnce(chainableSelect([{ count: 1 }], 'where'));

      const res = await request(app).get('/api/upload-quality/my-issues?issueCode=MISSING_EXPIRY');

      expect(res.status).toBe(200);
      expect(res.body.issues).toHaveLength(1);
      expect(res.body.issues[0].issueCode).toBe('MISSING_EXPIRY');
      expect(res.body.total).toBe(1);
    });

    it('returns 500 when db throws', async () => {
      const app = createApp();
      mocks.db.select.mockImplementationOnce(() => {
        throw new Error('DB error');
      });

      const res = await request(app).get('/api/upload-quality/my-issues');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });
});
