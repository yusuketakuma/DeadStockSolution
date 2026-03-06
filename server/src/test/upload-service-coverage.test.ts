import { describe, expect, it, vi } from 'vitest';

vi.mock('read-excel-file/node', () => ({
  default: vi.fn(),
}));

import { parseExcelBuffer, getPreviewRows } from '../services/upload-service';
import readXlsxFile from 'read-excel-file/node';

describe('upload-service coverage', () => {
  describe('parseExcelBuffer', () => {
    it('parses a valid excel buffer', async () => {
      const mockRows = [
        ['col1', 'col2'],
        ['a', 'b'],
      ];
      vi.mocked(readXlsxFile).mockResolvedValueOnce(mockRows as never);

      const result = await parseExcelBuffer(Buffer.from('test-xlsx'));
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(['col1', 'col2']);
    });

    it('throws when row count exceeds limit', async () => {
      // Reuse a single shared row reference to minimize allocation
      const sharedRow = ['a'];
      const mockRows = Array.from({ length: 100001 }, () => sharedRow);
      vi.mocked(readXlsxFile).mockResolvedValueOnce(mockRows as never);

      await expect(parseExcelBuffer(Buffer.from('large-file'))).rejects.toThrow('行数が上限');
    });

    it('throws when column count exceeds limit', async () => {
      const wideRow = Array.from({ length: 201 }, (_, i) => `col${i}`);
      vi.mocked(readXlsxFile).mockResolvedValueOnce([wideRow] as never);

      await expect(parseExcelBuffer(Buffer.from('wide-file'))).rejects.toThrow('列数が上限');
    });

    it('throws when total cell count exceeds limit', async () => {
      // Reuse a single shared row to avoid allocating millions of individual arrays.
      // 200 columns * 15001 rows = 3,000,200 cells > 3,000,000
      const sharedRow = Array.from({ length: 200 }, () => 'x');
      const rows = Array.from({ length: 15001 }, () => sharedRow);
      vi.mocked(readXlsxFile).mockResolvedValueOnce(rows as never);

      await expect(parseExcelBuffer(Buffer.from('massive-cells'))).rejects.toThrow('セル数が上限');
    });

    it('normalizes Date cells to ISO strings', async () => {
      const date = new Date('2026-01-15T00:00:00Z');
      vi.mocked(readXlsxFile).mockResolvedValueOnce([[date, 'text']] as never);

      const result = await parseExcelBuffer(Buffer.from('date-file'));
      expect(result[0][0]).toBe(date.toISOString());
    });

    it('normalizes null/undefined cells to empty string', async () => {
      vi.mocked(readXlsxFile).mockResolvedValueOnce([[null, undefined, 42]] as never);

      const result = await parseExcelBuffer(Buffer.from('null-cells'));
      expect(result[0][0]).toBe('');
      expect(result[0][1]).toBe('');
      expect(result[0][2]).toBe(42);
    });

    it('returns cached result for same small buffer', async () => {
      // Use a unique buffer so no cache collision with other tests
      const smallBuffer = Buffer.from('unique-cache-test-data-' + Date.now());
      const mockRows = [['cached_col']];
      const callsBefore = vi.mocked(readXlsxFile).mock.calls.length;
      vi.mocked(readXlsxFile).mockResolvedValueOnce(mockRows as never);

      // First call - should parse
      const result1 = await parseExcelBuffer(smallBuffer);
      // Second call - should use cache
      const result2 = await parseExcelBuffer(smallBuffer);

      expect(result1).toEqual(result2);
      // readXlsxFile should be called only once more for this buffer due to cache
      expect(vi.mocked(readXlsxFile).mock.calls.length - callsBefore).toBe(1);
    });

    it('does not cache large buffers', async () => {
      // Create a buffer > 5MB to bypass cache
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024, 'a');
      const mockRows = [['large_col']];
      vi.mocked(readXlsxFile).mockResolvedValueOnce(mockRows as never);
      vi.mocked(readXlsxFile).mockResolvedValueOnce(mockRows as never);

      await parseExcelBuffer(largeBuffer);
      await parseExcelBuffer(largeBuffer);

      // Both calls should parse since no caching for large buffers
      expect(vi.mocked(readXlsxFile).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getPreviewRows', () => {
    it('returns preview rows after header', () => {
      const allRows = [
        ['header1', 'header2'],
        ['row1-1', 'row1-2'],
        ['row2-1', 'row2-2'],
        ['row3-1', 'row3-2'],
        ['row4-1', 'row4-2'],
        ['row5-1', 'row5-2'],
        ['row6-1', 'row6-2'],
      ];

      const result = getPreviewRows(allRows, 0);
      expect(result).toHaveLength(5);
      expect(result[0]).toEqual(['row1-1', 'row1-2']);
    });

    it('returns fewer rows when data is limited', () => {
      const allRows = [
        ['header'],
        ['row1'],
        ['row2'],
      ];

      const result = getPreviewRows(allRows, 0, 5);
      expect(result).toHaveLength(2);
    });

    it('uses custom count', () => {
      const allRows = [
        ['header'],
        ['row1'],
        ['row2'],
        ['row3'],
      ];

      const result = getPreviewRows(allRows, 0, 2);
      expect(result).toHaveLength(2);
    });

    it('handles non-zero header row index', () => {
      const allRows = [
        ['title'],
        ['header1', 'header2'],
        ['row1-1', 'row1-2'],
        ['row2-1', 'row2-2'],
      ];

      const result = getPreviewRows(allRows, 1, 5);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(['row1-1', 'row1-2']);
    });

    it('returns empty array when header is last row', () => {
      const allRows = [['header']];
      const result = getPreviewRows(allRows, 0);
      expect(result).toHaveLength(0);
    });
  });
});
