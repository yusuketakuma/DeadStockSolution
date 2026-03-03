import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseMhlwExcelData: vi.fn(() => []),
  parseMhlwCsvData: vi.fn(() => []),
  parsePackageExcelData: vi.fn(() => []),
  parsePackageCsvData: vi.fn(() => []),
  parsePackageXmlData: vi.fn(() => []),
  parsePackageZipData: vi.fn(async () => []),
  decodeCsvBuffer: vi.fn(() => 'csv-content'),
  syncDrugMaster: vi.fn(async () => ({ itemsProcessed: 10, itemsAdded: 5, itemsUpdated: 3, itemsDeleted: 2 })),
  syncPackageData: vi.fn(async () => ({ added: 3, updated: 1 })),
  getSyncLogs: vi.fn(async () => []),
  createSyncLog: vi.fn(async () => ({ id: 1 })),
  completeSyncLog: vi.fn(async () => undefined),
  triggerManualAutoSync: vi.fn(async () => ({ triggered: true, message: 'started' })),
  getConfiguredSourceMode: vi.fn(() => 'single'),
  triggerManualPackageAutoSync: vi.fn(async () => ({ triggered: true, message: 'started' })),
  getSourceStatesByPrefix: vi.fn(async () => []),
  parseExcelBuffer: vi.fn(async () => [['header'], ['row1']]),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import drugMasterSyncRouter from '../routes/drug-master-sync';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/drug-master', (req, _res, next) => {
    (req as unknown as { user: { id: number; email: string; isAdmin: boolean } }).user = {
      id: 1,
      email: 'admin@example.com',
      isAdmin: true,
    };
    next();
  }, drugMasterSyncRouter);
  return app;
}

const ORIGINAL_ENV = { ...process.env };

describe('drug-master-sync-route-ultra', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.parseMhlwExcelData.mockReturnValue([]);
    mocks.parseMhlwCsvData.mockReturnValue([]);
    mocks.parsePackageExcelData.mockReturnValue([]);
    mocks.parsePackageCsvData.mockReturnValue([]);
    mocks.parsePackageXmlData.mockReturnValue([]);
    mocks.parsePackageZipData.mockResolvedValue([]);
    mocks.decodeCsvBuffer.mockReturnValue('csv-content');
    mocks.syncDrugMaster.mockResolvedValue({ itemsProcessed: 10, itemsAdded: 5, itemsUpdated: 3, itemsDeleted: 2 });
    mocks.syncPackageData.mockResolvedValue({ added: 3, updated: 1 });
    mocks.getSyncLogs.mockResolvedValue([]);
    mocks.createSyncLog.mockResolvedValue({ id: 1 });
    mocks.completeSyncLog.mockResolvedValue(undefined);
    mocks.triggerManualAutoSync.mockResolvedValue({ triggered: true, message: 'started' });
    mocks.getConfiguredSourceMode.mockReturnValue('single');
    mocks.triggerManualPackageAutoSync.mockResolvedValue({ triggered: true, message: 'started' });
    mocks.getSourceStatesByPrefix.mockResolvedValue([]);
    mocks.parseExcelBuffer.mockResolvedValue([['header'], ['row1']]);
    mocks.writeLog.mockResolvedValue(undefined);
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  afterEach(() => {
    for (const key of [
      'DRUG_MASTER_SOURCE_URL', 'DRUG_MASTER_AUTO_SYNC', 'DRUG_MASTER_CHECK_INTERVAL_HOURS',
      'DRUG_PACKAGE_SOURCE_URL', 'DRUG_PACKAGE_AUTO_SYNC', 'DRUG_PACKAGE_CHECK_INTERVAL_HOURS',
    ]) {
      if (ORIGINAL_ENV[key] !== undefined) {
        process.env[key] = ORIGINAL_ENV[key];
      } else {
        delete process.env[key];
      }
    }
  });

  // ── POST /sync — sync failure with completeSyncLog also failing ──
  describe('POST /sync — sync error edge cases', () => {
    it('still returns 500 when completeSyncLog fails after sync failure', async () => {
      mocks.parseMhlwExcelData.mockReturnValueOnce([{ yjCode: '123456789012', drugName: 'test', yakkaPrice: 10 }] as never);
      mocks.syncDrugMaster.mockRejectedValueOnce(new Error('sync failed'));
      mocks.completeSyncLog.mockRejectedValueOnce(new Error('log update failed'));
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/sync')
        .attach('file', Buffer.from('dummy'), 'test.xlsx')
        .field('revisionDate', '2026-01-01');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('同期処理中にエラー');
    });

    it('logs import failure on sync failure', async () => {
      mocks.parseMhlwExcelData.mockReturnValueOnce([{ yjCode: '123456789012', drugName: 'test', yakkaPrice: 10 }] as never);
      mocks.syncDrugMaster.mockRejectedValueOnce(new Error('DB timeout'));
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/sync')
        .attach('file', Buffer.from('dummy'), 'test.xlsx')
        .field('revisionDate', '2026-01-01');
      expect(res.status).toBe(500);
      expect(mocks.writeLog).toHaveBeenCalled();
    });
  });

  // ── POST /sync — normalizeRevisionDate edge cases ──
  describe('POST /sync — revisionDate normalization', () => {
    it('trims whitespace from revisionDate', async () => {
      mocks.parseMhlwExcelData.mockReturnValueOnce([{ yjCode: '123456789012', drugName: 'test', yakkaPrice: 10 }] as never);
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/sync')
        .attach('file', Buffer.from('dummy'), 'test.xlsx')
        .field('revisionDate', ' 2026-01-01 ');
      expect(res.status).toBe(200);
    });

    it('rejects non-YYYY-MM-DD format after normalization', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/sync')
        .attach('file', Buffer.from('dummy'), 'test.xlsx')
        .field('revisionDate', '01/01/2026');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('YYYY-MM-DD');
    });

    it('rejects revisionDate with extra characters', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/sync')
        .attach('file', Buffer.from('dummy'), 'test.xlsx')
        .field('revisionDate', '2026-01-01T00:00:00');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('YYYY-MM-DD');
    });
  });

  // ── POST /upload-packages — parse error is not Error instance ──
  describe('POST /upload-packages — parse error edge cases', () => {
    it('returns generic message when parse error is not Error instance', async () => {
      mocks.parseExcelBuffer.mockRejectedValueOnce('string-error');
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/upload-packages')
        .attach('file', Buffer.from('dummy'), 'pkg.xlsx');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('ファイルのパースに失敗しました');
    });

    it('returns error message when parse error is Error instance', async () => {
      mocks.parseExcelBuffer.mockRejectedValueOnce(new Error('invalid format'));
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/upload-packages')
        .attach('file', Buffer.from('dummy'), 'pkg.xlsx');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid format');
    });
  });

  // ── POST /auto-sync — sourceMode handling ──
  describe('POST /auto-sync — sourceMode edge cases', () => {
    it('does not set sourceMode when value is not "single"', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync')
        .send({ sourceMode: 'index' });
      expect(res.status).toBe(200);
      expect(mocks.triggerManualAutoSync).toHaveBeenCalledWith(
        expect.objectContaining({ sourceMode: undefined }),
      );
    });

    it('does not log writeLog when triggered is false', async () => {
      mocks.triggerManualAutoSync.mockResolvedValueOnce({ triggered: false, message: 'not configured' });
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync')
        .send({});
      expect(res.status).toBe(200);
      expect(mocks.writeLog).not.toHaveBeenCalled();
    });

    it('logs with different detail when sourceUrl is provided', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync')
        .send({ sourceUrl: 'https://example.com/data.xlsx' });
      expect(res.status).toBe(200);
      expect(mocks.writeLog).toHaveBeenCalledWith(
        'drug_master_sync',
        expect.objectContaining({
          detail: expect.stringContaining('sourceUrl指定'),
        }),
      );
    });

    it('logs with default detail when sourceUrl is empty', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync')
        .send({ sourceUrl: '' });
      expect(res.status).toBe(200);
      expect(mocks.writeLog).toHaveBeenCalledWith(
        'drug_master_sync',
        expect.objectContaining({
          detail: expect.not.stringContaining('sourceUrl指定'),
        }),
      );
    });
  });

  // ── GET /auto-sync/status — resolveIntervalHours edge cases ──
  describe('GET /auto-sync/status — interval hours edge cases', () => {
    it('uses fallback when interval hours is negative', async () => {
      process.env.DRUG_MASTER_SOURCE_URL = '';
      process.env.DRUG_MASTER_AUTO_SYNC = 'false';
      process.env.DRUG_MASTER_CHECK_INTERVAL_HOURS = '-1';
      mocks.getConfiguredSourceMode.mockReturnValueOnce('single');
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/status');
      expect(res.status).toBe(200);
      expect(res.body.checkIntervalHours).toBe(24);
    });

    it('uses fallback when interval hours exceeds 30 days', async () => {
      process.env.DRUG_MASTER_SOURCE_URL = '';
      process.env.DRUG_MASTER_AUTO_SYNC = 'false';
      process.env.DRUG_MASTER_CHECK_INTERVAL_HOURS = '999';
      mocks.getConfiguredSourceMode.mockReturnValueOnce('single');
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/status');
      expect(res.status).toBe(200);
      expect(res.body.checkIntervalHours).toBe(24);
    });

    it('uses provided value when in valid range', async () => {
      process.env.DRUG_MASTER_SOURCE_URL = '';
      process.env.DRUG_MASTER_AUTO_SYNC = 'false';
      process.env.DRUG_MASTER_CHECK_INTERVAL_HOURS = '6';
      mocks.getConfiguredSourceMode.mockReturnValueOnce('single');
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/status');
      expect(res.status).toBe(200);
      expect(res.body.checkIntervalHours).toBe(6);
    });
  });

  // ── GET /auto-sync/status — resolveSourceHost edge cases ──
  describe('GET /auto-sync/status — sourceHost resolution', () => {
    it('returns hostname from valid URL', async () => {
      process.env.DRUG_MASTER_SOURCE_URL = 'https://www.mhlw.go.jp/test';
      process.env.DRUG_MASTER_AUTO_SYNC = 'true';
      mocks.getConfiguredSourceMode.mockReturnValueOnce('single');
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/status');
      expect(res.status).toBe(200);
      expect(res.body.sourceHost).toBe('www.mhlw.go.jp');
    });

    it('returns empty string when source URL is empty', async () => {
      process.env.DRUG_MASTER_SOURCE_URL = '';
      process.env.DRUG_MASTER_AUTO_SYNC = 'false';
      mocks.getConfiguredSourceMode.mockReturnValueOnce('single');
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/status');
      expect(res.status).toBe(200);
      expect(res.body.sourceHost).toBe('');
    });

    it('returns "invalid-url" when source URL is malformed', async () => {
      process.env.DRUG_MASTER_SOURCE_URL = 'not-a-valid-url';
      process.env.DRUG_MASTER_AUTO_SYNC = 'false';
      mocks.getConfiguredSourceMode.mockReturnValueOnce('single');
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/status');
      expect(res.status).toBe(200);
      expect(res.body.sourceHost).toBe('invalid-url');
    });
  });

  // ── GET /auto-sync/status — index mode with no index_page state ──
  describe('GET /auto-sync/status — index mode edge cases', () => {
    it('returns undefined lastIndexCheck when no index_page state', async () => {
      mocks.getConfiguredSourceMode.mockReturnValueOnce('index');
      mocks.getSourceStatesByPrefix.mockResolvedValueOnce([
        { sourceKey: 'drug:file:内用薬', url: 'http://file1', lastChangedAt: '2026-01-01' },
      ] as never);
      process.env.DRUG_MASTER_SOURCE_URL = 'https://example.com';
      process.env.DRUG_MASTER_AUTO_SYNC = 'true';
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/status');
      expect(res.status).toBe(200);
      expect(res.body.sourceMode).toBe('index');
      expect(res.body.lastIndexCheck).toBeUndefined();
      expect(res.body.discoveredFiles).toHaveLength(1);
    });

    it('returns empty discoveredFiles when no file states', async () => {
      mocks.getConfiguredSourceMode.mockReturnValueOnce('index');
      mocks.getSourceStatesByPrefix.mockResolvedValueOnce([
        { sourceKey: 'drug:index_page', lastCheckedAt: '2026-01-01', url: 'http://idx', lastChangedAt: null },
      ] as never);
      process.env.DRUG_MASTER_SOURCE_URL = 'https://example.com';
      process.env.DRUG_MASTER_AUTO_SYNC = 'true';
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/status');
      expect(res.status).toBe(200);
      expect(res.body.discoveredFiles).toHaveLength(0);
      expect(res.body.lastIndexCheck).toBe('2026-01-01');
    });
  });

  // ── POST /auto-sync/packages — edge cases ──
  describe('POST /auto-sync/packages — detail logging', () => {
    it('logs with sourceUrl detail when sourceUrl is provided', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync/packages')
        .send({ sourceUrl: 'https://example.com/pkg.zip' });
      expect(res.status).toBe(200);
      expect(mocks.writeLog).toHaveBeenCalledWith(
        'drug_master_package_upload',
        expect.objectContaining({
          detail: expect.stringContaining('sourceUrl指定'),
        }),
      );
    });

    it('logs without sourceUrl detail when sourceUrl is empty', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync/packages')
        .send({ sourceUrl: '' });
      expect(res.status).toBe(200);
      expect(mocks.writeLog).toHaveBeenCalledWith(
        'drug_master_package_upload',
        expect.objectContaining({
          detail: expect.not.stringContaining('sourceUrl指定'),
        }),
      );
    });

    it('does not log when triggered is false', async () => {
      mocks.triggerManualPackageAutoSync.mockResolvedValueOnce({ triggered: false, message: 'not configured' });
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync/packages')
        .send({});
      expect(res.status).toBe(200);
      expect(mocks.writeLog).not.toHaveBeenCalled();
    });

    it('handles non-string sourceUrl in body', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/drug-master/auto-sync/packages')
        .send({ sourceUrl: 12345 });
      expect(res.status).toBe(200);
      // sourceUrl should be treated as empty string when not a string
    });
  });

  // ── GET /auto-sync/packages/status — edge cases ──
  describe('GET /auto-sync/packages/status — interval edge cases', () => {
    it('uses fallback for NaN interval', async () => {
      process.env.DRUG_PACKAGE_CHECK_INTERVAL_HOURS = 'abc';
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/packages/status');
      expect(res.status).toBe(200);
      expect(res.body.checkIntervalHours).toBe(24);
    });

    it('uses fallback for zero interval', async () => {
      process.env.DRUG_PACKAGE_CHECK_INTERVAL_HOURS = '0';
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/packages/status');
      expect(res.status).toBe(200);
      expect(res.body.checkIntervalHours).toBe(24);
    });

    it('includes all autoSync status fields', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/pkg';
      process.env.DRUG_PACKAGE_AUTO_SYNC = 'true';
      process.env.DRUG_PACKAGE_CHECK_INTERVAL_HOURS = '8';
      const app = createApp();
      const res = await request(app).get('/api/admin/drug-master/auto-sync/packages/status');
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.hasSourceUrl).toBe(true);
      expect(res.body.checkIntervalHours).toBe(8);
      expect(res.body.supportsManualUrlOverride).toBe(true);
      expect(res.body.sourceHost).toBe('example.com');
    });
  });
});
