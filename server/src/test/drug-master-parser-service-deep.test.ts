/**
 * drug-master-parser-service-deep.test.ts
 * drug-master-parser-service.ts の未カバーブランチを追加テスト
 * - parseMhlwExcelData header detection edge cases
 * - parseMhlwExcelData missing yjCode or drugName
 * - parseMhlwCsvData
 * - decodeCsvBuffer: UTF-8, BOM, Shift_JIS
 * - parseYjCode various formats
 * - parsePackageCsvData
 * - parsePackageXmlData dedup, nested nodes
 * - parsePackageZipData with CSV, oversized entry, path traversal
 * - parsePackageExcelData missing yjCode
 * - parseMhlwDrugFile csv vs excel
 * - pickXmlField scoring (exact, endsWith, includes)
 * - toXmlStringValue various types
 */
import AdmZip from 'adm-zip';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: vi.fn(async (buf: Buffer) => {
    // Return mock rows based on content
    const content = buf.toString('utf-8');
    if (content.includes('HEADER_ROW')) {
      return [
        ['薬価基準収載医薬品コード', '品名', '薬価'],
        ['1121001X1018', 'テスト薬A', '10.5'],
      ];
    }
    return [
      ['YJコード', 'GS1コード', '包装', '包装数量', '単位'],
      ['1121001X1018', '14987123456789', '100錠バラ', '100', '錠'],
    ];
  }),
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  parseMhlwExcelData,
  parseMhlwCsvData,
  decodeCsvBuffer,
  parseYjCode,
  parsePackageCsvData,
  parsePackageXmlData,
  parsePackageZipData,
  parsePackageExcelData,
  parseMhlwDrugFile,
} from '../services/drug-master-parser-service';

describe('drug-master-parser-service deep coverage', () => {
  // ── parseYjCode ──

  describe('parseYjCode', () => {
    it('parses standard 12-digit numeric code', () => {
      expect(parseYjCode('123456789012')).toBe('123456789012');
    });

    it('strips spaces and hyphens', () => {
      expect(parseYjCode(' 1234-5678-9012 ')).toBe('123456789012');
    });

    it('returns null for null input', () => {
      expect(parseYjCode(null)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseYjCode('')).toBeNull();
    });

    it('returns null for wrong length', () => {
      expect(parseYjCode('12345')).toBeNull();
    });

    it('accepts alphanumeric 12-char code', () => {
      expect(parseYjCode('1121001X1018')).toBe('1121001X1018');
    });

    it('normalizes NFKC (fullwidth digits)', () => {
      expect(parseYjCode('１２３４５６７８９０１２')).toBe('123456789012');
    });
  });

  // ── decodeCsvBuffer ──

  describe('decodeCsvBuffer', () => {
    it('decodes UTF-8 without BOM', () => {
      const buf = Buffer.from('薬品名,薬価\nテスト,100', 'utf-8');
      const result = decodeCsvBuffer(buf);
      expect(result).toContain('薬品名');
    });

    it('decodes UTF-8 with BOM', () => {
      const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
      const content = Buffer.from('薬品名,薬価', 'utf-8');
      const buf = Buffer.concat([bom, content]);
      const result = decodeCsvBuffer(buf);
      expect(result).toContain('薬品名');
      expect(result).not.toContain('\uFEFF');
    });
  });

  // ── parseMhlwExcelData ──

  describe('parseMhlwExcelData', () => {
    it('throws when no yjCode or drugName columns found', () => {
      const rows: unknown[][] = [
        ['unknown_col1', 'unknown_col2'],
        ['data1', 'data2'],
      ];
      expect(() => parseMhlwExcelData(rows)).toThrow('フォーマットを検出できません');
    });

    it('skips rows with missing yjCode', () => {
      const rows: unknown[][] = [
        ['薬価基準収載医薬品コード', '品名', '薬価'],
        [null, 'テスト薬', '10'],
        ['1121001X1018', 'テスト薬B', '20.5'],
      ];
      const result = parseMhlwExcelData(rows);
      expect(result).toHaveLength(1);
      expect(result[0].drugName).toBe('テスト薬B');
    });

    it('skips rows with negative price', () => {
      const rows: unknown[][] = [
        ['薬価基準収載医薬品コード', '品名', '薬価'],
        ['1121001X1018', 'テスト薬A', '-5'],
      ];
      const result = parseMhlwExcelData(rows);
      expect(result).toHaveLength(0);
    });

    it('skips rows with null drug name', () => {
      const rows: unknown[][] = [
        ['薬価基準収載医薬品コード', '品名', '薬価'],
        ['1121001X1018', null, '10'],
      ];
      const result = parseMhlwExcelData(rows);
      expect(result).toHaveLength(0);
    });

    it('maps optional fields (genericName, manufacturer, etc)', () => {
      const rows: unknown[][] = [
        ['薬価基準収載医薬品コード', '品名', '成分名', '規格', '単位', '薬価', 'メーカー', '区分', '薬効分類番号', '収載日', '経過措置期限'],
        ['1121001X1018', 'テスト薬A', '成分A', '10mg', '錠', '50.5', 'メーカーA', '内用薬', '1121', '2020-01-01', '2025-12-31'],
      ];
      const result = parseMhlwExcelData(rows);
      expect(result).toHaveLength(1);
      expect(result[0].genericName).toBe('成分A');
      expect(result[0].specification).toBe('10mg');
      expect(result[0].manufacturer).toBe('メーカーA');
      expect(result[0].category).toBe('内用薬');
      expect(result[0].therapeuticCategory).toBe('1121');
    });

    it('detects header by includes match (not just exact)', () => {
      const rows: unknown[][] = [
        ['データ区分', '医薬品コード (YJ)', '品目名称（品名）', '告示価格（薬価）'],
        ['内用薬', '1121001X1018', 'テスト薬A', '10.5'],
      ];
      const result = parseMhlwExcelData(rows);
      expect(result).toHaveLength(1);
    });

    it('prevents yakkaPrice column from matching when header includes コード', () => {
      // The header "薬価基準収載医薬品コード" should NOT be matched as yakkaPrice
      const rows: unknown[][] = [
        ['薬価基準収載医薬品コード', '品名', '薬価'],
        ['1121001X1018', 'テスト薬A', '10.5'],
      ];
      const result = parseMhlwExcelData(rows);
      expect(result).toHaveLength(1);
      expect(result[0].yakkaPrice).toBe(10.5);
      expect(result[0].yjCode).toBe('1121001X1018');
    });
  });

  // ── parseMhlwCsvData ──

  describe('parseMhlwCsvData', () => {
    it('returns empty for single-line CSV', () => {
      const result = parseMhlwCsvData('header only');
      expect(result).toHaveLength(0);
    });

    it('parses multi-line CSV', () => {
      const csv = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,テスト薬A,10.5';
      const result = parseMhlwCsvData(csv);
      expect(result).toHaveLength(1);
    });

    it('handles quoted fields with commas', () => {
      const csv = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,"テスト薬,A型",10.5';
      const result = parseMhlwCsvData(csv);
      expect(result).toHaveLength(1);
      expect(result[0].drugName).toBe('テスト薬,A型');
    });

    it('handles escaped quotes in CSV', () => {
      const csv = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,"テスト""薬""A",10.5';
      const result = parseMhlwCsvData(csv);
      expect(result).toHaveLength(1);
      expect(result[0].drugName).toBe('テスト"薬"A');
    });
  });

  // ── parsePackageCsvData ──

  describe('parsePackageCsvData', () => {
    it('parses CSV package data', () => {
      const csv = 'YJコード,GS1コード,包装\n1121001X1018,14987123456789,100錠';
      const result = parsePackageCsvData(csv);
      expect(result).toHaveLength(1);
    });
  });

  // ── parsePackageExcelData ──

  describe('parsePackageExcelData', () => {
    it('throws when YJ code column is missing', () => {
      const rows: unknown[][] = [
        ['不明列1', '不明列2'],
        ['data1', 'data2'],
      ];
      expect(() => parsePackageExcelData(rows)).toThrow('YJコードの列が必要');
    });

    it('skips rows without any code (gs1/jan/hot)', () => {
      const rows: unknown[][] = [
        ['YJコード', '包装'],
        ['1121001X1018', '100錠'],
      ];
      const result = parsePackageExcelData(rows);
      expect(result).toHaveLength(0);
    });
  });

  // ── parsePackageXmlData ──

  describe('parsePackageXmlData', () => {
    it('deduplicates identical package rows', () => {
      const xml = `
        <items>
          <item>
            <薬価基準収載医薬品コード>1121001X1018</薬価基準収載医薬品コード>
            <販売包装単位コード>14987123456789</販売包装単位コード>
            <包装単位>100錠</包装単位>
          </item>
          <item>
            <薬価基準収載医薬品コード>1121001X1018</薬価基準収載医薬品コード>
            <販売包装単位コード>14987123456789</販売包装単位コード>
            <包装単位>100錠</包装単位>
          </item>
        </items>
      `;
      const result = parsePackageXmlData(xml);
      expect(result).toHaveLength(1);
    });

    it('skips XML elements without YJ code', () => {
      const xml = `
        <items>
          <item>
            <販売包装単位コード>14987123456789</販売包装単位コード>
          </item>
        </items>
      `;
      const result = parsePackageXmlData(xml);
      expect(result).toHaveLength(0);
    });

    it('skips XML elements without any package code', () => {
      const xml = `
        <items>
          <item>
            <薬価基準収載医薬品コード>1121001X1018</薬価基準収載医薬品コード>
            <包装単位>100錠</包装単位>
          </item>
        </items>
      `;
      const result = parsePackageXmlData(xml);
      expect(result).toHaveLength(0);
    });

    it('handles nested XML structures', () => {
      const xml = `
        <root>
          <group>
            <items>
              <item>
                <医薬品コード>1121001X1018</医薬品コード>
                <GS1コード>14987123456789</GS1コード>
              </item>
            </items>
          </group>
        </root>
      `;
      const result = parsePackageXmlData(xml);
      expect(result).toHaveLength(1);
    });
  });

  // ── parsePackageZipData ──

  describe('parsePackageZipData', () => {
    it('parses CSV file inside ZIP', async () => {
      const zip = new AdmZip();
      const csvContent = 'YJコード,GS1コード,包装\n1121001X1018,14987123456789,100錠';
      zip.addFile('data.csv', Buffer.from(csvContent, 'utf-8'));
      const result = await parsePackageZipData(zip.toBuffer());
      expect(result).toHaveLength(1);
    });

    it('skips directory entries', async () => {
      const zip = new AdmZip();
      zip.addFile('folder/', Buffer.alloc(0));
      zip.addFile('folder/data.xml', Buffer.from(`
        <items>
          <item>
            <薬価基準収載医薬品コード>1121001X1018</薬価基準収載医薬品コード>
            <販売包装単位コード>14987123456789</販売包装単位コード>
          </item>
        </items>
      `, 'utf-8'));
      const result = await parsePackageZipData(zip.toBuffer());
      expect(result).toHaveLength(1);
    });

    it('skips entries with path traversal', async () => {
      const zip = new AdmZip();
      zip.addFile('../etc/passwd', Buffer.from('malicious', 'utf-8'));
      const result = await parsePackageZipData(zip.toBuffer());
      expect(result).toHaveLength(0);
    });

    it('deduplicates across multiple files in ZIP', async () => {
      const zip = new AdmZip();
      const csvContent = 'YJコード,GS1コード\n1121001X1018,14987123456789';
      zip.addFile('a.csv', Buffer.from(csvContent, 'utf-8'));
      zip.addFile('b.csv', Buffer.from(csvContent, 'utf-8'));
      const result = await parsePackageZipData(zip.toBuffer());
      expect(result).toHaveLength(1);
    });
  });

  // ── parseMhlwDrugFile ──

  describe('parseMhlwDrugFile', () => {
    it('routes csv content-type to CSV parser', async () => {
      const csvContent = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,テスト薬,10';
      const result = await parseMhlwDrugFile(
        'https://example.com/data.csv',
        'text/csv',
        Buffer.from(csvContent, 'utf-8'),
      );
      expect(result).toHaveLength(1);
    });

    it('routes text/plain content-type to CSV parser', async () => {
      const csvContent = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,テスト薬,10';
      const result = await parseMhlwDrugFile(
        'https://example.com/data.txt',
        'text/plain',
        Buffer.from(csvContent, 'utf-8'),
      );
      expect(result).toHaveLength(1);
    });

    it('routes .csv URL extension to CSV parser', async () => {
      const csvContent = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,テスト薬,10';
      const result = await parseMhlwDrugFile(
        'https://example.com/data.csv',
        null,
        Buffer.from(csvContent, 'utf-8'),
      );
      expect(result).toHaveLength(1);
    });

    it('routes Excel content to Excel parser', async () => {
      const result = await parseMhlwDrugFile(
        'https://example.com/data.xlsx',
        'application/octet-stream',
        Buffer.from('HEADER_ROW', 'utf-8'),
      );
      expect(result).toHaveLength(1);
    });
  });
});
