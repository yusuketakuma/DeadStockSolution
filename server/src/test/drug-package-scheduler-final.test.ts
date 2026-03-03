import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────

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

describe('drug-package-scheduler-final', () => {
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
    mocks.parsePackageZipData.mockResolvedValue([] as never);
    mocks.decodeCsvBuffer.mockReturnValue('csv-content');
    mocks.parseExcelBuffer.mockResolvedValue([]);
  });

  afterEach(() => {
    stopDrugPackageScheduler();
    process.env = { ...ORIGINAL_ENV };
  });

  // ── shouldAttachSourceCredentials: origin/pathname match ──

  describe('shouldAttachSourceCredentials logic', () => {
    it('attaches credentials when request URL matches configured origin and pathname', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/packages.xml';
      process.env.DRUG_PACKAGE_SOURCE_AUTHORIZATION = 'Bearer token-final';

      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: false,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        const callArgs = mocks.checkForUpdates.mock.calls[0];
        expect(callArgs[2].headers).toHaveProperty('Authorization', 'Bearer token-final');
      });
    });

    it('attaches both Authorization and Cookie when both are configured', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/packages.xml';
      process.env.DRUG_PACKAGE_SOURCE_AUTHORIZATION = 'Bearer auth-token';
      process.env.DRUG_PACKAGE_SOURCE_COOKIE = 'session=xyz';

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        const callArgs = mocks.checkForUpdates.mock.calls[0];
        expect(callArgs[2].headers).toHaveProperty('Authorization', 'Bearer auth-token');
        expect(callArgs[2].headers).toHaveProperty('Cookie', 'session=xyz');
      });
    });

    it('does not attach credentials when paths differ even with same origin', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/other.xml';
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

  // ── runPackageAutoSync: uses getConfiguredSourceUrl() ──

  describe('runPackageAutoSync with configured source URL', () => {
    it('uses DRUG_PACKAGE_SOURCE_URL env var when no explicit sourceUrl', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/env-packages.xml';

      const result = await triggerManualPackageAutoSync();
      expect(result.triggered).toBe(true);

      await vi.waitFor(() => {
        expect(mocks.validateExternalHttpsUrl).toHaveBeenCalledWith(
          'https://example.com/env-packages.xml',
        );
      });
    });
  });

  // ── persistHeaders: delegates to persistSourceHeaders with SOURCE_KEY_PACKAGE ──

  describe('persistHeaders via runPackageAutoSyncWithSource', () => {
    it('calls persistSourceHeaders with SOURCE_KEY_PACKAGE on no-update path', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: false,
        etag: '"etag-pkg-123"',
        lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT',
        compareByContentHash: false,
        previousContentHash: null,
      } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.persistSourceHeaders).toHaveBeenCalledWith(
          'package',
          'https://example.com/packages.xml',
          expect.objectContaining({ etag: '"etag-pkg-123"' }),
          false,
        );
      });
    });

    it('calls persistSourceHeaders with changed=true on successful sync', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: '"etag-new"',
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('<xml>data</xml>'),
        contentType: 'application/xml',
      } as never);
      mocks.parsePackageXmlData.mockReturnValue([
        { yjCode: '1234567890', gs1Code: null },
      ] as never);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.persistSourceHeaders).toHaveBeenCalledWith(
          'package',
          'https://example.com/packages.xml',
          expect.objectContaining({ contentHash: 'hash-abc' }),
          true,
        );
      });
    });
  });

  // ── runPackageAutoSyncSafely: error suffix variants ──

  describe('runPackageAutoSyncSafely error logging', () => {
    it('logs error for manual mode with "manual trigger" suffix', async () => {
      mocks.checkForUpdates.mockRejectedValue(new Error('connection failed'));

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });

      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('check/download failed'),
          expect.objectContaining({ error: 'connection failed' }),
        );
      });
    });
  });

  // ── runPackageAutoSyncWithSource: empty URL warning ──

  describe('runPackageAutoSyncWithSource empty URL path', () => {
    it('warns when source URL is empty string', async () => {
      delete process.env.DRUG_PACKAGE_SOURCE_URL;

      const result = await triggerManualPackageAutoSync({ sourceUrl: '' });
      expect(result.triggered).toBe(false);
      expect(result.message).toContain('DRUG_PACKAGE_SOURCE_URL');
    });
  });

  // ── isRunning guard ──

  describe('isRunning guard in runPackageAutoSyncWithSource', () => {
    it('returns not triggered when auto-sync is already running', async () => {
      vi.useFakeTimers();
      mocks.checkForUpdates.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
      );

      // Start first sync (won't complete due to fake timers)
      const first = await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });
      expect(first.triggered).toBe(true);

      // Wait briefly to let isRunning be set
      await vi.advanceTimersByTimeAsync(50);

      const second = await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xml',
      });
      expect(second.triggered).toBe(false);
      expect(second.message).toContain('実行中');

      await vi.advanceTimersByTimeAsync(600);
      vi.useRealTimers();
    });
  });

  // ── content-hash fallback: same hash skips sync ──

  describe('content-hash fallback with same hash', () => {
    it('skips sync when content hash equals previous hash', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: true,
        previousContentHash: 'hash-abc',
      } as never);
      mocks.sha256.mockReturnValue('hash-abc');
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('same-data'),
        contentType: 'application/xml',
      } as never);

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
        expect(mocks.createSyncLog).not.toHaveBeenCalled();
      });
    });
  });

  // ── parseDownloadedPackageRows: zip content-type detection ──

  describe('parseDownloadedPackageRows content-type zip', () => {
    it('parses zip content type via content-type header', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);
      mocks.downloadFile.mockResolvedValue({
        buffer: Buffer.from('zipdata'),
        contentType: 'application/zip',
      } as never);
      mocks.parsePackageZipData.mockResolvedValue([
        { yjCode: '1111111111', gs1Code: null },
      ] as never);
      mocks.syncPackageData.mockResolvedValue({ added: 1, updated: 0 } as never);

      await triggerManualPackageAutoSync({
        sourceUrl: 'https://example.com/packages.xlsx',
      });

      await vi.waitFor(() => {
        expect(mocks.parsePackageZipData).toHaveBeenCalled();
        expect(mocks.syncPackageData).toHaveBeenCalled();
      });
    });
  });

  // ── stopDrugPackageScheduler: idempotent ──

  describe('stopDrugPackageScheduler', () => {
    it('does NOT log when called with no active scheduler state', () => {
      mocks.loggerInfo.mockClear();
      stopDrugPackageScheduler();

      const stopCalls = mocks.loggerInfo.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('stopped'),
      );
      expect(stopCalls.length).toBe(0);
    });
  });
});
