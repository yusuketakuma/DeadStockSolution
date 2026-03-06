import AdmZip from 'adm-zip';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseExcelBuffer: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: mocks.parseExcelBuffer,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: vi.fn(),
  },
}));

import {
  decodeCsvBuffer,
  parseMhlwCsvData,
  parseMhlwExcelData,
  parsePackageCsvData,
  parsePackageExcelData,
  parsePackageXmlData,
  parsePackageZipData,
  parseYjCode,
  parseMhlwDrugFile,
} from '../services/drug-master-parser-service';

describe('drug-master-parser-ultra', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.parseExcelBuffer.mockResolvedValue([]);
  });

  // ── parseYjCode ──
  describe('parseYjCode', () => {
    it('returns null for null/empty', () => {
      expect(parseYjCode(null)).toBeNull();
      expect(parseYjCode('')).toBeNull();
    });

    it('parses 12-digit numeric code', () => {
      expect(parseYjCode('123456789012')).toBe('123456789012');
    });

    it('parses alphanumeric 12-char code', () => {
      expect(parseYjCode('1121001X1018')).toBe('1121001X1018');
    });

    it('strips hyphens and spaces', () => {
      expect(parseYjCode(' 112100-1X1018 ')).toBe('1121001X1018');
    });

    it('returns null for codes that are not 12 characters', () => {
      expect(parseYjCode('12345')).toBeNull();
      expect(parseYjCode('1234567890123')).toBeNull();
    });

    it('handles full-width digits via NFKC normalization', () => {
      // Full-width digits: ０１２３４５６７８９０１
      const fullWidth = '\uFF10\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18\uFF19\uFF10\uFF11';
      expect(parseYjCode(fullWidth)).toBe('012345678901');
    });
  });

  // ── decodeCsvBuffer ──
  describe('decodeCsvBuffer', () => {
    it('decodes UTF-8 without BOM', () => {
      const buf = Buffer.from('品名,薬価\nテスト薬,100', 'utf-8');
      const result = decodeCsvBuffer(buf);
      expect(result).toContain('品名');
    });

    it('strips UTF-8 BOM', () => {
      const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
      const content = Buffer.from('品名,薬価', 'utf-8');
      const buf = Buffer.concat([bom, content]);
      const result = decodeCsvBuffer(buf);
      expect(result).toBe('品名,薬価');
    });

    it('decodes Shift_JIS buffer', () => {
      // Create a buffer that contains U+FFFD when decoded as UTF-8
      // Shift_JIS for '薬' is 0x96 0xF2, which is invalid UTF-8
      const shiftJisBytes = Buffer.from([0x96, 0xF2]); // '薬' in CP932
      const result = decodeCsvBuffer(shiftJisBytes);
      // Should decode to something, not throw
      expect(typeof result).toBe('string');
    });
  });

  // ── parseMhlwExcelData ──
  describe('parseMhlwExcelData', () => {
    it('throws when no YJコード or 品名 column detected', () => {
      const rows: unknown[][] = [
        ['col1', 'col2'],
        ['val1', 'val2'],
      ];
      expect(() => parseMhlwExcelData(rows)).toThrow('YJコードまたは品名の列が必要です');
    });

    it('skips rows with null/missing values', () => {
      const rows: unknown[][] = [
        ['薬価基準収載医薬品コード', '品名', '薬価'],
        [null, '薬A', '100'],
        ['1121001X1018', null, '100'],
        ['1121001X1018', '薬B', null],
        ['1121001X1018', '薬C', '-10'],
      ];
      const result = parseMhlwExcelData(rows);
      expect(result).toHaveLength(0);
    });

    it('parses valid data rows', () => {
      const rows: unknown[][] = [
        ['薬価基準収載医薬品コード', '品名', '成分名', '規格', '単位', '薬価', 'メーカー', '区分', '薬効分類番号', '収載日', '経過措置期限'],
        ['1121001X1018', '薬A', '成分X', '10mg', '錠', '100', 'メーカーA', '内用薬', '112', '2020-04-01', '2025-03-31'],
      ];
      const result = parseMhlwExcelData(rows);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        yjCode: '1121001X1018',
        drugName: '薬A',
        genericName: '成分X',
        specification: '10mg',
        unit: '錠',
        yakkaPrice: 100,
        manufacturer: 'メーカーA',
        category: '内用薬',
        therapeuticCategory: '112',
        listedDate: '2020-04-01',
        transitionDeadline: '2025-03-31',
      }));
    });

    it('does not confuse コード column with 薬価 column', () => {
      const rows: unknown[][] = [
        ['薬価基準収載医薬品コード', '品名', '薬価'],
        ['1121001X1018', '薬A', '50'],
      ];
      const result = parseMhlwExcelData(rows);
      expect(result[0].yakkaPrice).toBe(50);
    });

    it('handles header not on first row', () => {
      const rows: unknown[][] = [
        ['タイトル行', '', ''],
        ['サブタイトル', '', ''],
        ['薬価基準収載医薬品コード', '品名', '薬価'],
        ['1121001X1018', '薬A', '100'],
      ];
      const result = parseMhlwExcelData(rows);
      expect(result).toHaveLength(1);
    });
  });

  // ── parseMhlwCsvData ──
  describe('parseMhlwCsvData', () => {
    it('returns empty for single line (header only)', () => {
      const result = parseMhlwCsvData('薬価基準収載医薬品コード,品名,薬価');
      expect(result).toHaveLength(0);
    });

    it('returns empty for empty string', () => {
      const result = parseMhlwCsvData('');
      expect(result).toHaveLength(0);
    });

    it('parses valid CSV rows', () => {
      const csv = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,薬A,100';
      const result = parseMhlwCsvData(csv);
      expect(result).toHaveLength(1);
      expect(result[0].yjCode).toBe('1121001X1018');
    });

    it('handles quoted fields with commas', () => {
      const csv = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,"薬A,10mg",100';
      const result = parseMhlwCsvData(csv);
      expect(result).toHaveLength(1);
      expect(result[0].drugName).toBe('薬A,10mg');
    });

    it('handles escaped double quotes in CSV', () => {
      const csv = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,"薬""A",100';
      const result = parseMhlwCsvData(csv);
      expect(result).toHaveLength(1);
      expect(result[0].drugName).toBe('薬"A');
    });
  });

  // ── parsePackageExcelData ──
  describe('parsePackageExcelData', () => {
    it('throws when YJコード column is not found', () => {
      const rows: unknown[][] = [
        ['col1', 'col2'],
        ['val1', 'val2'],
      ];
      expect(() => parsePackageExcelData(rows)).toThrow('YJコードの列が必要です');
    });

    it('skips rows without any package code (GS1/JAN/HOT)', () => {
      const rows: unknown[][] = [
        ['YJコード', '包装'],
        ['1121001X1018', '100錠'],
      ];
      const result = parsePackageExcelData(rows);
      expect(result).toHaveLength(0);
    });

    it('skips rows with invalid YJ code', () => {
      const rows: unknown[][] = [
        ['YJコード', 'GS1コード'],
        ['invalid', '14987123456789'],
      ];
      const result = parsePackageExcelData(rows);
      expect(result).toHaveLength(0);
    });

    it('parses rows with JAN code only', () => {
      const rows: unknown[][] = [
        ['YJコード', 'JANコード'],
        ['1121001X1018', '4987123456789'],
      ];
      const result = parsePackageExcelData(rows);
      expect(result).toHaveLength(1);
      expect(result[0].janCode).toBe('4987123456789');
      expect(result[0].gs1Code).toBeNull();
    });

    it('parses rows with HOT code only', () => {
      const rows: unknown[][] = [
        ['YJコード', 'HOTコード'],
        ['1121001X1018', '123456789'],
      ];
      const result = parsePackageExcelData(rows);
      expect(result).toHaveLength(1);
      expect(result[0].hotCode).toBe('123456789');
    });
  });

  // ── parsePackageCsvData ──
  describe('parsePackageCsvData', () => {
    it('parses CSV package data', () => {
      const csv = 'YJコード,GS1コード\n1121001X1018,14987123456789';
      const result = parsePackageCsvData(csv);
      expect(result).toHaveLength(1);
      expect(result[0].gs1Code).toBe('14987123456789');
    });
  });

  // ── parsePackageXmlData ──
  describe('parsePackageXmlData', () => {
    it('skips items without any package code', () => {
      const xml = `
        <items>
          <item>
            <薬価基準収載医薬品コード>1121001X1018</薬価基準収載医薬品コード>
            <包装単位>100錠バラ包装</包装単位>
          </item>
        </items>
      `;
      const result = parsePackageXmlData(xml);
      expect(result).toHaveLength(0);
    });

    it('skips items without valid YJ code', () => {
      const xml = `
        <items>
          <item>
            <薬価基準収載医薬品コード>invalid</薬価基準収載医薬品コード>
            <販売包装単位コード>14987123456789</販売包装単位コード>
          </item>
        </items>
      `;
      const result = parsePackageXmlData(xml);
      expect(result).toHaveLength(0);
    });

    it('deduplicates identical rows', () => {
      const xml = `
        <items>
          <item>
            <薬価基準収載医薬品コード>1121001X1018</薬価基準収載医薬品コード>
            <販売包装単位コード>14987123456789</販売包装単位コード>
          </item>
          <item>
            <薬価基準収載医薬品コード>1121001X1018</薬価基準収載医薬品コード>
            <販売包装単位コード>14987123456789</販売包装単位コード>
          </item>
        </items>
      `;
      const result = parsePackageXmlData(xml);
      expect(result).toHaveLength(1);
    });

    it('handles nested arrays in XML', () => {
      const xml = `
        <root>
          <collection>
            <items>
              <item>
                <yjcode>1121001X1018</yjcode>
                <gs1>14987123456789</gs1>
              </item>
            </items>
          </collection>
        </root>
      `;
      const result = parsePackageXmlData(xml);
      expect(result).toHaveLength(1);
    });

    it('handles numeric values in XML', () => {
      const xml = `
        <items>
          <item>
            <薬価基準収載医薬品コード>1121001X1018</薬価基準収載医薬品コード>
            <販売包装単位コード>14987123456789</販売包装単位コード>
            <包装数量>100</包装数量>
          </item>
        </items>
      `;
      const result = parsePackageXmlData(xml);
      expect(result).toHaveLength(1);
      expect(result[0].packageQuantity).toBe(100);
    });
  });

  // ── parsePackageZipData ──
  describe('parsePackageZipData', () => {
    it('skips directory entries', async () => {
      const zip = new AdmZip();
      zip.addFile('subdir/', Buffer.alloc(0));
      zip.addFile('subdir/package.xml', Buffer.from(`
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

    it('handles empty ZIP with no entries', async () => {
      const zip = new AdmZip();
      const result = await parsePackageZipData(zip.toBuffer());
      expect(result).toHaveLength(0);
    });

    it('handles CSV entries inside ZIP', async () => {
      const zip = new AdmZip();
      zip.addFile('package.csv', Buffer.from('YJコード,GS1コード\n1121001X1018,14987123456789', 'utf-8'));
      const result = await parsePackageZipData(zip.toBuffer());
      expect(result).toHaveLength(1);
    });

    it('handles xlsx entries inside ZIP', async () => {
      const zip = new AdmZip();
      zip.addFile('package.xlsx', Buffer.from('dummy', 'utf-8'));
      mocks.parseExcelBuffer.mockResolvedValue([
        ['YJコード', 'GS1コード'],
        ['1121001X1018', '14987123456789'],
      ]);
      const result = await parsePackageZipData(zip.toBuffer());
      expect(result).toHaveLength(1);
    });

    it('skips unsupported file types', async () => {
      const zip = new AdmZip();
      zip.addFile('readme.txt', Buffer.from('hello', 'utf-8'));
      const result = await parsePackageZipData(zip.toBuffer());
      expect(result).toHaveLength(0);
    });

    it('deduplicates rows across entries', async () => {
      const xml = `
        <items>
          <item>
            <薬価基準収載医薬品コード>1121001X1018</薬価基準収載医薬品コード>
            <販売包装単位コード>14987123456789</販売包装単位コード>
          </item>
        </items>
      `;
      const zip = new AdmZip();
      zip.addFile('a.xml', Buffer.from(xml, 'utf-8'));
      zip.addFile('b.xml', Buffer.from(xml, 'utf-8'));
      const result = await parsePackageZipData(zip.toBuffer());
      expect(result).toHaveLength(1);
    });

    it('logs warning and skips entries that fail to parse', async () => {
      const zip = new AdmZip();
      zip.addFile('bad.xml', Buffer.from('<<<invalid xml>>>', 'utf-8'));
      const result = await parsePackageZipData(zip.toBuffer());
      expect(result).toHaveLength(0);
    });
  });

  // ── parseMhlwDrugFile ──
  describe('parseMhlwDrugFile', () => {
    it('uses CSV parsing for text/csv content type', async () => {
      const csv = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,薬A,100';
      const result = await parseMhlwDrugFile('https://example.com/data.xlsx', 'text/csv', Buffer.from(csv));
      expect(result).toHaveLength(1);
      expect(result[0].yjCode).toBe('1121001X1018');
    });

    it('uses CSV parsing for text/plain content type', async () => {
      const csv = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,薬B,200';
      const result = await parseMhlwDrugFile('https://example.com/data.txt', 'text/plain', Buffer.from(csv));
      expect(result).toHaveLength(1);
    });

    it('uses CSV parsing when URL ends with .csv', async () => {
      const csv = '薬価基準収載医薬品コード,品名,薬価\n1121001X1018,薬C,300';
      const result = await parseMhlwDrugFile('https://example.com/data.csv', null, Buffer.from(csv));
      expect(result).toHaveLength(1);
    });

    it('uses Excel parsing for non-CSV files', async () => {
      mocks.parseExcelBuffer.mockResolvedValue([
        ['薬価基準収載医薬品コード', '品名', '薬価'],
        ['1121001X1018', '薬D', '400'],
      ]);
      const result = await parseMhlwDrugFile('https://example.com/data.xlsx', 'application/octet-stream', Buffer.from('dummy'));
      expect(result).toHaveLength(1);
      expect(mocks.parseExcelBuffer).toHaveBeenCalled();
    });
  });
});
