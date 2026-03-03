import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: {},
}));

vi.mock('../services/drug-master-service', () => ({
  syncDrugMaster: vi.fn().mockResolvedValue({
    itemsProcessed: 0,
    itemsAdded: 0,
    itemsUpdated: 0,
    itemsDeleted: 0,
  }),
  createSyncLog: vi.fn().mockResolvedValue({ id: 1 }),
  completeSyncLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/drug-master-parser-service', () => ({
  parseMhlwDrugFile: vi.fn().mockResolvedValue([]),
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
  SOURCE_KEY_SINGLE: 'single',
}));

vi.mock('../services/mhlw-multi-file-fetcher', () => ({
  runMultiFileSync: vi.fn().mockResolvedValue(undefined),
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
    contentType: 'application/octet-stream',
  }),
}));

import {
  startDrugMasterScheduler,
  stopDrugMasterScheduler,
  triggerManualAutoSync,
  getConfiguredSourceMode,
} from '../services/drug-master-scheduler';

const ORIGINAL_ENV = { ...process.env };

describe('drug-master-scheduler coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopDrugMasterScheduler();
  });

  afterEach(() => {
    stopDrugMasterScheduler();
    process.env = { ...ORIGINAL_ENV };
  });

  describe('getConfiguredSourceMode', () => {
    it('defaults to index mode', () => {
      delete process.env.DRUG_MASTER_SOURCE_MODE;
      expect(getConfiguredSourceMode()).toBe('index');
    });

    it('returns single when explicitly set', () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'single';
      expect(getConfiguredSourceMode()).toBe('single');
    });

    it('returns index for uppercase SINGLE value', () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'SINGLE';
      expect(getConfiguredSourceMode()).toBe('single');
    });

    it('returns index for empty string', () => {
      process.env.DRUG_MASTER_SOURCE_MODE = '';
      expect(getConfiguredSourceMode()).toBe('index');
    });

    it('returns index for unknown value', () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'multi';
      expect(getConfiguredSourceMode()).toBe('index');
    });
  });

  describe('startDrugMasterScheduler', () => {
    it('does not start when AUTO_SYNC is disabled', () => {
      delete process.env.DRUG_MASTER_AUTO_SYNC;
      startDrugMasterScheduler();
    });

    it('does not start in single mode without source URL', () => {
      process.env.DRUG_MASTER_AUTO_SYNC = 'true';
      process.env.DRUG_MASTER_SOURCE_MODE = 'single';
      delete process.env.DRUG_MASTER_SOURCE_URL;
      startDrugMasterScheduler();
    });

    it('starts in index mode without source URL', () => {
      process.env.DRUG_MASTER_AUTO_SYNC = 'true';
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';
      delete process.env.DRUG_MASTER_SOURCE_URL;
      startDrugMasterScheduler();
    });

    it('starts in single mode with source URL', () => {
      process.env.DRUG_MASTER_AUTO_SYNC = 'true';
      process.env.DRUG_MASTER_SOURCE_MODE = 'single';
      process.env.DRUG_MASTER_SOURCE_URL = 'https://example.com/drugs.xlsx';
      startDrugMasterScheduler();
    });

    it('warns when scheduler is already running', () => {
      process.env.DRUG_MASTER_AUTO_SYNC = 'true';
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';
      startDrugMasterScheduler();
      startDrugMasterScheduler();
    });

    it('uses legacy interval loop when optimized loop is disabled', () => {
      process.env.DRUG_MASTER_AUTO_SYNC = 'true';
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';
      process.env.DRUG_MASTER_SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'false';
      process.env.SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'false';
      startDrugMasterScheduler();
    });

    it('respects local scheduler flag over global', () => {
      process.env.DRUG_MASTER_AUTO_SYNC = 'true';
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';
      process.env.DRUG_MASTER_SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'true';
      process.env.SCHEDULER_OPTIMIZED_LOOP_ENABLED = 'false';
      startDrugMasterScheduler();
    });
  });

  describe('stopDrugMasterScheduler', () => {
    it('stops a running scheduler', () => {
      process.env.DRUG_MASTER_AUTO_SYNC = 'true';
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';
      startDrugMasterScheduler();
      stopDrugMasterScheduler();
    });

    it('does nothing when scheduler is not running', () => {
      stopDrugMasterScheduler();
    });
  });

  describe('triggerManualAutoSync', () => {
    it('returns not triggered in single mode without URL', async () => {
      delete process.env.DRUG_MASTER_SOURCE_URL;
      const result = await triggerManualAutoSync({ sourceMode: 'single' });
      expect(result.triggered).toBe(false);
      expect(result.message).toContain('sourceUrl');
    });

    it('rejects invalid source URL in single mode', async () => {
      const networkUtils = await import('../utils/network-utils');
      vi.mocked(networkUtils.validateExternalHttpsUrl).mockResolvedValueOnce({
        ok: false,
        reason: 'HTTPS required',
        hostname: null,
        resolvedAddresses: [],
      } as never);
      const result = await triggerManualAutoSync({
        sourceUrl: 'http://localhost/file.csv',
        sourceMode: 'single',
      });
      expect(result.triggered).toBe(false);
    });

    it('triggers index mode auto-sync without sourceUrl', async () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';
      const result = await triggerManualAutoSync({ sourceMode: 'index' });
      expect(result.triggered).toBe(true);
      expect(result.message).toContain('ポータル');
    });

    it('triggers single mode sync with valid URL', async () => {
      delete process.env.DRUG_MASTER_SOURCE_URL;
      const result = await triggerManualAutoSync({
        sourceUrl: 'https://example.com/drugs.xlsx',
        sourceMode: 'single',
      });
      expect(result.triggered).toBe(true);
    });

    it('uses env URL when no explicit sourceUrl in single mode', async () => {
      process.env.DRUG_MASTER_SOURCE_URL = 'https://example.com/env-drugs.xlsx';
      const result = await triggerManualAutoSync({ sourceMode: 'single' });
      expect(result.triggered).toBe(true);
    });

    it('returns not triggered when validation fails', async () => {
      const { validateExternalHttpsUrl } = await import('../utils/network-utils');
      vi.mocked(validateExternalHttpsUrl).mockResolvedValueOnce({
        ok: false,
        reason: 'Invalid',
        hostname: null,
        resolvedAddresses: [],
      });
      const result = await triggerManualAutoSync({
        sourceUrl: 'https://example.com/bad',
        sourceMode: 'single',
      });
      expect(result.triggered).toBe(false);
    });

    it('uses default source mode when not specified', async () => {
      process.env.DRUG_MASTER_SOURCE_MODE = 'index';
      const result = await triggerManualAutoSync();
      expect(result.triggered).toBe(true);
    });

    it('passes pinned dispatcher to source fetch checks in single mode', async () => {
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

      const result = await triggerManualAutoSync({
        sourceMode: 'single',
        sourceUrl: 'https://example.com/drugs.csv',
      });

      expect(result.triggered).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(sourceFetch.checkForUpdates).toHaveBeenCalledWith(
        'https://example.com/drugs.csv',
        pinnedAgent,
        expect.objectContaining({ sourceKey: 'single' }),
      );
    });
  });
});
