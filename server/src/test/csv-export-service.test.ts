import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: { select: vi.fn() },
  loggerError: vi.fn(),
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.loggerError },
}));
vi.mock('drizzle-orm', () => ({
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
}));

import { exportPharmaciesCsv, exportExchangesCsv, exportReportsCsv } from '../services/csv-export-service';

import type { CsvWriter } from '../services/csv-export-service';

function createMockWriter(): CsvWriter & { output: () => string } {
  const chunks: string[] = [];
  return {
    write: vi.fn((chunk: string) => { chunks.push(chunk); return true; }) as CsvWriter['write'],
    output: () => chunks.join(''),
  };
}

function createBatchedSelectMock(batches: unknown[][]) {
  let callCount = 0;
  return () => {
    const selectQuery = {
      from: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn(),
    };
    selectQuery.from.mockReturnValue(selectQuery);
    selectQuery.orderBy.mockReturnValue(selectQuery);
    selectQuery.limit.mockReturnValue(selectQuery);
    selectQuery.offset.mockImplementation(() => {
      const batch = batches[callCount] ?? [];
      callCount++;
      return Promise.resolve(batch);
    });
    return selectQuery;
  };
}

describe('CsvExportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exportPharmaciesCsv', () => {
    it('BOM付きヘッダー + 行データを出力する', async () => {
      const mockData = [{
        id: 1, email: 'test@example.com', name: 'テスト薬局',
        prefecture: '東京都', address: '千代田区', postalCode: '100-0001',
        phone: '03-1234-5678', fax: '03-1234-5679',
        isActive: true, isAdmin: false, isTestAccount: false,
        verificationStatus: 'verified', createdAt: '2026-01-01T00:00:00.000Z',
      }];

      mocks.db.select.mockImplementation(createBatchedSelectMock([mockData, []]));

      const writer = createMockWriter();
      const count = await exportPharmaciesCsv(writer, { batchSize: 10 });

      expect(count).toBe(1);
      const output = writer.output();
      // BOM チェック
      expect(output.startsWith('\uFEFF')).toBe(true);
      // ヘッダー確認
      expect(output).toContain('ID,メールアドレス,薬局名');
      // データ確認
      expect(output).toContain('テスト薬局');
      expect(output).toContain('はい'); // isActive
    });

    it('データが0件の場合はヘッダーのみ', async () => {
      mocks.db.select.mockImplementation(createBatchedSelectMock([[]]));

      const writer = createMockWriter();
      const count = await exportPharmaciesCsv(writer, { batchSize: 10 });

      expect(count).toBe(0);
      const output = writer.output();
      expect(output.startsWith('\uFEFF')).toBe(true);
      expect(output).toContain('ID,メールアドレス');
    });

    it('カンマやダブルクォートを含むフィールドをエスケープする', async () => {
      const mockData = [{
        id: 2, email: 'test@example.com', name: '薬局,"特殊名"',
        prefecture: '東京都', address: '千代田区', postalCode: '100-0001',
        phone: '03-1234-5678', fax: '03-1234-5679',
        isActive: false, isAdmin: false, isTestAccount: true,
        verificationStatus: 'pending_verification', createdAt: '2026-01-01T00:00:00.000Z',
      }];

      mocks.db.select.mockImplementation(createBatchedSelectMock([mockData, []]));

      const writer = createMockWriter();
      await exportPharmaciesCsv(writer, { batchSize: 10 });

      const output = writer.output();
      // ダブルクォートがエスケープされている
      expect(output).toContain('"薬局,""特殊名"""');
    });

    it('DB障害時はエラーをスローしログ出力する', async () => {
      const selectQuery = {
        from: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn(),
      };
      selectQuery.from.mockReturnValue(selectQuery);
      selectQuery.orderBy.mockReturnValue(selectQuery);
      selectQuery.limit.mockReturnValue(selectQuery);
      selectQuery.offset.mockRejectedValue(new Error('DB error'));
      mocks.db.select.mockReturnValue(selectQuery);

      const writer = createMockWriter();
      await expect(exportPharmaciesCsv(writer)).rejects.toThrow('DB error');
      expect(mocks.loggerError).toHaveBeenCalled();
    });

    it('複数バッチでストリーミング出力する', async () => {
      const batch1 = Array.from({ length: 2 }, (_, i) => ({
        id: i + 1, email: `test${i}@example.com`, name: `薬局${i}`,
        prefecture: '東京都', address: '千代田区', postalCode: '100-0001',
        phone: '03-1234-5678', fax: '03-1234-5679',
        isActive: true, isAdmin: false, isTestAccount: false,
        verificationStatus: 'verified', createdAt: '2026-01-01T00:00:00.000Z',
      }));
      const batch2 = [{
        id: 3, email: 'test3@example.com', name: '薬局3',
        prefecture: '大阪府', address: '大阪市', postalCode: '530-0001',
        phone: '06-1234-5678', fax: '06-1234-5679',
        isActive: true, isAdmin: false, isTestAccount: false,
        verificationStatus: 'verified', createdAt: '2026-01-02T00:00:00.000Z',
      }];

      mocks.db.select.mockImplementation(createBatchedSelectMock([batch1, batch2, []]));

      const writer = createMockWriter();
      const count = await exportPharmaciesCsv(writer, { batchSize: 2 });

      expect(count).toBe(3);
    });
  });

  describe('exportExchangesCsv', () => {
    it('交換データをCSV出力する', async () => {
      const mockData = [{
        id: 1, pharmacyAId: 10, pharmacyBId: 20, status: 'completed',
        totalValueA: '5000.00', totalValueB: '4000.00', valueDifference: '1000.00',
        proposedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-05T00:00:00.000Z',
      }];

      mocks.db.select.mockImplementation(createBatchedSelectMock([mockData, []]));

      const writer = createMockWriter();
      const count = await exportExchangesCsv(writer, { batchSize: 10 });

      expect(count).toBe(1);
      const output = writer.output();
      expect(output).toContain('ステータス');
      expect(output).toContain('completed');
    });
  });

  describe('exportReportsCsv', () => {
    it('レポートデータをCSV出力する', async () => {
      const mockData = [{
        id: 1, year: 2026, month: 1, status: 'success',
        generatedAt: '2026-02-01T00:00:00.000Z',
      }];

      mocks.db.select.mockImplementation(createBatchedSelectMock([mockData, []]));

      const writer = createMockWriter();
      const count = await exportReportsCsv(writer, { batchSize: 10 });

      expect(count).toBe(1);
      const output = writer.output();
      expect(output).toContain('年,月');
      expect(output).toContain('2026');
    });
  });
});
