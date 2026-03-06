import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncDrugMaster: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  parseMhlwDrugFile: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  validateExternalHttpsUrl: vi.fn(),
  createPinnedDnsAgent: vi.fn(),
  sha256: vi.fn(),
  persistSourceHeaders: vi.fn(),
  runMultiFileSync: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock('../config/database', () => ({ db: {} }));

vi.mock('../services/drug-master-service', () => ({
  syncDrugMaster: mocks.syncDrugMaster,
  createSyncLog: mocks.createSyncLog,
  completeSyncLog: mocks.completeSyncLog,
}));

vi.mock('../services/drug-master-parser-service', () => ({
  parseMhlwDrugFile: mocks.parseMhlwDrugFile,
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
  SOURCE_KEY_SINGLE: 'single',
}));

vi.mock('../services/mhlw-multi-file-fetcher', () => ({
  runMultiFileSync: mocks.runMultiFileSync,
}));

vi.mock('../services/mhlw-source-fetch', () => ({
  checkForUpdates: mocks.checkForUpdates,
  downloadFile: mocks.downloadFile,
}));

import {
  stopDrugMasterScheduler,
  triggerManualAutoSync,
} from '../services/drug-master-scheduler';

const ORIGINAL_ENV = { ...process.env };

describe('drug-master-scheduler-ultra', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stopDrugMasterScheduler();
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
  });

  afterEach(() => {
    stopDrugMasterScheduler();
    process.env = { ...ORIGINAL_ENV };
  });

  // ── runAutoSyncWithSource: validateExternalHttpsUrl with null hostname fallback ──
  describe('runAutoSyncWithSource hostname fallback', () => {
    it('uses URL hostname when validated hostname is null', async () => {
      mocks.validateExternalHttpsUrl.mockResolvedValue({
        ok: true,
        hostname: null,
        resolvedAddresses: ['1.2.3.4'],
      } as never);

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.createPinnedDnsAgent).toHaveBeenCalledWith(
          'example.com',
          ['1.2.3.4'],
        );
      });
    });
  });

  // ── triggerManualAutoSync index mode with sourceUrl provided ──
  describe('triggerManualAutoSync index mode with explicit sourceUrl', () => {
    it('uses single-mode path when sourceUrl is provided even in index mode', async () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';

      const result = await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'index',
      });

      expect(result.triggered).toBe(true);

      await vi.waitFor(() => {
        expect(mocks.checkForUpdates).toHaveBeenCalled();
      });
    });
  });

  // ── runAutoSyncWithSource: content-hash fallback with different hash ──
  describe('content-hash fallback with changed hash', () => {
    it('proceeds with sync when content hash differs from previous', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: true,
        previousContentHash: 'old-hash',
      } as never);
      mocks.sha256.mockReturnValue('new-hash');
      mocks.parseMhlwDrugFile.mockResolvedValue([
        { yjCode: '1234567890', drugName: 'Drug A' },
      ]);

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.createSyncLog).toHaveBeenCalled();
        expect(mocks.parseMhlwDrugFile).toHaveBeenCalled();
        expect(mocks.syncDrugMaster).toHaveBeenCalled();
      });
    });
  });

  // ── runAutoSyncWithSource: compareByContentHash = true but previousContentHash is null ──
  describe('content-hash fallback with null previousContentHash', () => {
    it('proceeds with sync when previousContentHash is null', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: true,
        previousContentHash: null,
      } as never);
      mocks.parseMhlwDrugFile.mockResolvedValue([
        { yjCode: '1234567890', drugName: 'Drug A' },
      ]);

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.createSyncLog).toHaveBeenCalled();
        expect(mocks.syncDrugMaster).toHaveBeenCalled();
      });
    });
  });

  // ── runAutoSyncWithSource: compareByContentHash = false skips hash check ──
  describe('content-hash fallback not active', () => {
    it('skips hash comparison when compareByContentHash is false even if previousContentHash exists', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: 'hash-abc',
      } as never);
      mocks.sha256.mockReturnValue('hash-abc');
      mocks.parseMhlwDrugFile.mockResolvedValue([
        { yjCode: '1234567890', drugName: 'Drug A' },
      ]);

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        // Should proceed even though hashes match because compareByContentHash is false
        expect(mocks.createSyncLog).toHaveBeenCalled();
        expect(mocks.syncDrugMaster).toHaveBeenCalled();
      });
    });
  });

  // ── runAutoSyncSafely error path for different modes ──
  describe('runAutoSyncSafely error handling via triggerManualAutoSync', () => {
    it('catches and logs outer error during check/download', async () => {
      // Make validateExternalHttpsUrl pass (for triggerManualAutoSync's pre-check)
      // but checkForUpdates to throw (the outer catch in runAutoSyncWithSource)
      mocks.checkForUpdates.mockRejectedValue(new Error('network timeout'));

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('check/download failed'),
          expect.objectContaining({ error: 'network timeout' }),
        );
      });
    });
  });

  // ── triggerManualAutoSync: index mode isRunning check ──
  describe('triggerManualAutoSync index mode isRunning', () => {
    it('returns false when runAutoSyncIndex is already running', async () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';
      mocks.runMultiFileSync.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
      );

      const first = await triggerManualAutoSync({ sourceMode: 'index' });
      expect(first.triggered).toBe(true);

      await new Promise((r) => setTimeout(r, 50));

      const second = await triggerManualAutoSync({ sourceMode: 'index' });
      expect(second.triggered).toBe(false);
      expect(second.message).toContain('実行中');

      await new Promise((r) => setTimeout(r, 600));
    });
  });

  // ── stopDrugMasterScheduler idempotent calls ──
  describe('stopDrugMasterScheduler idempotent', () => {
    it('does not log when scheduler was never started', () => {
      mocks.loggerInfo.mockClear();
      stopDrugMasterScheduler();
      const stopCalls = mocks.loggerInfo.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('scheduler stopped'),
      );
      expect(stopCalls).toHaveLength(0);
    });
  });

  // ── triggerManualAutoSync: uses env URL via runAutoSync() ──
  describe('triggerManualAutoSync uses env URL', () => {
    it('uses DRUG_MASTER_SOURCE_URL env var in single mode without explicit sourceUrl', async () => {
      process.env.DRUG_MASTER_SOURCE_URL = 'https://example.com/env-drugs.xlsx';

      const result = await triggerManualAutoSync({ sourceMode: 'single' });
      expect(result.triggered).toBe(true);
    });
  });

  // ── triggerManualAutoSync: index mode auto-sync error via runMultiFileSync ──
  describe('triggerManualAutoSync index mode error', () => {
    it('logs error when runMultiFileSync fails in manual index trigger', async () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';
      mocks.runMultiFileSync.mockRejectedValue(new Error('multi-file error'));

      const result = await triggerManualAutoSync({ sourceMode: 'index' });
      expect(result.triggered).toBe(true);

      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('manual index trigger failed'),
          expect.any(Object),
        );
      });
    });
  });
});
