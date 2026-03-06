import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

type SchedulerMocks = {
  loggerInfo: ReturnType<typeof vi.fn>;
  loggerWarn: ReturnType<typeof vi.fn>;
  loggerError: ReturnType<typeof vi.fn>;
  validateExternalHttpsUrl: ReturnType<typeof vi.fn>;
  runMultiFileSync: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
};

async function loadMasterScheduler(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  const mocks: SchedulerMocks = {
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    validateExternalHttpsUrl: vi.fn().mockResolvedValue({ ok: true, reason: null, hostname: 'example.com', resolvedAddresses: ['1.2.3.4'] }),
    runMultiFileSync: vi.fn().mockResolvedValue(undefined),
    checkForUpdates: vi.fn().mockResolvedValue({
      hasUpdate: false,
      etag: null,
      lastModified: null,
      compareByContentHash: false,
      previousContentHash: null,
    }),
  };

  vi.doMock('../services/logger', () => ({
    logger: {
      info: mocks.loggerInfo,
      warn: mocks.loggerWarn,
      error: mocks.loggerError,
      debug: vi.fn(),
    },
  }));
  vi.doMock('../utils/network-utils', () => ({
    validateExternalHttpsUrl: mocks.validateExternalHttpsUrl,
    createPinnedDnsAgent: vi.fn(() => ({ close: vi.fn().mockResolvedValue(undefined) })),
  }));
  vi.doMock('../services/mhlw-multi-file-fetcher', () => ({ runMultiFileSync: mocks.runMultiFileSync }));
  vi.doMock('../services/mhlw-source-fetch', () => ({
    checkForUpdates: mocks.checkForUpdates,
    downloadFile: vi.fn(),
  }));
  vi.doMock('../services/drug-master-service', () => ({
    syncDrugMaster: vi.fn(),
    createSyncLog: vi.fn(),
    completeSyncLog: vi.fn(),
  }));
  vi.doMock('../services/drug-master-parser-service', () => ({ parseMhlwDrugFile: vi.fn() }));
  vi.doMock('../services/drug-master-source-state-service', () => ({
    SOURCE_KEY_SINGLE: 'single',
    persistSourceHeaders: vi.fn(),
  }));

  const mod = await import('../services/drug-master-scheduler');
  return { mod, mocks };
}

async function loadPackageScheduler(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  const mocks: SchedulerMocks = {
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    validateExternalHttpsUrl: vi.fn().mockResolvedValue({ ok: true, reason: null, hostname: 'example.com', resolvedAddresses: ['1.2.3.4'] }),
    runMultiFileSync: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue({
      hasUpdate: false,
      etag: null,
      lastModified: null,
      compareByContentHash: false,
      previousContentHash: null,
    }),
  };

  vi.doMock('../services/logger', () => ({
    logger: {
      info: mocks.loggerInfo,
      warn: mocks.loggerWarn,
      error: mocks.loggerError,
      debug: vi.fn(),
    },
  }));
  vi.doMock('../utils/network-utils', () => ({
    validateExternalHttpsUrl: mocks.validateExternalHttpsUrl,
    createPinnedDnsAgent: vi.fn(() => ({ close: vi.fn().mockResolvedValue(undefined) })),
  }));
  vi.doMock('../services/mhlw-source-fetch', () => ({
    checkForUpdates: mocks.checkForUpdates,
    downloadFile: vi.fn(),
  }));
  vi.doMock('../services/drug-master-service', () => ({
    parsePackageExcelData: vi.fn().mockReturnValue([]),
    parsePackageCsvData: vi.fn().mockReturnValue([]),
    parsePackageXmlData: vi.fn().mockReturnValue([]),
    parsePackageZipData: vi.fn().mockResolvedValue([]),
    decodeCsvBuffer: vi.fn().mockReturnValue(''),
    syncPackageData: vi.fn(),
    createSyncLog: vi.fn(),
    completeSyncLog: vi.fn(),
  }));
  vi.doMock('../services/upload-service', () => ({ parseExcelBuffer: vi.fn().mockResolvedValue([]) }));
  vi.doMock('../services/drug-master-source-state-service', () => ({
    SOURCE_KEY_PACKAGE: 'package',
    persistSourceHeaders: vi.fn(),
  }));

  const mod = await import('../services/drug-package-scheduler');
  return { mod, mocks };
}

describe('scheduler runtime branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('master start: disabled branch and single-mode missing-url branch', async () => {
    const disabled = await loadMasterScheduler({ DRUG_MASTER_AUTO_SYNC: 'false' });
    disabled.mod.startDrugMasterScheduler();
    expect(disabled.mocks.loggerInfo).toHaveBeenCalledWith(expect.stringContaining('disabled'));

    const missing = await loadMasterScheduler({
      DRUG_MASTER_AUTO_SYNC: 'true',
      DRUG_MASTER_SOURCE_MODE: 'single',
      DRUG_MASTER_SOURCE_URL: '',
    });
    missing.mod.startDrugMasterScheduler();
    expect(missing.mocks.loggerWarn).toHaveBeenCalledWith(expect.stringContaining('DRUG_MASTER_SOURCE_URL is not set'));
  });

  it('master start: running/duplicate-stop branches', async () => {
    const started = await loadMasterScheduler({
      DRUG_MASTER_AUTO_SYNC: 'true',
      DRUG_MASTER_SOURCE_MODE: 'index',
      DRUG_MASTER_SOURCE_URL: '',
      DRUG_MASTER_SCHEDULER_OPTIMIZED_LOOP_ENABLED: 'true',
    });
    started.mod.startDrugMasterScheduler();
    started.mod.startDrugMasterScheduler();
    expect(started.mocks.loggerWarn).toHaveBeenCalledWith(expect.stringContaining('already running'));
    started.mod.stopDrugMasterScheduler();
    expect(started.mocks.loggerInfo).toHaveBeenCalledWith(expect.stringContaining('scheduler stopped'));
  });

  it('master trigger: no-url and invalid-url branches', async () => {
    const noUrl = await loadMasterScheduler({
      DRUG_MASTER_SOURCE_MODE: 'single',
      DRUG_MASTER_SOURCE_URL: '',
    });
    const noUrlResult = await noUrl.mod.triggerManualAutoSync({ sourceMode: 'single' });
    expect(noUrlResult.triggered).toBe(false);
    expect(noUrlResult.message).toContain('DRUG_MASTER_SOURCE_URL');

    const invalid = await loadMasterScheduler({
      DRUG_MASTER_SOURCE_MODE: 'single',
      DRUG_MASTER_SOURCE_URL: 'https://example.com/source.xlsx',
    });
    invalid.mocks.validateExternalHttpsUrl.mockResolvedValueOnce({ ok: false, reason: 'invalid-url' });
    const invalidResult = await invalid.mod.triggerManualAutoSync({ sourceUrl: 'https://example.com/source.xlsx', sourceMode: 'single' });
    expect(invalidResult).toEqual({ triggered: false, message: 'invalid-url' });
  });

  it('master trigger: success branches for single and index', async () => {
    const single = await loadMasterScheduler({
      DRUG_MASTER_SOURCE_MODE: 'single',
      DRUG_MASTER_SOURCE_URL: 'https://example.com/source.xlsx',
    });
    const singleResult = await single.mod.triggerManualAutoSync({ sourceMode: 'single', sourceUrl: 'https://example.com/source.xlsx' });
    expect(singleResult.triggered).toBe(true);

    const index = await loadMasterScheduler({
      DRUG_MASTER_SOURCE_MODE: 'index',
      DRUG_MASTER_SOURCE_URL: '',
    });
    const indexResult = await index.mod.triggerManualAutoSync({ sourceMode: 'index', sourceUrl: ' ' });
    expect(indexResult.triggered).toBe(true);
    await vi.waitFor(() => {
      expect(index.mocks.runMultiFileSync).toHaveBeenCalled();
    });
  });

  it('package start: disabled branch and missing-url branch', async () => {
    const disabled = await loadPackageScheduler({ DRUG_PACKAGE_AUTO_SYNC: 'false' });
    disabled.mod.startDrugPackageScheduler();
    expect(disabled.mocks.loggerInfo).toHaveBeenCalledWith(expect.stringContaining('disabled'));

    const missing = await loadPackageScheduler({
      DRUG_PACKAGE_AUTO_SYNC: 'true',
      DRUG_PACKAGE_SOURCE_URL: '',
    });
    missing.mod.startDrugPackageScheduler();
    expect(missing.mocks.loggerWarn).toHaveBeenCalledWith(expect.stringContaining('DRUG_PACKAGE_SOURCE_URL is not set'));
  });

  it('package start: running/duplicate-stop branches', async () => {
    const started = await loadPackageScheduler({
      DRUG_PACKAGE_AUTO_SYNC: 'true',
      DRUG_PACKAGE_SOURCE_URL: 'https://example.com/pkg.xml',
      DRUG_PACKAGE_SCHEDULER_OPTIMIZED_LOOP_ENABLED: 'true',
    });
    started.mod.startDrugPackageScheduler();
    started.mod.startDrugPackageScheduler();
    expect(started.mocks.loggerWarn).toHaveBeenCalledWith(expect.stringContaining('already running'));
    started.mod.stopDrugPackageScheduler();
    expect(started.mocks.loggerInfo).toHaveBeenCalledWith(expect.stringContaining('scheduler stopped'));
  });

  it('package trigger: no-url and invalid-url branches', async () => {
    const noUrl = await loadPackageScheduler({ DRUG_PACKAGE_SOURCE_URL: '' });
    const noUrlResult = await noUrl.mod.triggerManualPackageAutoSync();
    expect(noUrlResult.triggered).toBe(false);
    expect(noUrlResult.message).toContain('DRUG_PACKAGE_SOURCE_URL');

    const invalid = await loadPackageScheduler({ DRUG_PACKAGE_SOURCE_URL: 'https://example.com/pkg.xml' });
    invalid.mocks.validateExternalHttpsUrl.mockResolvedValueOnce({ ok: false, reason: 'invalid-url' });
    const invalidResult = await invalid.mod.triggerManualPackageAutoSync({ sourceUrl: 'https://example.com/pkg.xml' });
    expect(invalidResult).toEqual({ triggered: false, message: 'invalid-url' });
  });

  it('package trigger: success branch', async () => {
    const success = await loadPackageScheduler({ DRUG_PACKAGE_SOURCE_URL: 'https://example.com/pkg.xml' });
    const result = await success.mod.triggerManualPackageAutoSync({ sourceUrl: 'https://example.com/pkg.xml' });
    expect(result.triggered).toBe(true);
  });
});
