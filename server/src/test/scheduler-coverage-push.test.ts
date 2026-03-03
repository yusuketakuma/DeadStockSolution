import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  syncDrugMaster: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  parseMhlwDrugFile: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
  validateExternalHttpsUrl: vi.fn(),
  createPinnedDnsAgent: vi.fn(),
  sha256: vi.fn(),
  persistSourceHeaders: vi.fn(),
  runMultiFileSync: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadFile: vi.fn(),
  // drug-package-scheduler specific
  parsePackageExcelData: vi.fn(),
  parsePackageCsvData: vi.fn(),
  parsePackageXmlData: vi.fn(),
  parsePackageZipData: vi.fn(),
  decodeCsvBuffer: vi.fn(),
  syncPackageData: vi.fn(),
  parseExcelBuffer: vi.fn(),
}));

vi.mock('../config/database', () => ({ db: {} }));

vi.mock('../services/drug-master-service', () => ({
  syncDrugMaster: mocks.syncDrugMaster,
  createSyncLog: mocks.createSyncLog,
  completeSyncLog: mocks.completeSyncLog,
  parsePackageExcelData: mocks.parsePackageExcelData,
  parsePackageCsvData: mocks.parsePackageCsvData,
  parsePackageXmlData: mocks.parsePackageXmlData,
  parsePackageZipData: mocks.parsePackageZipData,
  decodeCsvBuffer: mocks.decodeCsvBuffer,
  syncPackageData: mocks.syncPackageData,
}));

vi.mock('../services/drug-master-parser-service', () => ({
  parseMhlwDrugFile: mocks.parseMhlwDrugFile,
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: mocks.parseExcelBuffer,
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
    debug: mocks.loggerDebug,
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
  SOURCE_KEY_SINGLE: 'single',
  SOURCE_KEY_PACKAGE: 'package',
}));

vi.mock('../services/mhlw-multi-file-fetcher', () => ({
  runMultiFileSync: mocks.runMultiFileSync,
}));

vi.mock('../services/mhlw-source-fetch', () => ({
  checkForUpdates: mocks.checkForUpdates,
  downloadFile: mocks.downloadFile,
}));

const ORIGINAL_ENV = { ...process.env };

function setDefaultMocks() {
  mocks.validateExternalHttpsUrl.mockResolvedValue({
    ok: true,
    hostname: 'example.com',
    resolvedAddresses: ['1.2.3.4'],
  } as never);
  mocks.createPinnedDnsAgent.mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
  } as never);
  mocks.checkForUpdates.mockResolvedValue({
    hasUpdate: false,
    etag: null,
    lastModified: null,
    compareByContentHash: false,
    previousContentHash: null,
  } as never);
  mocks.downloadFile.mockResolvedValue({
    buffer: Buffer.from('file-data'),
    contentType: 'application/octet-stream',
  } as never);
  mocks.sha256.mockReturnValue('hash-abc');
  mocks.persistSourceHeaders.mockResolvedValue(undefined);
  mocks.runMultiFileSync.mockResolvedValue(undefined);
  mocks.createSyncLog.mockResolvedValue({ id: 42 } as never);
  mocks.completeSyncLog.mockResolvedValue(undefined);
  mocks.syncDrugMaster.mockResolvedValue({
    itemsProcessed: 10, itemsAdded: 5, itemsUpdated: 3, itemsDeleted: 2,
  } as never);
  mocks.parseMhlwDrugFile.mockResolvedValue([]);
  mocks.syncPackageData.mockResolvedValue({ added: 0, updated: 0 } as never);
  mocks.parsePackageExcelData.mockReturnValue([]);
  mocks.parsePackageCsvData.mockReturnValue([]);
  mocks.parsePackageXmlData.mockReturnValue([]);
  mocks.parsePackageZipData.mockResolvedValue([] as never);
  mocks.decodeCsvBuffer.mockReturnValue('csv-content');
  mocks.parseExcelBuffer.mockResolvedValue([]);
}

// ══════════════════════════════════════════════════════════
// drug-master-scheduler: uncovered paths
// ══════════════════════════════════════════════════════════

describe('drug-master-scheduler coverage-push', () => {
  let mod: typeof import('../services/drug-master-scheduler');

  beforeEach(async () => {
    vi.resetAllMocks();
    setDefaultMocks();
    mod = await import('../services/drug-master-scheduler');
    mod.stopDrugMasterScheduler();
  });

  afterEach(() => {
    mod.stopDrugMasterScheduler();
    process.env = { ...ORIGINAL_ENV };
  });

  // ── runAutoSyncWithSource: URL validation failure ──

  describe('runAutoSyncWithSource — URL validation failure', () => {
    it('logs error and returns when validateExternalHttpsUrl fails inside background task', async () => {
      // First call (in triggerManualAutoSync) succeeds; second call (in runAutoSyncWithSource) fails
      mocks.validateExternalHttpsUrl
        .mockResolvedValueOnce({
          ok: true,
          hostname: 'bad-host.example.com',
          resolvedAddresses: ['1.2.3.4'],
        } as never)
        .mockResolvedValueOnce({
          ok: false,
          reason: 'DNS resolution failed',
          hostname: null,
          resolvedAddresses: [],
        } as never);

      await mod.triggerManualAutoSync({
        sourceUrl: 'https://bad-host.example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      // The trigger returns immediately; background task runs
      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('source URL is invalid'),
          expect.objectContaining({ reason: 'DNS resolution failed' }),
        );
      });

      // Should NOT proceed to checkForUpdates
      expect(mocks.checkForUpdates).not.toHaveBeenCalled();
    });
  });

  // ── runAutoSyncWithSource: content hash comparison match ──

  describe('runAutoSyncWithSource — content hash match skips sync', () => {
    it('skips sync when content hash matches previous hash', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: true,
        previousContentHash: 'hash-abc',
      } as never);
      mocks.sha256.mockReturnValue('hash-abc');
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('same-content'),
        contentType: 'application/octet-stream',
      } as never);

      await mod.triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.loggerInfo).toHaveBeenCalledWith(
          expect.stringContaining('content-hash fallback'),
        );
        expect(mocks.persistSourceHeaders).toHaveBeenCalledWith(
          'single',
          'https://example.com/drugs.xlsx',
          expect.objectContaining({ contentHash: 'hash-abc' }),
          false,
        );
      });

      // Should NOT create a sync log
      expect(mocks.createSyncLog).not.toHaveBeenCalled();
    });
  });

  // ── runAutoSyncWithSource: empty parsed rows ──

  describe('runAutoSyncWithSource — empty parsed rows', () => {
    it('completes sync log as failed when no valid data rows found', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: '"e1"',
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.parseMhlwDrugFile.mockResolvedValue([] as never);

      await mod.triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(
          42,
          'failed',
          { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 },
          expect.stringContaining('有効なデータが見つかりません'),
        );
      });
    });
  });

  // ── runAutoSyncWithSource: sync error catch ──

  describe('runAutoSyncWithSource — sync error is caught', () => {
    it('completes sync log as failed when syncDrugMaster throws', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: '"e2"',
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.parseMhlwDrugFile.mockResolvedValue([
        { yjCode: '111', drugName: 'Test' },
      ] as never);
      mocks.syncDrugMaster.mockRejectedValue(new Error('DB connection lost'));

      await mod.triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(
          42,
          'failed',
          { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 },
          'DB connection lost',
        );
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('sync failed'),
          expect.objectContaining({ error: 'DB connection lost' }),
        );
      });
    });
  });

  // ── runAutoSyncWithSource: download failure (outer catch) ──

  describe('runAutoSyncWithSource — download failure', () => {
    it('logs error when downloadFile throws', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: '"e3"',
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockRejectedValue(new Error('Network timeout'));

      await mod.triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('check/download failed'),
          expect.objectContaining({ error: 'Network timeout' }),
        );
      });
    });
  });

  // ── triggerManualAutoSync: index mode when isRunning ──

  describe('triggerManualAutoSync — index mode isRunning guard', () => {
    it('returns not triggered when index sync is already running', async () => {
      vi.useFakeTimers();

      // Make runMultiFileSync hang to keep isRunning = true
      mocks.runMultiFileSync.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000)),
      );

      // First call: triggers index mode
      const first = await mod.triggerManualAutoSync({ sourceMode: 'index' });
      expect(first.triggered).toBe(true);

      // Let the background task start
      await vi.advanceTimersByTimeAsync(50);

      // Second call: should be blocked
      const second = await mod.triggerManualAutoSync({ sourceMode: 'index' });
      expect(second.triggered).toBe(false);
      expect(second.message).toContain('実行中');

      // Clean up
      await vi.advanceTimersByTimeAsync(1500);
      vi.useRealTimers();
    });
  });

  // ── runAutoSyncIndex: successful path ──

  describe('runAutoSyncIndex — successful multi-file sync', () => {
    it('calls runMultiFileSync and resets isRunning on success', async () => {
      mocks.runMultiFileSync.mockResolvedValue(undefined);

      const result = await mod.triggerManualAutoSync({ sourceMode: 'index' });
      expect(result.triggered).toBe(true);

      await vi.waitFor(() => {
        expect(mocks.runMultiFileSync).toHaveBeenCalled();
        expect(mocks.loggerInfo).toHaveBeenCalledWith(
          expect.stringContaining('index'),
        );
      });
    });
  });

  // ── runAutoSyncIndex: error path ──

  describe('runAutoSyncIndex — error from runMultiFileSync', () => {
    it('resets isRunning even when runMultiFileSync throws', async () => {
      mocks.runMultiFileSync.mockRejectedValue(new Error('multi-file error'));

      await mod.triggerManualAutoSync({ sourceMode: 'index' });

      // Wait for the error to be caught and isRunning to reset
      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('manual index trigger failed'),
          expect.objectContaining({ error: 'multi-file error' }),
        );
      });

      // isRunning should be reset, so a subsequent call should trigger
      const second = await mod.triggerManualAutoSync({ sourceMode: 'index' });
      expect(second.triggered).toBe(true);
    });
  });

  // ── runAutoSyncWithSource: full success path ──

  describe('runAutoSyncWithSource — full success path', () => {
    it('logs completion with statistics on successful sync', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: '"etag-success"',
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.parseMhlwDrugFile.mockResolvedValue([
        { yjCode: '111', drugName: 'DrugA' },
        { yjCode: '222', drugName: 'DrugB' },
      ] as never);
      mocks.syncDrugMaster.mockResolvedValue({
        itemsProcessed: 2, itemsAdded: 1, itemsUpdated: 1, itemsDeleted: 0,
      } as never);

      await mod.triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(
          42,
          'success',
          { itemsProcessed: 2, itemsAdded: 1, itemsUpdated: 1, itemsDeleted: 0 },
        );
        expect(mocks.loggerInfo).toHaveBeenCalledWith(
          expect.stringContaining('completed successfully'),
          expect.objectContaining({
            processed: 2,
            added: 1,
            updated: 1,
            deleted: 0,
          }),
        );
      });
    });
  });
});

// ══════════════════════════════════════════════════════════
// drug-package-scheduler: uncovered paths
// ══════════════════════════════════════════════════════════

describe('drug-package-scheduler coverage-push', () => {
  let mod: typeof import('../services/drug-package-scheduler');

  beforeEach(async () => {
    vi.resetAllMocks();
    setDefaultMocks();
    mod = await import('../services/drug-package-scheduler');
    mod.stopDrugPackageScheduler();
  });

  afterEach(() => {
    mod.stopDrugPackageScheduler();
    process.env = { ...ORIGINAL_ENV };
  });

  // ── shouldAttachSourceCredentials: no configured URL ──

  describe('buildSourceRequestHeaders — no configured URL', () => {
    it('returns only User-Agent when DRUG_PACKAGE_SOURCE_URL is not set', async () => {
      delete process.env.DRUG_PACKAGE_SOURCE_URL;
      process.env.DRUG_PACKAGE_SOURCE_AUTHORIZATION = 'Bearer token-ignored';

      // Trigger sync with an explicit URL (different from configured=empty)
      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://other.example.com/pkg.xml',
      });

      await vi.waitFor(() => {
        const callArgs = mocks.checkForUpdates.mock.calls[0];
        expect(callArgs[2].headers).toHaveProperty('User-Agent');
        expect(callArgs[2].headers).not.toHaveProperty('Authorization');
      });
    });
  });

  // ── shouldAttachSourceCredentials: invalid URL in catch branch ──

  describe('shouldAttachSourceCredentials — invalid URL parsing', () => {
    it('returns false when configured URL is malformed', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'not-a-valid-url';
      process.env.DRUG_PACKAGE_SOURCE_AUTHORIZATION = 'Bearer secret';

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/pkg.xml',
      });

      await vi.waitFor(() => {
        const callArgs = mocks.checkForUpdates.mock.calls[0];
        // Invalid configured URL causes catch branch → no credentials
        expect(callArgs[2].headers).not.toHaveProperty('Authorization');
      });
    });
  });

  // ── parseDownloadedPackageRows: CSV detection ──

  describe('parseDownloadedPackageRows — CSV format', () => {
    it('detects CSV by content-type and parses correctly', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('col1,col2\nval1,val2'),
        contentType: 'text/csv',
      } as never);
      mocks.decodeCsvBuffer.mockReturnValue('col1,col2\nval1,val2');
      mocks.parsePackageCsvData.mockReturnValue([
        { yjCode: '1234567890', gs1Code: null },
      ] as never);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.csv',
      });

      await vi.waitFor(() => {
        expect(mocks.decodeCsvBuffer).toHaveBeenCalled();
        expect(mocks.parsePackageCsvData).toHaveBeenCalledWith('col1,col2\nval1,val2');
        expect(mocks.syncPackageData).toHaveBeenCalled();
      });
    });

    it('detects CSV by .csv file extension when content-type is octet-stream', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('csv-data'),
        contentType: 'application/octet-stream',
      } as never);
      mocks.decodeCsvBuffer.mockReturnValue('csv-data');
      mocks.parsePackageCsvData.mockReturnValue([
        { yjCode: '9999999999', gs1Code: null },
      ] as never);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.csv',
      });

      await vi.waitFor(() => {
        expect(mocks.decodeCsvBuffer).toHaveBeenCalled();
        expect(mocks.parsePackageCsvData).toHaveBeenCalled();
      });
    });
  });

  // ── parseDownloadedPackageRows: XML detection ──

  describe('parseDownloadedPackageRows — XML format', () => {
    it('detects XML by content-type', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<root><item/></root>'),
        contentType: 'application/xml',
      } as never);
      mocks.parsePackageXmlData.mockReturnValue([
        { yjCode: '5555555555', gs1Code: null },
      ] as never);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xlsx',
      });

      await vi.waitFor(() => {
        expect(mocks.parsePackageXmlData).toHaveBeenCalledWith('<root><item/></root>');
      });
    });
  });

  // ── parseDownloadedPackageRows: Excel fallback ──

  describe('parseDownloadedPackageRows — Excel fallback', () => {
    it('falls back to Excel parsing when no CSV/XML/ZIP detected', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      // Use 'application/octet-stream' because content types containing 'xml'
      // (e.g. 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      // trigger the XML branch via contentType?.includes('xml').
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('excel-binary-data'),
        contentType: 'application/octet-stream',
      } as never);
      mocks.parseExcelBuffer.mockResolvedValue([
        ['YJCode', 'GS1'],
        ['8888888888', '4900000000000'],
      ] as never);
      mocks.parsePackageExcelData.mockReturnValue([
        { yjCode: '8888888888', gs1Code: '4900000000000' },
      ] as never);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      // URL must NOT end with .csv, .xml, or .zip to reach the Excel fallback
      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xlsx',
      });

      await vi.waitFor(() => {
        expect(mocks.parseExcelBuffer).toHaveBeenCalled();
        expect(mocks.parsePackageExcelData).toHaveBeenCalled();
        expect(mocks.syncPackageData).toHaveBeenCalled();
      });
    });
  });

  // ── runPackageAutoSyncWithSource: URL validation failure ──

  describe('runPackageAutoSyncWithSource — URL validation failure', () => {
    it('logs error and returns when validateExternalHttpsUrl fails inside background task', async () => {
      // First call (in triggerManualPackageAutoSync) succeeds; second call (in runPackageAutoSyncWithSource) fails
      mocks.validateExternalHttpsUrl
        .mockResolvedValueOnce({
          ok: true,
          hostname: 'internal.example.com',
          resolvedAddresses: ['10.0.0.1'],
        } as never)
        .mockResolvedValueOnce({
          ok: false,
          reason: 'SSRF blocked',
          hostname: null,
          resolvedAddresses: [],
        } as never);

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://internal.example.com/pkg.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('source URL is invalid'),
          expect.objectContaining({ reason: 'SSRF blocked' }),
        );
      });

      expect(mocks.checkForUpdates).not.toHaveBeenCalled();
    });
  });

  // ── runPackageAutoSyncWithSource: empty parsed rows ──

  describe('runPackageAutoSyncWithSource — empty parsed rows', () => {
    it('completes sync log as failed when no valid package rows found', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: '"pkg-e1"',
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<empty/>'),
        contentType: 'application/xml',
      } as never);
      mocks.parsePackageXmlData.mockReturnValue([] as never);

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(
          42,
          'failed',
          { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 },
          expect.stringContaining('有効な包装単位データが見つかりません'),
        );
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
          expect.stringContaining('no valid package rows'),
        );
      });
    });
  });

  // ── runPackageAutoSyncWithSource: sync error catch ──

  describe('runPackageAutoSyncWithSource — sync error catch', () => {
    it('completes sync log as failed when syncPackageData throws', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: '"pkg-e2"',
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<data>row</data>'),
        contentType: 'application/xml',
      } as never);
      mocks.parsePackageXmlData.mockReturnValue([
        { yjCode: '7777777777', gs1Code: null },
      ] as never);
      mocks.syncPackageData.mockRejectedValue(new Error('Unique constraint'));

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(
          42,
          'failed',
          { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 },
          'Unique constraint',
        );
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('sync failed'),
          expect.objectContaining({ error: 'Unique constraint' }),
        );
      });
    });
  });

  // ── runPackageAutoSyncWithSource: full success path ──

  describe('runPackageAutoSyncWithSource — full success', () => {
    it('persists headers and logs completion on successful sync', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: '"pkg-success"',
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<data>rows</data>'),
        contentType: 'application/xml',
      } as never);
      mocks.parsePackageXmlData.mockReturnValue([
        { yjCode: '1111', gs1Code: null },
        { yjCode: '2222', gs1Code: null },
        { yjCode: '3333', gs1Code: null },
      ] as never);
      mocks.syncPackageData.mockResolvedValue({ added: 2, updated: 1 } as never);

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(
          42,
          'success',
          expect.objectContaining({
            itemsProcessed: 3,
            itemsAdded: 2,
            itemsUpdated: 1,
          }),
        );
        expect(mocks.persistSourceHeaders).toHaveBeenCalledWith(
          'package',
          'https://example.com/packages.xml',
          expect.objectContaining({ contentHash: 'hash-abc' }),
          true,
        );
        expect(mocks.loggerInfo).toHaveBeenCalledWith(
          expect.stringContaining('completed successfully'),
          expect.objectContaining({
            processed: 3,
            added: 2,
            updated: 1,
          }),
        );
      });
    });
  });

  // ── runPackageAutoSyncWithSource: empty URL warning ──

  describe('runPackageAutoSyncWithSource — empty URL via env', () => {
    it('warns when source URL resolves to empty', async () => {
      delete process.env.DRUG_PACKAGE_SOURCE_URL;

      const result = await mod.triggerManualPackageAutoSync({ sourceUrl: '' });
      expect(result.triggered).toBe(false);
      expect(result.message).toContain('DRUG_PACKAGE_SOURCE_URL');
    });
  });

  // ── buildSourceRequestHeaders: Cookie only (no Authorization) ──

  describe('buildSourceRequestHeaders — Cookie only', () => {
    it('attaches only Cookie when Authorization is not set', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/pkg.xml';
      delete process.env.DRUG_PACKAGE_SOURCE_AUTHORIZATION;
      process.env.DRUG_PACKAGE_SOURCE_COOKIE = 'sid=abc123';

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/pkg.xml',
      });

      await vi.waitFor(() => {
        const callArgs = mocks.checkForUpdates.mock.calls[0];
        expect(callArgs[2].headers).toHaveProperty('Cookie', 'sid=abc123');
        expect(callArgs[2].headers).not.toHaveProperty('Authorization');
      });
    });
  });

  // ── runPackageAutoSyncWithSource: download failure ──

  describe('runPackageAutoSyncWithSource — download failure', () => {
    it('logs error when downloadFile throws', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: '"pkg-e3"',
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockRejectedValue(new Error('Socket hang up'));

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('check/download failed'),
          expect.objectContaining({ error: 'Socket hang up' }),
        );
      });
    });
  });

  // ── runPackageAutoSyncWithSource: content hash match ──

  describe('runPackageAutoSyncWithSource — content hash fallback', () => {
    it('skips sync when content hash matches', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: true,
        previousContentHash: 'hash-abc',
      } as never);
      mocks.sha256.mockReturnValue('hash-abc');

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.loggerInfo).toHaveBeenCalledWith(
          expect.stringContaining('content-hash fallback'),
        );
        expect(mocks.createSyncLog).not.toHaveBeenCalled();
      });
    });
  });

  // ── parseDownloadedPackageRows: text/plain as CSV ──

  describe('parseDownloadedPackageRows — text/plain detected as CSV', () => {
    it('treats text/plain content-type as CSV', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('a,b\n1,2'),
        contentType: 'text/plain',
      } as never);
      mocks.decodeCsvBuffer.mockReturnValue('a,b\n1,2');
      mocks.parsePackageCsvData.mockReturnValue([
        { yjCode: '6666666666', gs1Code: null },
      ] as never);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await mod.triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.txt',
      });

      await vi.waitFor(() => {
        expect(mocks.decodeCsvBuffer).toHaveBeenCalled();
        expect(mocks.parsePackageCsvData).toHaveBeenCalled();
      });
    });
  });
});
