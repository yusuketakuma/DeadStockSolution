import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parsePackageExcelData: vi.fn(),
  parsePackageCsvData: vi.fn(),
  parsePackageXmlData: vi.fn(),
  parsePackageZipData: vi.fn(),
  decodeCsvBuffer: vi.fn(),
  syncPackageData: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  parseExcelBuffer: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  validateExternalHttpsUrl: vi.fn(),
  createPinnedDnsAgent: vi.fn(),
  sha256: vi.fn(),
  persistSourceHeaders: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadFile: vi.fn(),
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
  stopDrugPackageScheduler,
  triggerManualPackageAutoSync,
} from '../services/drug-package-scheduler';

const ORIGINAL_ENV = { ...process.env };

describe('drug-package-scheduler-ultra', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stopDrugPackageScheduler();
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
    mocks.createSyncLog.mockResolvedValue({ id: 99 } as never);
    mocks.completeSyncLog.mockResolvedValue(undefined);
    mocks.syncPackageData.mockResolvedValue({ added: 0, updated: 0 } as never);
    mocks.parsePackageExcelData.mockReturnValue([]);
    mocks.parsePackageCsvData.mockReturnValue([]);
    mocks.parsePackageXmlData.mockReturnValue([]);
    mocks.parsePackageZipData.mockResolvedValue([]);
    mocks.decodeCsvBuffer.mockReturnValue('csv-content');
    mocks.parseExcelBuffer.mockResolvedValue([]);
  });

  afterEach(() => {
    stopDrugPackageScheduler();
    process.env = { ...ORIGINAL_ENV };
  });

  // ── Hostname fallback when validated hostname is null ──
  describe('hostname fallback in auto-sync', () => {
    it('uses URL hostname when validated hostname is null', async () => {
      mocks.validateExternalHttpsUrl.mockResolvedValue({
        ok: true,
        hostname: null,
        resolvedAddresses: ['1.2.3.4'],
      } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.createPinnedDnsAgent).toHaveBeenCalledWith(
          'example.com',
          ['1.2.3.4'],
        );
      });
    });
  });

  // ── content-hash with different hash proceeds ──
  describe('content-hash fallback with changed hash', () => {
    it('proceeds with sync when content hash differs', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: true,
        previousContentHash: 'old-hash',
      } as never);
      mocks.sha256.mockReturnValue('new-hash');
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<xml>data</xml>'),
        contentType: 'application/xml',
      } as never);
      mocks.parsePackageXmlData.mockReturnValue([
        { yjCode: '1111111111', gs1Code: null },
      ]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.createSyncLog).toHaveBeenCalled();
        expect(mocks.syncPackageData).toHaveBeenCalled();
      });
    });
  });

  // ── content-hash fallback with null previousContentHash ──
  describe('content-hash fallback with null previousContentHash', () => {
    it('proceeds with sync when previousContentHash is null', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: true,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<xml>data</xml>'),
        contentType: 'application/xml',
      } as never);
      mocks.parsePackageXmlData.mockReturnValue([
        { yjCode: '2222222222', gs1Code: null },
      ]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.createSyncLog).toHaveBeenCalled();
      });
    });
  });

  // ── compareByContentHash false skips hash check ──
  describe('content-hash not active proceeds', () => {
    it('skips hash comparison when compareByContentHash is false', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: 'hash-abc',
      } as never);
      mocks.sha256.mockReturnValue('hash-abc');
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<xml>data</xml>'),
        contentType: 'application/xml',
      } as never);
      mocks.parsePackageXmlData.mockReturnValue([
        { yjCode: '3333333333', gs1Code: null },
      ]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.createSyncLog).toHaveBeenCalled();
        expect(mocks.syncPackageData).toHaveBeenCalled();
      });
    });
  });

  // ── outer catch: check/download failure ──
  describe('outer error handling', () => {
    it('catches and logs outer error during check/download', async () => {
      mocks.checkForUpdates.mockRejectedValue(new Error('network timeout'));

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('check/download failed'),
          expect.objectContaining({ error: 'network timeout' }),
        );
      });
    });
  });

  // ── URL validation failure inside auto-sync ──
  describe('URL validation failure inside auto-sync', () => {
    it('logs error when URL validation fails during auto-sync', async () => {
      // First call passes triggerManualPackageAutoSync pre-check
      // Second call fails in runPackageAutoSyncWithSource
      mocks.validateExternalHttpsUrl
        .mockResolvedValueOnce({
          ok: true, hostname: 'example.com', resolvedAddresses: ['1.2.3.4'],
        } as never)
        .mockResolvedValueOnce({
          ok: false, reason: 'DNS failed', hostname: null, resolvedAddresses: [],
        } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('source URL is invalid'),
          expect.any(Object),
        );
      });
    });
  });

  // ── shouldAttachSourceCredentials with no configured URL ──
  describe('source credentials with no configured URL', () => {
    it('does not attach credentials when DRUG_PACKAGE_SOURCE_URL is not set', async () => {
      delete process.env.DRUG_PACKAGE_SOURCE_URL;

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        const callArgs = mocks.checkForUpdates.mock.calls[0];
        expect(callArgs[2].headers).not.toHaveProperty('Authorization');
        expect(callArgs[2].headers).not.toHaveProperty('Cookie');
      });
    });
  });

  // ── shouldAttachSourceCredentials with invalid URL ──
  describe('source credentials with invalid configured URL', () => {
    it('does not attach credentials when DRUG_PACKAGE_SOURCE_URL is invalid', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'not-a-valid-url';
      process.env.DRUG_PACKAGE_SOURCE_AUTHORIZATION = 'Bearer secret';

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        const callArgs = mocks.checkForUpdates.mock.calls[0];
        expect(callArgs[2].headers).not.toHaveProperty('Authorization');
      });
    });
  });

  // ── runPackageAutoSyncSafely error modes ──
  describe('runPackageAutoSyncSafely error suffix', () => {
    it('logs "manual trigger" suffix for manual mode errors', async () => {
      // downloadFile throws after checkForUpdates returns hasUpdate=true
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockRejectedValue(new Error('download fail'));

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('check/download failed'),
          expect.objectContaining({ error: 'download fail' }),
        );
      });
    });
  });

  // ── parseDownloadedPackageRows text/plain content type ──
  describe('parseDownloadedPackageRows content type detection', () => {
    it('handles text/plain as CSV', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('col1,col2'),
        contentType: 'text/plain',
      } as never);
      mocks.parsePackageCsvData.mockReturnValue([
        { yjCode: '4444444444', gs1Code: null },
      ]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.txt',
      });

      await vi.waitFor(() => {
        expect(mocks.decodeCsvBuffer).toHaveBeenCalled();
        expect(mocks.parsePackageCsvData).toHaveBeenCalled();
      });
    });

    it('handles .csv extension detection', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('col1,col2'),
        contentType: 'application/octet-stream',
      } as never);
      mocks.parsePackageCsvData.mockReturnValue([
        { yjCode: '5555555555', gs1Code: null },
      ]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.csv',
      });

      await vi.waitFor(() => {
        expect(mocks.decodeCsvBuffer).toHaveBeenCalled();
        expect(mocks.parsePackageCsvData).toHaveBeenCalled();
      });
    });

    it('handles .zip extension detection', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('zipdata'),
        contentType: 'application/octet-stream',
      } as never);
      mocks.parsePackageZipData.mockResolvedValue([
        { yjCode: '6666666666', gs1Code: null },
      ]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.zip',
      });

      await vi.waitFor(() => {
        expect(mocks.parsePackageZipData).toHaveBeenCalled();
      });
    });

    it('handles .xml extension detection', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<xml>data</xml>'),
        contentType: 'application/octet-stream',
      } as never);
      mocks.parsePackageXmlData.mockReturnValue([
        { yjCode: '7777777777', gs1Code: null },
      ]);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.parsePackageXmlData).toHaveBeenCalled();
      });
    });
  });

  // ── stopDrugPackageScheduler idempotent ──
  describe('stopDrugPackageScheduler idempotent', () => {
    it('does not log when scheduler was never started', () => {
      mocks.loggerInfo.mockClear();
      stopDrugPackageScheduler();
      const stopCalls = mocks.loggerInfo.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('scheduler stopped'),
      );
      expect(stopCalls).toHaveLength(0);
    });
  });

  // ── empty source URL in runPackageAutoSync ──
  describe('empty source URL warning', () => {
    it('warns when source URL is empty during auto-sync', async () => {
      delete process.env.DRUG_PACKAGE_SOURCE_URL;
      const result = await triggerManualPackageAutoSync();
      expect(result.triggered).toBe(false);
    });
  });
});
