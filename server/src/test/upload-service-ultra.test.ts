import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readXlsxFile: vi.fn(),
}));

vi.mock('read-excel-file/node', () => ({
  default: mocks.readXlsxFile,
}));

import { parseExcelBuffer, getPreviewRows } from '../services/upload-service';

describe('upload-service ultra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('parseExcelBuffer', () => {
    it('parses normal rows', async () => {
      mocks.readXlsxFile.mockResolvedValue([
        ['コード', '薬剤名'],
        ['111', '薬A'],
      ]);

      const result = await parseExcelBuffer(Buffer.from('ultra-normal-rows'));
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(['コード', '薬剤名']);
    });

    it('converts Date cells to ISO strings', async () => {
      const dateObj = new Date('2026-03-15T00:00:00Z');
      mocks.readXlsxFile.mockResolvedValue([
        ['date_col'],
        [dateObj],
      ]);

      const result = await parseExcelBuffer(Buffer.from('ultra-date-cells'));
      expect(result[1][0]).toBe(dateObj.toISOString());
    });

    it('converts null cells to empty string', async () => {
      mocks.readXlsxFile.mockResolvedValue([
        ['col1'],
        [null],
      ]);

      const result = await parseExcelBuffer(Buffer.from('ultra-null-cells'));
      expect(result[1][0]).toBe('');
    });

    it('converts undefined cells to empty string', async () => {
      mocks.readXlsxFile.mockResolvedValue([
        ['col1'],
        [undefined],
      ]);

      const result = await parseExcelBuffer(Buffer.from('ultra-undef-cells'));
      expect(result[1][0]).toBe('');
    });

    it('throws when row count exceeds MAX_UPLOAD_ROWS', async () => {
      const hugeRows = Array.from({ length: 100001 }, (_, i) => [`row${i}`]);
      mocks.readXlsxFile.mockResolvedValue(hugeRows);

      await expect(parseExcelBuffer(Buffer.from('ultra-huge-rows'))).rejects.toThrow('行数が上限');
    });

    it('throws when column count exceeds MAX_UPLOAD_COLUMNS', async () => {
      const wideRow = Array.from({ length: 201 }, (_, i) => `col${i}`);
      mocks.readXlsxFile.mockResolvedValue([wideRow]);

      await expect(parseExcelBuffer(Buffer.from('ultra-wide-cols'))).rejects.toThrow('列数が上限');
    });

    it('throws when total cells exceed MAX_UPLOAD_CELLS', async () => {
      // 200 columns x 15001 rows = 3_000_200 > 3_000_000
      const row = Array.from({ length: 200 }, (_, i) => `col${i}`);
      const rows = Array.from({ length: 15001 }, () => [...row]);
      mocks.readXlsxFile.mockResolvedValue(rows);

      await expect(parseExcelBuffer(Buffer.from('ultra-many-cells'))).rejects.toThrow('セル数が上限');
    });

    it('returns cached result for same buffer on second call', async () => {
      mocks.readXlsxFile.mockResolvedValue([
        ['col1'],
        ['val1'],
      ]);

      const buffer = Buffer.from('ultra-cache-test-unique');
      const result1 = await parseExcelBuffer(buffer);
      const result2 = await parseExcelBuffer(buffer);

      expect(result1).toEqual(result2);
      // readXlsxFile should only be called once (second call uses cache)
      expect(mocks.readXlsxFile).toHaveBeenCalledTimes(1);
    });

    it('does not cache buffers larger than MAX_CACHEABLE_BUFFER_BYTES', async () => {
      mocks.readXlsxFile.mockResolvedValue([
        ['col1'],
        ['val1'],
      ]);

      // Create a buffer larger than 5MB
      const bigBuffer = Buffer.alloc(5 * 1024 * 1024 + 1, 'x');
      const result1 = await parseExcelBuffer(bigBuffer);
      const result2 = await parseExcelBuffer(bigBuffer);

      expect(result1).toEqual(result2);
      // Both calls should invoke readXlsxFile since big buffers aren't cached
      expect(mocks.readXlsxFile).toHaveBeenCalledTimes(2);
    });

    it('keeps numbers as-is', async () => {
      mocks.readXlsxFile.mockResolvedValue([
        ['qty'],
        [42],
      ]);

      const result = await parseExcelBuffer(Buffer.from('ultra-number-test'));
      expect(result[1][0]).toBe(42);
    });

    it('keeps strings as-is', async () => {
      mocks.readXlsxFile.mockResolvedValue([
        ['name'],
        ['hello'],
      ]);

      const result = await parseExcelBuffer(Buffer.from('ultra-string-test'));
      expect(result[1][0]).toBe('hello');
    });
  });

  describe('getPreviewRows', () => {
    it('returns first N data rows after header', () => {
      const allRows = [
        ['header1', 'header2'],
        ['data1-1', 'data1-2'],
        ['data2-1', 'data2-2'],
        ['data3-1', 'data3-2'],
      ];
      const preview = getPreviewRows(allRows, 0, 2);
      expect(preview).toEqual([
        ['data1-1', 'data1-2'],
        ['data2-1', 'data2-2'],
      ]);
    });

    it('returns all remaining rows when fewer than count', () => {
      const allRows = [
        ['header1'],
        ['data1'],
      ];
      const preview = getPreviewRows(allRows, 0, 5);
      expect(preview).toEqual([['data1']]);
    });

    it('uses default count of 5', () => {
      const allRows = Array.from({ length: 10 }, (_, i) => [`row${i}`]);
      const preview = getPreviewRows(allRows, 0);
      expect(preview).toHaveLength(5);
    });

    it('handles headerRowIndex > 0', () => {
      const allRows = [
        ['junk'],
        ['header1'],
        ['data1'],
        ['data2'],
      ];
      const preview = getPreviewRows(allRows, 1, 5);
      expect(preview).toEqual([['data1'], ['data2']]);
    });
  });
});
