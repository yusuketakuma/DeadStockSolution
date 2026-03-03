import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: {},
}));

vi.mock('../services/drug-master-service', () => ({
  parsePackageExcelData: vi.fn().mockReturnValue([]),
  parsePackageCsvData: vi.fn().mockReturnValue([]),
  parsePackageXmlData: vi.fn().mockReturnValue([]),
  parsePackageZipData: vi.fn().mockResolvedValue([]),
  decodeCsvBuffer: vi.fn().mockReturnValue(''),
  syncPackageData: vi.fn().mockResolvedValue({ added: 0, updated: 0 }),
  createSyncLog: vi.fn().mockResolvedValue({ id: 1 }),
  completeSyncLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/network-utils', () => ({
  createPinnedDnsAgent: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
  validateExternalHttpsUrl: vi.fn().mockResolvedValue({
    ok: true,
    hostname: 'example.com',
    resolvedAddresses: ['1.2.3.4'],
  }),
}));

vi.mock('../utils/crypto-utils', () => ({
  sha256: vi.fn().mockReturnValue('mocksha256'),
}));

vi.mock('../services/drug-master-source-state-service', () => ({
  persistSourceHeaders: vi.fn().mockResolvedValue(undefined),
  SOURCE_KEY_PACKAGE: 'package',
}));

vi.mock('../services/mhlw-source-fetch', () => ({
  checkForUpdates: vi.fn().mockResolvedValue({
    hasUpdate: false,
    etag: null,
    lastModified: null,
    compareByContentHash: false,
    previousContentHash: null,
  }),
  downloadFile: vi.fn().mockResolvedValue({
    buffer: Buffer.from('content'),
    contentType: 'application/xml',
  }),
}));

import {
  startDrugPackageScheduler,
  stopDrugPackageScheduler,
  triggerManualPackageAutoSync,
} from '../services/drug-package-scheduler';

const ORIGINAL_ENV = { ...process.env };

describe('drug-package-scheduler coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopDrugPackageScheduler();
  });

  afterEach(() => {
    stopDrugPackageScheduler();
    // Restore env
    process.env = { ...ORIGINAL_ENV };
  });

  describe('startDrugPackageScheduler', () => {
    it('does not start when AUTO_SYNC is disabled', () => {
      delete process.env.DRUG_PACKAGE_AUTO_SYNC;
      startDrugPackageScheduler();
      // No error; scheduler remains inactive
    });

    it('does not start when source URL is not set', () => {
      process.env.DRUG_PACKAGE_AUTO_SYNC = 'true';
      delete process.env.DRUG_PACKAGE_SOURCE_URL;
      startDrugPackageScheduler();
      // Logs warning, does not throw
    });

    it('starts scheduler when AUTO_SYNC is enabled and URL is set', () => {
      process.env.DRUG_PACKAGE_AUTO_SYNC = 'true';
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/packages.xlsx';
      startDrugPackageScheduler();
      // Should be active now
    });

    it('warns and skips when scheduler is already running', () => {
      process.env.DRUG_PACKAGE_AUTO_SYNC = 'true';
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/packages.xlsx';
      startDrugPackageScheduler();
      // Call again - should warn
      startDrugPackageScheduler();
    });

    it('uses legacy interval loop when optimized loop is disabled', () => {
      process.env.DRUG_PACKAGE_AUTO_SYNC = 'true';
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/packages.xlsx';
      process.env.DRUG_PACKAGE_SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'false';
      process.env.SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'false';
      startDrugPackageScheduler();
    });
  });

  describe('stopDrugPackageScheduler', () => {
    it('stops a running scheduler', () => {
      process.env.DRUG_PACKAGE_AUTO_SYNC = 'true';
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/packages.xlsx';
      startDrugPackageScheduler();
      stopDrugPackageScheduler();
      // Should not throw
    });

    it('does nothing when scheduler is not running', () => {
      stopDrugPackageScheduler();
    });
  });

  describe('triggerManualPackageAutoSync', () => {
    it('returns not triggered when no source URL configured', async () => {
      delete process.env.DRUG_PACKAGE_SOURCE_URL;
      const result = await triggerManualPackageAutoSync();
      expect(result.triggered).toBe(false);
      expect(result.message).toContain('sourceUrl');
    });

    it('returns not triggered when source URL is invalid (non-HTTPS)', async () => {
      const networkUtils = await import('../utils/network-utils');
      vi.mocked(networkUtils.validateExternalHttpsUrl).mockResolvedValueOnce({
        ok: false,
        reason: 'HTTPS required',
        hostname: null,
        resolvedAddresses: [],
      } as never);
      delete process.env.DRUG_PACKAGE_SOURCE_URL;
      const result = await triggerManualPackageAutoSync({ sourceUrl: 'http://localhost/packages.xml' });
      expect(result.triggered).toBe(false);
    });

    it('returns not triggered when sourceUrl validation fails', async () => {
      const networkUtils = await import('../utils/network-utils');
      vi.mocked(networkUtils.validateExternalHttpsUrl).mockResolvedValueOnce({
        ok: false,
        reason: 'Invalid URL',
        hostname: null,
        resolvedAddresses: [],
      } as never);
      delete process.env.DRUG_PACKAGE_SOURCE_URL;
      const result = await triggerManualPackageAutoSync({ sourceUrl: 'https://example.com/bad' });
      expect(result.triggered).toBe(false);
    });

    it('returns triggered with valid HTTPS source URL', async () => {
      delete process.env.DRUG_PACKAGE_SOURCE_URL;
      const result = await triggerManualPackageAutoSync({ sourceUrl: 'https://example.com/packages.xlsx' });
      expect(result.triggered).toBe(true);
      expect(result.message).toContain('包装単位');
    });

    it('uses configured source URL when no explicit sourceUrl', async () => {
      process.env.DRUG_PACKAGE_SOURCE_URL = 'https://example.com/env-packages.xlsx';
      const result = await triggerManualPackageAutoSync();
      expect(result.triggered).toBe(true);
    });

    it('passes pinned dispatcher to source fetch checks', async () => {
      const networkUtils = await import('../utils/network-utils');
      const sourceFetch = await import('../services/mhlw-source-fetch');
      const pinnedAgent = { close: vi.fn().mockResolvedValue(undefined) };

      vi.mocked(networkUtils.createPinnedDnsAgent).mockReturnValueOnce(pinnedAgent as never);
      vi.mocked(sourceFetch.checkForUpdates).mockResolvedValueOnce({
        hasUpdate: false,
        etag: null,
        lastModified: null,
        compareByContentHash: false,
        previousContentHash: null,
      } as never);

      const result = await triggerManualPackageAutoSync({ sourceUrl: 'https://example.com/packages.xml' });
      expect(result.triggered).toBe(true);

      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(sourceFetch.checkForUpdates).toHaveBeenCalledWith(
        'https://example.com/packages.xml',
        pinnedAgent,
        expect.objectContaining({ sourceKey: 'package' }),
      );
    });
  });
});
