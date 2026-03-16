import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exportPharmaciesCsv: vi.fn(),
  exportExchangesCsv: vi.fn(),
  exportReportsCsv: vi.fn(),
  exportLogsCsv: vi.fn(),
  exportRiskCsv: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../services/csv-export-service', () => ({
  exportPharmaciesCsv: mocks.exportPharmaciesCsv,
  exportExchangesCsv: mocks.exportExchangesCsv,
  exportReportsCsv: mocks.exportReportsCsv,
  exportLogsCsv: mocks.exportLogsCsv,
  exportRiskCsv: mocks.exportRiskCsv,
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ipKeyGenerator: (ip: string) => ip,
}));

// admin.ts が全サブルーターを読み込むため、他の依存もモック
vi.mock('../config/database', () => ({
  db: { select: vi.fn(), update: vi.fn(), insert: vi.fn(), transaction: vi.fn() },
}));
vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));
vi.mock('../services/log-service', () => ({
  writeLog: vi.fn(),
  getClientIp: vi.fn(),
}));
vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: vi.fn(),
  isOpenClawConnectorConfigured: vi.fn(),
  isOpenClawWebhookConfigured: vi.fn(),
  getOpenClawImplementationBranch: vi.fn(),
}));
vi.mock('../services/openclaw-log-context-service', () => ({
  buildOpenClawLogContext: vi.fn(),
}));
vi.mock('../services/observability-service', () => ({
  getObservabilitySnapshot: vi.fn(),
}));
vi.mock('../services/proposal-timeline-service', () => ({
  buildProposalTimeline: vi.fn(),
  fetchProposalTimelineActionRows: vi.fn(),
}));
vi.mock('../services/matching-rule-service', () => ({
  getActiveMatchingRuleProfile: vi.fn(),
  updateActiveMatchingRuleProfile: vi.fn(),
}));
vi.mock('../services/audit-log-service', () => ({
  recordAuditLog: vi.fn(),
}));
vi.mock('../utils/path-utils', () => ({
  isSafeInternalPath: () => true,
  sanitizeInternalPath: (p: unknown) => p,
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: Object.assign((..._args: unknown[]) => ({}), { raw: (..._args: unknown[]) => ({}) }),
}));

import adminRouter from '../routes/admin';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin CSV Export Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /csv/pharmacies', () => {
    it('CSV ヘッダーを設定して薬局データを返す', async () => {
      mocks.exportPharmaciesCsv.mockImplementation(async (writer: { write: (s: string) => void }) => {
        writer.write('\uFEFFID,名前\r\n');
        writer.write('1,テスト薬局\r\n');
        return 1;
      });

      const app = createApp();
      const res = await request(app).get('/api/admin/csv/pharmacies');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('pharmacies-');
      expect(res.text).toContain('\uFEFF');
    });

    it('エクスポートエラー時に500を返す', async () => {
      mocks.exportPharmaciesCsv.mockRejectedValue(new Error('DB error'));

      const app = createApp();
      const res = await request(app).get('/api/admin/csv/pharmacies');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /csv/exchanges', () => {
    it('交換データCSVを返す', async () => {
      mocks.exportExchangesCsv.mockImplementation(async (writer: { write: (s: string) => void }) => {
        writer.write('\uFEFFID,ステータス\r\n');
        return 0;
      });

      const app = createApp();
      const res = await request(app).get('/api/admin/csv/exchanges');

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('exchanges-');
    });
  });

  describe('GET /csv/reports', () => {
    it('レポートCSVを返す', async () => {
      mocks.exportReportsCsv.mockImplementation(async (writer: { write: (s: string) => void }) => {
        writer.write('\uFEFFID,年,月\r\n');
        return 0;
      });

      const app = createApp();
      const res = await request(app).get('/api/admin/csv/reports');

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('reports-');
    });
  });
});
