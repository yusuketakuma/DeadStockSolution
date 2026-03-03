import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseMhlwExcelData: vi.fn(),
  parseMhlwCsvData: vi.fn(),
  parsePackageExcelData: vi.fn(),
  parsePackageCsvData: vi.fn(),
  parsePackageXmlData: vi.fn(),
  parsePackageZipData: vi.fn(),
  decodeCsvBuffer: vi.fn(),
  syncDrugMaster: vi.fn(),
  syncPackageData: vi.fn(),
  getSyncLogs: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  triggerManualAutoSync: vi.fn(),
  getConfiguredSourceMode: vi.fn(),
  triggerManualPackageAutoSync: vi.fn(),
  getSourceStatesByPrefix: vi.fn(),
  parseExcelBuffer: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));

vi.mock('../services/drug-master-service', () => ({
  parseMhlwExcelData: mocks.parseMhlwExcelData,
  parseMhlwCsvData: mocks.parseMhlwCsvData,
  parsePackageExcelData: mocks.parsePackageExcelData,
  parsePackageCsvData: mocks.parsePackageCsvData,
  parsePackageXmlData: mocks.parsePackageXmlData,
  parsePackageZipData: mocks.parsePackageZipData,
  decodeCsvBuffer: mocks.decodeCsvBuffer,
  syncDrugMaster: mocks.syncDrugMaster,
  syncPackageData: mocks.syncPackageData,
  getSyncLogs: mocks.getSyncLogs,
  createSyncLog: mocks.createSyncLog,
  completeSyncLog: mocks.completeSyncLog,
}));

vi.mock('../services/drug-master-scheduler', () => ({
  triggerManualAutoSync: mocks.triggerManualAutoSync,
  getConfiguredSourceMode: mocks.getConfiguredSourceMode,
}));

vi.mock('../services/drug-package-scheduler', () => ({
  triggerManualPackageAutoSync: mocks.triggerManualPackageAutoSync,
}));

vi.mock('../services/drug-master-source-state-service', () => ({
  getSourceStatesByPrefix: mocks.getSourceStatesByPrefix,
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: mocks.parseExcelBuffer,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('../config/database', () => ({
  db: { select: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import drugMasterRouter from '../routes/drug-master';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/drug-master', (req, _res, next) => {
    (req as unknown as { user: { id: number; email: string; isAdmin: boolean } }).user = {
      id: 1, email: 'admin@example.com', isAdmin: true,
    };
    next();
  }, drugMasterRouter);
  return app;
}

describe('drug-master-sync route — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSyncLog.mockResolvedValue({ id: 100 });
    mocks.completeSyncLog.mockResolvedValue(undefined);
    mocks.writeLog.mockResolvedValue(undefined);
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  describe('POST /sync', () => {
    it('returns 400 when no file is provided', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/sync')
        .field('revisionDate', '2026-01-01');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('ファイルが必要');
    });

    it('syncs from CSV file', async () => {
      mocks.decodeCsvBuffer.mockReturnValue('yjCode,drugName\n1111111F1111,薬A');
      mocks.parseMhlwCsvData.mockReturnValue([{ yjCode: '1111111F1111', drugName: '薬A' }]);
      mocks.syncDrugMaster.mockResolvedValue({
        itemsProcessed: 1, itemsAdded: 1, itemsUpdated: 0, itemsDeleted: 0,
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/sync')
        .field('revisionDate', '2026-01-01')
        .attach('file', Buffer.from('csv-content'), {
          filename: 'data.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('同期が完了');
      expect(mocks.decodeCsvBuffer).toHaveBeenCalled();
      expect(mocks.parseMhlwCsvData).toHaveBeenCalled();
    });

    it('returns 400 when parsed rows are empty', async () => {
      mocks.parseExcelBuffer.mockResolvedValue([['Header']]);
      mocks.parseMhlwExcelData.mockReturnValue([]);

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/sync')
        .field('revisionDate', '2026-01-01')
        .attach('file', Buffer.from('dummy'), {
          filename: 'data.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('有効なデータ行');
    });

    it('returns 400 when parse throws an error', async () => {
      mocks.parseExcelBuffer.mockRejectedValue(new Error('Parse failure'));

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/sync')
        .field('revisionDate', '2026-01-01')
        .attach('file', Buffer.from('dummy'), {
          filename: 'data.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Parse failure');
    });

    it('returns 500 when sync fails', async () => {
      mocks.parseExcelBuffer.mockResolvedValue([['Header']]);
      mocks.parseMhlwExcelData.mockReturnValue([{ yjCode: '1111111F1111', drugName: '薬A' }]);
      mocks.syncDrugMaster.mockRejectedValue(new Error('Sync DB error'));

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/sync')
        .field('revisionDate', '2026-01-01')
        .attach('file', Buffer.from('dummy'), {
          filename: 'data.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('同期処理中にエラー');
    });
  });

  describe('POST /upload-packages', () => {
    it('returns 400 when no file is provided', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/upload-packages');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('ファイルが必要');
    });

    it('uploads package CSV data', async () => {
      mocks.decodeCsvBuffer.mockReturnValue('code,name\n12345,パッケージA');
      mocks.parsePackageCsvData.mockReturnValue([{ code: '12345', name: 'パッケージA' }]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/upload-packages')
        .attach('file', Buffer.from('csv'), {
          filename: 'packages.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('包装単位データの登録が完了');
    });

    it('returns 400 when parsed rows are empty', async () => {
      mocks.decodeCsvBuffer.mockReturnValue('');
      mocks.parsePackageCsvData.mockReturnValue([]);

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/upload-packages')
        .attach('file', Buffer.from('csv'), {
          filename: 'packages.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('有効なデータ行');
    });

    it('uploads package XML data', async () => {
      mocks.parsePackageXmlData.mockReturnValue([{ code: '12345', name: 'パッケージA' }]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/upload-packages')
        .attach('file', Buffer.from('<xml>data</xml>'), {
          filename: 'packages.xml',
          contentType: 'application/xml',
        });

      expect(res.status).toBe(200);
      expect(mocks.parsePackageXmlData).toHaveBeenCalled();
    });

    it('uploads package ZIP data', async () => {
      mocks.parsePackageZipData.mockReturnValue([{ code: '12345', name: 'パッケージA' }]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/upload-packages')
        .attach('file', Buffer.from('zipdata'), {
          filename: 'packages.zip',
          contentType: 'application/zip',
        });

      expect(res.status).toBe(200);
      expect(mocks.parsePackageZipData).toHaveBeenCalled();
    });
  });

  describe('GET /sync-logs', () => {
    it('returns sync logs', async () => {
      mocks.getSyncLogs.mockResolvedValue([{ id: 1, status: 'success' }]);

      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/sync-logs');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns 500 on error', async () => {
      mocks.getSyncLogs.mockRejectedValue(new Error('DB error'));

      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/sync-logs');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('同期ログの取得');
    });
  });

  describe('POST /auto-sync', () => {
    it('triggers auto sync', async () => {
      mocks.triggerManualAutoSync.mockResolvedValue({ triggered: true });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync')
        .send({ sourceUrl: 'https://example.com/data.csv' });

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(true);
      expect(mocks.writeLog).toHaveBeenCalled();
    });

    it('returns result when not triggered', async () => {
      mocks.triggerManualAutoSync.mockResolvedValue({ triggered: false, reason: 'already_running' });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(false);
    });

    it('returns 500 on error', async () => {
      mocks.triggerManualAutoSync.mockRejectedValue(new Error('sync error'));

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync')
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('自動取得の開始');
    });
  });

  describe('GET /auto-sync/status', () => {
    it('returns auto-sync status in single mode', async () => {
      mocks.getConfiguredSourceMode.mockReturnValue('single');

      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/status');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('enabled');
      expect(res.body).toHaveProperty('sourceMode', 'single');
    });

    it('returns auto-sync status in index mode with discovered files', async () => {
      mocks.getConfiguredSourceMode.mockReturnValue('index');
      mocks.getSourceStatesByPrefix.mockResolvedValue([
        { sourceKey: 'drug:index_page', url: 'https://example.com', lastCheckedAt: '2026-01-01T00:00:00Z', lastChangedAt: null },
        { sourceKey: 'drug:file:yakka', url: 'https://example.com/yakka.csv', lastCheckedAt: '2026-01-01T00:00:00Z', lastChangedAt: '2026-01-01T00:00:00Z' },
      ]);

      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/status');

      expect(res.status).toBe(200);
      expect(res.body.sourceMode).toBe('index');
      expect(res.body.discoveredFiles).toHaveLength(1);
      expect(res.body.lastIndexCheck).toBe('2026-01-01T00:00:00Z');
    });
  });

  describe('POST /auto-sync/packages', () => {
    it('triggers package auto sync', async () => {
      mocks.triggerManualPackageAutoSync.mockResolvedValue({ triggered: true });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync/packages')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(true);
    });

    it('returns 500 on error', async () => {
      mocks.triggerManualPackageAutoSync.mockRejectedValue(new Error('error'));

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync/packages')
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('包装単位データ自動取得');
    });
  });

  describe('GET /auto-sync/packages/status', () => {
    it('returns package auto-sync status', async () => {
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/packages/status');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('enabled');
    });
  });
});
