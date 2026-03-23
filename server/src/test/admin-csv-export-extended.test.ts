import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exportPharmaciesCsv: vi.fn(),
  exportExchangesCsv: vi.fn(),
  exportReportsCsv: vi.fn(),
  exportLogsCsv: vi.fn(),
  exportRiskCsv: vi.fn(),
  exportProposalsCsv: vi.fn(),
  exportAuditLogsCsv: vi.fn(),
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
  exportProposalsCsv: mocks.exportProposalsCsv,
  exportAuditLogsCsv: mocks.exportAuditLogsCsv,
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ipKeyGenerator: (ip: string) => ip,
}));

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

describe('Admin CSV Export Extended Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /csv/proposals', () => {
    it('200 を返し CSV ヘッダーを設定する', async () => {
      mocks.exportProposalsCsv.mockImplementation(async (writer: { write: (s: string) => void }) => {
        writer.write('\uFEFFID,提案元薬局ID,提案元薬局名,提案先薬局ID,提案先薬局名,ステータス,提案元合計金額,提案先合計金額,差額,提案完了合計金額,提案日,完了日\r\n');
        return 0;
      });

      const app = createApp();
      const res = await request(app).get('/api/admin/csv/proposals');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('proposals-');
      expect(res.text).toContain('提案元薬局名');
    });

    it('エクスポートエラー時に 500 を返す', async () => {
      mocks.exportProposalsCsv.mockRejectedValue(new Error('DB error'));

      const app = createApp();
      const res = await request(app).get('/api/admin/csv/proposals');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /csv/audit-logs', () => {
    it('200 を返し CSV ヘッダーを設定する', async () => {
      mocks.exportAuditLogsCsv.mockImplementation(async (writer: { write: (s: string) => void }) => {
        writer.write('\uFEFFID,管理者ID,管理者名,アクション,対象薬局ID,対象薬局名,変更前ステータス,変更後ステータス,理由,実行日時\r\n');
        return 0;
      });

      const app = createApp();
      const res = await request(app).get('/api/admin/csv/audit-logs');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('audit-logs-');
      expect(res.text).toContain('管理者名');
    });

    it('エクスポートエラー時に 500 を返す', async () => {
      mocks.exportAuditLogsCsv.mockRejectedValue(new Error('DB error'));

      const app = createApp();
      const res = await request(app).get('/api/admin/csv/audit-logs');

      expect(res.status).toBe(500);
    });
  });
});
