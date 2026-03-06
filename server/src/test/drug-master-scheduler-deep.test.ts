import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  syncDrugMaster: vi.fn().mockResolvedValue({
    itemsProcessed: 10,
    itemsAdded: 5,
    itemsUpdated: 3,
    itemsDeleted: 2,
  }),
  createSyncLog: vi.fn().mockResolvedValue({ id: 42 }),
  completeSyncLog: vi.fn().mockResolvedValue(undefined),
  parseMhlwDrugFile: vi.fn().mockResolvedValue([]),
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
  sha256: vi.fn().mockReturnValue('hash-xyz'),
  persistSourceHeaders: vi.fn().mockResolvedValue(undefined),
  runMultiFileSync: vi.fn().mockResolvedValue(undefined),
  checkForUpdates: vi.fn().mockResolvedValue({
    hasUpdate: false,
    etag: null,
    lastModified: null,
    compareByContentHash: false,
    previousContentHash: null,
  }),
  downloadFile: vi.fn().mockResolvedValue({
    buffer: Buffer.from('file-data'),
    contentType: 'application/octet-stream',
  }),
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
  startDrugMasterScheduler,
  stopDrugMasterScheduler,
  triggerManualAutoSync,
  getConfiguredSourceMode,
} from '../services/drug-master-scheduler';

const ORIGINAL_ENV = { ...process.env };

describe('drug-master-scheduler-deep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopDrugMasterScheduler();
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
    stopDrugMasterScheduler();
    process.env = { ...ORIGINAL_ENV };
  });

  // ── runAutoSyncIndex flow ──

  describe('index mode auto-sync', () => {
    it('calls runMultiFileSync in index mode', async () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';

      const result = await triggerManualAutoSync({ sourceMode: 'index' });
      expect(result.triggered).toBe(true);

      await vi.waitFor(() => {
        expect(mocks.runMultiFileSync).toHaveBeenCalled();
      });
    });

    it('skips when already running in index mode', async () => {
      vi.useFakeTimers();
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';
      mocks.runMultiFileSync.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
      );

      const first = await triggerManualAutoSync({ sourceMode: 'index' });
      expect(first.triggered).toBe(true);

      await vi.advanceTimersByTimeAsync(50);

      const second = await triggerManualAutoSync({ sourceMode: 'index' });
      expect(second.triggered).toBe(false);
      expect(second.message).toContain('実行中');

      // Wait for the background task to complete to reset isRunning state
      await vi.advanceTimersByTimeAsync(600);
      vi.useRealTimers();
    });

    it('logs error when runMultiFileSync fails', async () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';
      mocks.runMultiFileSync.mockRejectedValue(new Error('multi-file sync failed'));

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

  // ── runAutoSyncWithSource flow ──

  describe('single mode auto-sync full flow', () => {
    it('skips when no update detected', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: false,
        etag: '"etag-old"',
        lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT',
        compareByContentHash: false,
        previousContentHash: null,
      });

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.persistSourceHeaders).toHaveBeenCalledWith(
          'single',
          'https://example.com/drugs.xlsx',
          expect.objectContaining({ hasUpdate: false }),
          false,
        );
        expect(mocks.createSyncLog).not.toHaveBeenCalled();
      });
    });

    it('downloads, parses, and syncs when update is detected', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: '"etag-new"',
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });
      mocks.parseMhlwDrugFile.mockResolvedValue([
        { yjCode: '1234567890', drugName: '薬A', genericName: null, specification: null, unit: null, yakkaPrice: 100, manufacturer: null, category: null, therapeuticCategory: null, listedDate: null, transitionDeadline: null },
      ]);
      mocks.syncDrugMaster.mockResolvedValue({
        itemsProcessed: 1,
        itemsAdded: 1,
        itemsUpdated: 0,
        itemsDeleted: 0,
      });

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.parseMhlwDrugFile).toHaveBeenCalled();
        expect(mocks.syncDrugMaster).toHaveBeenCalled();
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(42, 'success', expect.any(Object));
        expect(mocks.persistSourceHeaders).toHaveBeenCalledWith(
          'single',
          'https://example.com/drugs.xlsx',
          expect.objectContaining({ contentHash: 'hash-xyz' }),
          true,
        );
      });
    });

    it('records failed sync when parsed rows are empty', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });
      mocks.parseMhlwDrugFile.mockResolvedValue([]);

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(
          42,
          'failed',
          expect.objectContaining({ itemsProcessed: 0 }),
          expect.stringContaining('有効なデータ'),
        );
      });
    });

    it('records failed sync when syncDrugMaster throws', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });
      mocks.parseMhlwDrugFile.mockResolvedValue([
        { yjCode: '9999999999', drugName: '薬X', genericName: null, specification: null, unit: null, yakkaPrice: 50, manufacturer: null, category: null, therapeuticCategory: null, listedDate: null, transitionDeadline: null },
      ]);
      mocks.syncDrugMaster.mockRejectedValue(new Error('transaction failed'));

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.completeSyncLog).toHaveBeenCalledWith(
          42,
          'failed',
          expect.objectContaining({ itemsProcessed: 0 }),
          'transaction failed',
        );
      });
    });

    it('skips when content-hash fallback detects no change', async () => {
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: true,
        etag: null,
        lastModified: null,
        compareByContentHash: true,
        previousContentHash: 'hash-xyz',
      });
      mocks.sha256.mockReturnValue('hash-xyz');

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.persistSourceHeaders).toHaveBeenCalledWith(
          'single',
          'https://example.com/drugs.xlsx',
          expect.objectContaining({ contentHash: 'hash-xyz' }),
          false,
        );
        expect(mocks.createSyncLog).not.toHaveBeenCalled();
      });
    });

    it('logs error when URL validation fails during auto-sync', async () => {
      mocks.validateExternalHttpsUrl.mockResolvedValue({
        ok: false,
        reason: 'DNS resolution failed',
        hostname: null,
        resolvedAddresses: [],
      });

      // Use direct sourceUrl with single mode to bypass the pre-validation in triggerManualAutoSync
      // We need to use the env URL path to test runAutoSyncWithSource's internal validation
      process.env.DRUG_MASTER_SOURCE_URL = 'https://example.com/drugs.xlsx';

      // Reset validation mock to fail on second call (first succeeds in triggerManualAutoSync)
      mocks.validateExternalHttpsUrl
        .mockResolvedValueOnce({ ok: true, hostname: 'example.com', resolvedAddresses: ['1.2.3.4'] })
        .mockResolvedValueOnce({ ok: false, reason: 'DNS failed', hostname: null, resolvedAddresses: [] });

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(mocks.loggerError).toHaveBeenCalledWith(
          expect.stringContaining('source URL is invalid'),
          expect.any(Object),
        );
      });
    });

    it('closes pinned agent in finally block', async () => {
      const closeAgent = vi.fn().mockResolvedValue(undefined);
      mocks.createPinnedDnsAgent.mockReturnValue({ close: closeAgent });
      mocks.checkForUpdates.mockRejectedValue(new Error('network error'));

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(closeAgent).toHaveBeenCalled();
      });
    });

    it('handles close() failure gracefully', async () => {
      const closeAgent = vi.fn().mockRejectedValue(new Error('close error'));
      mocks.createPinnedDnsAgent.mockReturnValue({ close: closeAgent });
      mocks.checkForUpdates.mockResolvedValue({
        hasUpdate: false,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      });

      await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });

      await vi.waitFor(() => {
        expect(closeAgent).toHaveBeenCalled();
      });
    });

    it('skips when empty source URL in single mode', async () => {
      delete process.env.DRUG_MASTER_SOURCE_URL;

      // Directly trigger single mode without sourceUrl
      // runAutoSyncWithSource should detect empty URL
      const result = await triggerManualAutoSync({ sourceMode: 'single' });
      expect(result.triggered).toBe(false);
    });
  });

  // ── Scheduler stop behavior ──
  // Note: AUTO_SYNC_ENABLED is evaluated at module import time, so we cannot
  // dynamically enable it in tests. The existing coverage test file already
  // covers startDrugMasterScheduler paths. We focus on stop and edge paths.

  describe('scheduler stop behavior', () => {
    it('stopDrugMasterScheduler is idempotent', () => {
      stopDrugMasterScheduler();
      stopDrugMasterScheduler();
      // Should not throw
    });

    it('getConfiguredSourceMode returns index for whitespace-only value', () => {
      process.env.DRUG_MASTER_SOURCE_MODE = '  ';
      expect(getConfiguredSourceMode()).toBe('index');
    });
  });

  // ── triggerManualAutoSync edge cases ──

  describe('triggerManualAutoSync edge cases', () => {
    it('handles sourceUrl with whitespace in index mode (falls through to index)', async () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';

      const result = await triggerManualAutoSync({
        sourceUrl: '   ',
        sourceMode: 'index',
      });
      expect(result.triggered).toBe(true);
      expect(result.message).toContain('ポータル');
    });

    it('returns fallback message when validation fails without reason', async () => {
      mocks.validateExternalHttpsUrl.mockResolvedValue({
        ok: false,
        reason: null,
        hostname: null,
        resolvedAddresses: [],
      });

      const result = await triggerManualAutoSync({
        sourceUrl: 'https://example.com/bad',
        sourceMode: 'single',
      });
      expect(result.triggered).toBe(false);
      expect(result.message).toContain('不正');
    });

    it('defaults to configured source mode when options.sourceMode is not provided', async () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'single';
      process.env.DRUG_MASTER_SOURCE_URL = 'https://example.com/drugs.xlsx';

      const result = await triggerManualAutoSync();
      expect(result.triggered).toBe(true);
    });

    it('already running check in single mode', async () => {
      vi.useFakeTimers();
      mocks.checkForUpdates.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500)),
      );

      const first = await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });
      expect(first.triggered).toBe(true);

      await vi.advanceTimersByTimeAsync(50);

      const second = await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });
      expect(second.triggered).toBe(false);
      expect(second.message).toContain('実行中');

      await vi.advanceTimersByTimeAsync(600);
      vi.useRealTimers();
    });
  });
});
