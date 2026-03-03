import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  parsePackageExcelData: vi.fn().mockReturnValue([]),
  parsePackageCsvData: vi.fn().mockReturnValue([]),
  parsePackageXmlData: vi.fn().mockReturnValue([]),
  parsePackageZipData: vi.fn().mockResolvedValue([]),
  decodeCsvBuffer: vi.fn().mockReturnValue('csv-content'),
  syncPackageData: vi.fn().mockResolvedValue({ added: 0, updated: 0 }),
  createSyncLog: vi.fn().mockResolvedValue({ id: 99 }),
  completeSyncLog: vi.fn().mockResolvedValue(undefined),
  parseExcelBuffer: vi.fn().mockResolvedValue([]),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  validateExternalHttpsUrl: vi.fn().mockResolvedValue({
    ok: true,
    hostname: 'example.com',
    resolvedAddresses: ['1.2.3.4'],
  }),
  createPinnedDnsAgent: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
  }),
  sha256: vi.fn().mockReturnValue('hash-abc'),
  persistSourceHeaders: vi.fn().mockResolvedValue(undefined),
  checkForUpdates: vi.fn().mockResolvedValue({
    hasUpdate: false,
    etag: null,
    lastModified: null,
    compareByContentHash: false,
    previousContentHash: null,
  }),
  downloadFile: vi.fn().mockResolvedValue({
    buffer: Buffer.from('file-content'),
    contentType: 'application/xml',
  }),
}));

vi.mock('../config/database', () => ({ db: {} }));

vi.mock('../services/drug-master-service', () => ({
  parsePackageExcelData: mocks.parsePackageExcelData,
  parsePackageCsvData: mocks.parsePackageCsvData,
  parsePackageXmlData: mocks.parsePackageXmlData,
  parsePackageZipData: mocks.parsePackageZipData,
  decodeCsvBuffer: mocks.decodeCsvBuffer,
  syncPackageData: mocks.syncPackageData,
  createSyncLog: mocks.createSyncLog,
  completeSyncLog: mocks.completeSyncLog,
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: mocks.parseExcelBuffer,
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
    debug: vi.fn(),
  },
}));

vi.mock('../utils/network-utils', () => ({
  createPinnedDnsAgent: mocks.createPinnedDnsAgent,
  validateExternalHttpsUrl: mocks.validateExternalHttpsUrl,
}));

vi.mock('../utils/crypto-utils', () => ({
  sha256: mocks.sha256,
}));

vi.mock('../services/drug-master-source-state-service', () => ({
  persistSourceHeaders: mocks.persistSourceHeaders,
  SOURCE_KEY_PACKAGE: 'package',
}));

vi.mock('../services/mhlw-source-fetch', () => ({
  checkForUpdates: mocks.checkForUpdates,
  downloadFile: mocks.downloadFile,
}));

import {
  startDrugPackageScheduler,
  stopDrugPackageScheduler,
  triggerManualPackageAutoSync,
} from '../services/drug-package-scheduler';

const ORIGINAL_ENV = { ...process.env };

describe('drug-package-scheduler-deep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopDrugPackageScheduler();
    // Reset mocks to default happy-path state
    mocks.validateExternalHttpsUrl.mockResolvedValue({
      ok: true,
      hostname: 'example.com',
      resolvedAddresses: ['1.2.3.4'],
    });
    mocks.checkForUpdates.mockResolvedValue({
      hasUpdate: false,
      etag: null,
      lastModified: null,
      compareByContentHash: false,
      previousContentHash: null,
    });
  });

  afterEach(() => {
    stopDrugPackageScheduler();
    process.env = { ...ORIGINAL_ENV };
  });

  // ── runPackageAutoSyncWithSource flow (via triggerManualPackageAutoSync) ──

  describe('auto-sync full flow via manual trigger', () => {
    it('skips when no update is detected', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: false,
        etag: '"etag-old"',
        lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT',
        compareByContentHash: false,
        previousContentHash: null,
      });

      const result = await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xlsx',
      });
      expect(result.triggered).toBe(true);

      // Wait for the background task to settle
      await vi.waitFor(() => {
        expect(mocks.persistSourceHeaders).toHaveBeenCalledWith(
          'package',
          'https://example.com/packages.xlsx',
          expect.objectContaining({ hasUpdate: false }),
          false,
        );
      });
    });

    it('downloads and syncs when update is detected with XML content', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: '"etag-new"',
        lastModified: 'Tue, 02 Jan 2026 00:00:00 GMT',
        compareByContentHash: false,
        previousContentHash: null,
      });
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<xml>data</xml>'),
        contentType: 'application/xml',
      });
      mocks.parsePackageXmlData.mockReturnValue([
        { yjCode: '1234567890', gs1Code: 'GS1', janCode: null, hotCode: null, packageDescription: '10錠', packageQuantity: 10, packageUnit: '錠' },
      ]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 });

      const result = await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });
      expect(result.triggered).toBe(true);

      await vi.waitFor(() => {
        expect(mocks.parsePackageXmlData).toHaveBeenCalled();
        expect(mocks.syncPackageData).toHaveBeenCalled();
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(
          99,
          'success',
          expect.objectContaining({ itemsProcessed: 1, itemsAdded: 1 }),
        );
      });
    });

    it('downloads and syncs CSV content', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('col1,col2\nval1,val2'),
        contentType: 'text/csv',
      });
      mocks.parsePackageCsvData.mockReturnValue([
        { yjCode: '1111111111', gs1Code: null, janCode: 'JAN1', hotCode: null, packageDescription: '100錠', packageQuantity: 100, packageUnit: '錠' },
      ]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 });

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.csv',
      });

      await vi.waitFor(() => {
        expect(mocks.decodeCsvBuffer).toHaveBeenCalled();
        expect(mocks.parsePackageCsvData).toHaveBeenCalled();
        expect(mocks.syncPackageData).toHaveBeenCalled();
      });
    });

    it('downloads and syncs ZIP content', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('zipdata'),
        contentType: 'application/zip',
      });
      mocks.parsePackageZipData.mockResolvedValue([
        { yjCode: '2222222222', gs1Code: null, janCode: null, hotCode: 'HOT1', packageDescription: '50錠', packageQuantity: 50, packageUnit: '錠' },
      ]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 });

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.zip',
      });

      await vi.waitFor(() => {
        expect(mocks.parsePackageZipData).toHaveBeenCalled();
        expect(mocks.syncPackageData).toHaveBeenCalled();
      });
    });

    it('falls back to Excel parsing for unknown content type', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('excel-data'),
        contentType: 'application/octet-stream',
      });
      mocks.parseExcelBuffer.mockResolvedValue([['row1col1']]);
      mocks.parsePackageExcelData.mockReturnValue([
        { yjCode: '3333333333', gs1Code: null, janCode: null, hotCode: null, packageDescription: '20錠', packageQuantity: 20, packageUnit: '錠' },
      ]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 });

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xlsx',
      });

      await vi.waitFor(() => {
        expect(mocks.parseExcelBuffer).toHaveBeenCalled();
        expect(mocks.parsePackageExcelData).toHaveBeenCalled();
      });
    });

    it('logs failed sync when parsed rows are empty', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<xml></xml>'),
        contentType: 'application/xml',
      });
      mocks.parsePackageXmlData.mockReturnValue([]);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(
          99,
          'failed',
          expect.objectContaining({ itemsProcessed: 0 }),
          expect.stringContaining('包装単位'),
        );
      });
    });

    it('logs error when syncPackageData throws', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<xml>data</xml>'),
        contentType: 'application/xml',
      });
      mocks.parsePackageXmlData.mockReturnValue([
        { yjCode: '4444444444', gs1Code: null, janCode: null, hotCode: null, packageDescription: '10', packageQuantity: 10, packageUnit: '錠' },
      ]);
      mocks.syncPackageData.mockRejectedValue(new Error('DB connection failed'));

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(
          99,
          'failed',
          expect.objectContaining({ itemsProcessed: 0 }),
          'DB connection failed',
        );
      });
    });

    it('skips download when content-hash fallback detects no change', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: true,
        previousContentHash: 'hash-abc',
      });
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('same-content'),
        contentType: 'application/xml',
      });
      // sha256 returns 'hash-abc' by default, same as previousContentHash
      mocks.sha256.mockReturnValue('hash-abc');

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.persistSourceHeaders).toHaveBeenCalledWith(
          'package',
          'https://example.com/packages.xml',
          expect.objectContaining({ contentHash: 'hash-abc' }),
          false,
        );
        // Should NOT call createSyncLog because no actual update
        expect(mocks.createSyncLog).not.toHaveBeenCalled();
      });
    });

    it('handles invalid source URL during auto-sync', async () => {
      mocks.validateExternalHttpsUrl.mockResolvedValue({
        ok: false,
        reason: 'DNS resolution failed',
        hostname: null,
        resolvedAddresses: [],
      });

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://invalid.example.com/packages.xml',
      });

      // The triggerManualPackageAutoSync validates separately and will return not triggered
      // because the validation happens before background task
    });

    it('returns not triggered when already running', async () => {
      vi.useFakeTimers();
      // Trigger a sync that takes a while
      mocks.checkForUpdates.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
      );

      const first = await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });
      expect(first.triggered).toBe(true);

      // Wait a tick for the background task to start
      await vi.advanceTimersByTimeAsync(50);

      const second = await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });
      expect(second.triggered).toBe(false);
      expect(second.message).toContain('実行中');

      // Wait for the background task to complete to reset isRunning state
      await vi.advanceTimersByTimeAsync(600);
      vi.useRealTimers();
    });

    it('closes pinned agent on error', async () => {
      const closeAgent = vi.fn().mockResolvedValue(undefined);
      mocks.createPinnedDnsAgent.mockReturnValue({ close: closeAgent });
      mocks.checkForUpdates.mockRejectedValue(new Error('network error'));

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(closeAgent).toHaveBeenCalled();
      }, { timeout: 5000 });
    });

    it('handles close() rejection gracefully', async () => {
      const closeAgent = vi.fn().mockRejectedValue(new Error('close failed'));
      mocks.createPinnedDnsAgent.mockReturnValue({ close: closeAgent });
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: false,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(closeAgent).toHaveBeenCalled();
      }, { timeout: 5000 });
    });
  });

  // ── buildSourceRequestHeaders ──

  describe('source credential headers', () => {
    it('attaches Authorization when DRUG_PACKAGE_SOURCE_AUTHORIZATION is set', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/packages.xml';
      process.env.DRUG_PACKAGE_SOURCE_AUTHORIZATION = 'Bearer token123';

      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: false,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        const callArgs = mocks.checkForUpdates.mock.calls[0];
        expect(callArgs[2].headers).toHaveProperty('Authorization', 'Bearer token123');
      });
    });

    it('attaches Cookie when DRUG_PACKAGE_SOURCE_COOKIE is set', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/packages.xml';
      process.env.DRUG_PACKAGE_SOURCE_COOKIE = 'session=abc123';

      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: false,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        const callArgs = mocks.checkForUpdates.mock.calls[0];
        expect(callArgs[2].headers).toHaveProperty('Cookie', 'session=abc123');
      });
    });

    it('does not attach credentials when request URL differs from configured source', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://other.com/packages.xml';
      process.env.DRUG_PACKAGE_SOURCE_AUTHORIZATION = 'Bearer secret';

      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: false,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        const callArgs = mocks.checkForUpdates.mock.calls[0];
        expect(callArgs[2].headers).not.toHaveProperty('Authorization');
      });
    });
  });

  // ── Scheduler start/stop behavior ──
  // Note: AUTO_SYNC_ENABLED is evaluated at module import time, so we cannot
  // change it in runtime tests. The existing coverage test file already covers
  // startDrugPackageScheduler paths. Here we focus on stop behavior.

  describe('scheduler stop behavior', () => {
    it('stopDrugPackageScheduler is idempotent', () => {
      stopDrugPackageScheduler();
      stopDrugPackageScheduler();
      // Should not throw
    });
  });

  // ── triggerManualPackageAutoSync edge cases ──

  describe('triggerManualPackageAutoSync edge cases', () => {
    it('returns fallback reason when validation fails without specific reason', async () => {
      mocks.validateExternalHttpsUrl.mockResolvedValue({
        ok: false,
        reason: null,
        hostname: null,
        resolvedAddresses: [],
      });

      const result = await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });
      expect(result.triggered).toBe(false);
      expect(result.message).toContain('不正');
    });

    it('trims whitespace from sourceUrl option', async () => {
      const result = await triggerManualPackageAutoSync({
        sourceUrl: '  https://example.com/packages.xml  ',
      });
      expect(result.triggered).toBe(true);
    });

    it('falls back to env DRUG_PACKAGE_SOURCE_URL when sourceUrl is empty string', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/env-url.xml';

      const result = await triggerManualPackageAutoSync({
        sourceUrl: '   ',
      });
      expect(result.triggered).toBe(true);
    });

    it('returns not triggered when sourceUrl is null and env is not set', async () => {
      delete process.env.DRUG_PACKAGE_SOURCE_URL;

      const result = await triggerManualPackageAutoSync({
        sourceUrl: null,
      });
      expect(result.triggered).toBe(false);
    });
  });
});
