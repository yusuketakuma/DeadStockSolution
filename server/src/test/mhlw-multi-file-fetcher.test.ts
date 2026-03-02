import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const ORIGINAL_ALLOW_PARTIAL_SYNC = process.env.DRUG_MASTER_ALLOW_PARTIAL_INDEX_SYNC;

// Mock external dependencies
vi.mock('../services/mhlw-index-scraper', () => ({
  discoverMhlwExcelUrls: vi.fn(),
  DRUG_CATEGORIES: ['内用薬', '外用薬', '注射薬', '歯科用薬剤'],
}));

vi.mock('../services/drug-master-source-state-service', () => ({
  getSourceState: vi.fn().mockResolvedValue(null),
  getSourceStatesByPrefix: vi.fn().mockResolvedValue([]),
  upsertSourceState: vi.fn().mockResolvedValue(undefined),
  SOURCE_KEY_INDEX: 'drug:index_page',
  SOURCE_KEY_SINGLE: 'drug:single',
  SOURCE_KEY_PACKAGE: 'package:main',
  sourceKeyForFile: (category: string) => `drug:file:${category}`,
}));

vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (err: unknown) => err instanceof Error ? err.message : String(err),
}));

vi.mock('../services/drug-master-service', () => ({
  parseMhlwExcelData: vi.fn().mockReturnValue([]),
  parseMhlwCsvData: vi.fn().mockReturnValue([]),
  decodeCsvBuffer: vi.fn().mockReturnValue(''),
  syncDrugMaster: vi.fn().mockResolvedValue({
    itemsProcessed: 10,
    itemsAdded: 5,
    itemsUpdated: 3,
    itemsDeleted: 2,
  }),
  createSyncLog: vi.fn().mockResolvedValue({ id: 1 }),
  completeSyncLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: vi.fn().mockResolvedValue([['header1', 'header2']]),
}));

vi.mock('../services/drug-master-parser-service', () => ({
  parseMhlwDrugFile: vi.fn().mockResolvedValue([
    { drugCode: '0001', drugName: 'テスト薬', unitPrice: 100, unit: '錠' },
  ]),
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../utils/network-utils', () => ({
  validateExternalHttpsUrl: vi.fn().mockResolvedValue({
    ok: true,
    hostname: 'www.mhlw.go.jp',
    resolvedAddresses: ['1.2.3.4'],
    reason: null,
  }),
  createPinnedDnsAgent: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../utils/http-utils', () => ({
  fetchWithTimeout: vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  }),
  downloadResponseBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-excel-data')),
  summarizeSourceUrl: (url: string) => { try { return new URL(url).hostname; } catch { return url.slice(0, 64); } },
  MHLW_MAX_DOWNLOAD_SIZE: 100 * 1024 * 1024,
  MHLW_FETCH_TIMEOUT_MS: 120_000,
  MHLW_DEFAULT_FETCH_RETRIES: 2,
}));

describe('mhlw-multi-file-fetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (ORIGINAL_ALLOW_PARTIAL_SYNC === undefined) {
      delete process.env.DRUG_MASTER_ALLOW_PARTIAL_INDEX_SYNC;
    } else {
      process.env.DRUG_MASTER_ALLOW_PARTIAL_INDEX_SYNC = ORIGINAL_ALLOW_PARTIAL_SYNC;
    }
  });

  it('should export runMultiFileSync function', async () => {
    const mod = await import('../services/mhlw-multi-file-fetcher');
    expect(mod.runMultiFileSync).toBeDefined();
    expect(typeof mod.runMultiFileSync).toBe('function');
  });

  it('should throw when no Excel files are discovered', async () => {
    const { discoverMhlwExcelUrls } = await import('../services/mhlw-index-scraper');
    vi.mocked(discoverMhlwExcelUrls).mockResolvedValue({
      indexUrl: 'https://www.mhlw.go.jp/topics/2025/04/test.html',
      files: [],
    });

    const { runMultiFileSync } = await import('../services/mhlw-multi-file-fetcher');
    await expect(runMultiFileSync()).rejects.toThrow('Excel ファイルが見つかりません');
  });

  it('should fail when required categories are missing', async () => {
    const { discoverMhlwExcelUrls } = await import('../services/mhlw-index-scraper');
    vi.mocked(discoverMhlwExcelUrls).mockResolvedValue({
      indexUrl: 'https://www.mhlw.go.jp/topics/2025/04/test.html',
      files: [
        { category: '内用薬', url: 'https://www.mhlw.go.jp/dl/test_01.xlsx', label: '内用薬' },
      ],
    });

    const { runMultiFileSync } = await import('../services/mhlw-multi-file-fetcher');
    await expect(runMultiFileSync()).rejects.toThrow('MHLW必須カテゴリが不足しています');
  });

  it('should merge 4 files and call syncDrugMaster on success', async () => {
    const { discoverMhlwExcelUrls } = await import('../services/mhlw-index-scraper');
    vi.mocked(discoverMhlwExcelUrls).mockResolvedValue({
      indexUrl: 'https://www.mhlw.go.jp/topics/2025/04/test.html',
      files: [
        { category: '内用薬', url: 'https://www.mhlw.go.jp/dl/test_01.xlsx', label: '内用薬' },
        { category: '外用薬', url: 'https://www.mhlw.go.jp/dl/test_02.xlsx', label: '外用薬' },
        { category: '注射薬', url: 'https://www.mhlw.go.jp/dl/test_03.xlsx', label: '注射薬' },
        { category: '歯科用薬剤', url: 'https://www.mhlw.go.jp/dl/test_04.xlsx', label: '歯科用薬剤' },
      ],
    });

    // Each category returns 2 parsed rows via parseMhlwDrugFile
    const { parseMhlwDrugFile } = await import('../services/drug-master-parser-service');
    vi.mocked(parseMhlwDrugFile).mockResolvedValue([
      { yjCode: 'YJ001', drugName: 'テスト薬A', unitPrice: 100, unit: '錠' },
      { yjCode: 'YJ002', drugName: 'テスト薬B', unitPrice: 200, unit: '錠' },
    ] as never);

    const { syncDrugMaster } = await import('../services/drug-master-service');

    const { runMultiFileSync } = await import('../services/mhlw-multi-file-fetcher');
    const result = await runMultiFileSync();

    expect(result.allUnchanged).toBe(false);
    expect(result.syncResult).toBeDefined();
    expect(result.discoveredFiles).toHaveLength(4);
    // 4 files x 2 rows = 8 merged rows passed to syncDrugMaster
    expect(vi.mocked(syncDrugMaster)).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ yjCode: 'YJ001' })]),
      expect.any(Number),
      expect.any(String),
    );
    const mergedRows = vi.mocked(syncDrugMaster).mock.calls[0][0];
    expect(mergedRows).toHaveLength(8);
  });

  it('should abort entire sync when one download fails', async () => {
    process.env.DRUG_MASTER_ALLOW_PARTIAL_INDEX_SYNC = 'true';
    const { discoverMhlwExcelUrls } = await import('../services/mhlw-index-scraper');
    vi.mocked(discoverMhlwExcelUrls).mockResolvedValue({
      indexUrl: 'https://www.mhlw.go.jp/topics/2025/04/test.html',
      files: [
        { category: '内用薬', url: 'https://www.mhlw.go.jp/dl/test_01.xlsx', label: '内用薬' },
        { category: '外用薬', url: 'https://www.mhlw.go.jp/dl/test_02.xlsx', label: '外用薬' },
      ],
    });

    // Make fetchWithTimeout fail for the second call
    const { fetchWithTimeout } = await import('../utils/http-utils');
    let callCount = 0;
    vi.mocked(fetchWithTimeout).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('ネットワークエラー');
      }
      return {
        ok: true,
        headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      } as never;
    });

    const { syncDrugMaster } = await import('../services/drug-master-service');

    const { runMultiFileSync } = await import('../services/mhlw-multi-file-fetcher');
    await expect(runMultiFileSync()).rejects.toThrow('ファイル処理に失敗');

    // syncDrugMaster should NOT have been called
    expect(vi.mocked(syncDrugMaster)).not.toHaveBeenCalled();
  });

  it('should detect all-unchanged and skip sync', async () => {
    process.env.DRUG_MASTER_ALLOW_PARTIAL_INDEX_SYNC = 'true';
    const mockBuffer = Buffer.from('unchanged-content');
    const mockHash = createHash('sha256').update(mockBuffer).digest('hex');

    const { discoverMhlwExcelUrls } = await import('../services/mhlw-index-scraper');
    vi.mocked(discoverMhlwExcelUrls).mockResolvedValue({
      indexUrl: 'https://www.mhlw.go.jp/topics/2025/04/test.html',
      files: [{ category: '内用薬', url: 'https://www.mhlw.go.jp/test_01.xlsx', label: '内用薬' }],
    });

    const { getSourceStatesByPrefix } = await import('../services/drug-master-source-state-service');
    vi.mocked(getSourceStatesByPrefix).mockResolvedValue([{
      id: 1,
      sourceKey: 'drug:file:内用薬',
      url: 'https://www.mhlw.go.jp/test_01.xlsx',
      etag: null,
      lastModified: null,
      contentHash: mockHash,
      lastCheckedAt: '2025-01-01T00:00:00.000Z',
      lastChangedAt: '2025-01-01T00:00:00.000Z',
      metadataJson: null,
    }]);

    const { downloadResponseBuffer } = await import('../utils/http-utils');
    vi.mocked(downloadResponseBuffer).mockResolvedValue(mockBuffer);
    const { parseMhlwExcelData, syncDrugMaster } = await import('../services/drug-master-service');

    const { runMultiFileSync } = await import('../services/mhlw-multi-file-fetcher');
    const result = await runMultiFileSync();

    expect(result.allUnchanged).toBe(true);
    expect(result.syncResult).toBeUndefined();
    expect(vi.mocked(parseMhlwExcelData)).not.toHaveBeenCalled();
    expect(vi.mocked(syncDrugMaster)).not.toHaveBeenCalled();
  });

  it('should parse all categories when at least one file changed', async () => {
    process.env.DRUG_MASTER_ALLOW_PARTIAL_INDEX_SYNC = 'true';
    const changedBuffer = Buffer.from('changed-content');
    const unchangedBuffer = Buffer.from('unchanged-content');
    const changedHash = createHash('sha256').update(changedBuffer).digest('hex');
    const unchangedHash = createHash('sha256').update(unchangedBuffer).digest('hex');

    const { discoverMhlwExcelUrls } = await import('../services/mhlw-index-scraper');
    vi.mocked(discoverMhlwExcelUrls).mockResolvedValue({
      indexUrl: 'https://www.mhlw.go.jp/topics/2025/04/test.html',
      files: [
        { category: '内用薬', url: 'https://www.mhlw.go.jp/test_01.xlsx', label: '内用薬' },
        { category: '外用薬', url: 'https://www.mhlw.go.jp/test_02.xlsx', label: '外用薬' },
      ],
    });

    const { getSourceStatesByPrefix } = await import('../services/drug-master-source-state-service');
    vi.mocked(getSourceStatesByPrefix).mockResolvedValue([
      {
        id: 1,
        sourceKey: 'drug:file:内用薬',
        url: 'https://www.mhlw.go.jp/test_01.xlsx',
        etag: null,
        lastModified: null,
        contentHash: 'old-hash',
        lastCheckedAt: '2025-01-01T00:00:00.000Z',
        lastChangedAt: '2025-01-01T00:00:00.000Z',
        metadataJson: null,
      },
      {
        id: 2,
        sourceKey: 'drug:file:外用薬',
        url: 'https://www.mhlw.go.jp/test_02.xlsx',
        etag: null,
        lastModified: null,
        contentHash: unchangedHash,
        lastCheckedAt: '2025-01-01T00:00:00.000Z',
        lastChangedAt: '2025-01-01T00:00:00.000Z',
        metadataJson: null,
      },
    ]);

    const { downloadResponseBuffer } = await import('../utils/http-utils');
    vi.mocked(downloadResponseBuffer)
      .mockResolvedValueOnce(changedBuffer)
      .mockResolvedValueOnce(unchangedBuffer);

    const { parseMhlwDrugFile } = await import('../services/drug-master-parser-service');
    vi.mocked(parseMhlwDrugFile)
      .mockResolvedValueOnce([
        { yjCode: 'YJ100', drugName: '変更薬', unitPrice: 100, unit: '錠' },
      ] as never)
      .mockResolvedValueOnce([
        { yjCode: 'YJ200', drugName: '未変更薬', unitPrice: 200, unit: '錠' },
      ] as never);

    const { syncDrugMaster } = await import('../services/drug-master-service');

    const { runMultiFileSync } = await import('../services/mhlw-multi-file-fetcher');
    const result = await runMultiFileSync();

    expect(result.allUnchanged).toBe(false);
    expect(vi.mocked(parseMhlwDrugFile)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(syncDrugMaster)).toHaveBeenCalledTimes(1);
    const mergedRows = vi.mocked(syncDrugMaster).mock.calls[0][0];
    expect(mergedRows).toHaveLength(2);
    expect(mergedRows.map((row) => row.yjCode).sort()).toEqual(['YJ100', 'YJ200']);
    expect(changedHash).not.toBe(unchangedHash);
  });
});
