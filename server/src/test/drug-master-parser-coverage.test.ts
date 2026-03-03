import AdmZip from 'adm-zip';
import { describe, expect, it, vi } from 'vitest';
import {
  parseMhlwExcelData,
  parseMhlwCsvData,
  parsePackageExcelData,
  parsePackageCsvData,
  parsePackageXmlData,
  parsePackageZipData,
  parseYjCode,
  decodeCsvBuffer,
  parseMhlwDrugFile,
} from '../services/drug-master-parser-service';

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: vi.fn().mockImplementation(async (buffer: Buffer) => {
    // Return minimal valid structure for Excel parsing
    return [
      ['薬価基準収載医薬品コード', '品名', '薬価'],
      ['111111111111', 'テスト薬', '10.5'],
    ];
  }),
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('parseYjCode', () => {
  it('returns null for null input', () => {
    expect(parseYjCode(null)).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(parseYjCode('')).toBe(null);
  });

  it('parses valid 12-digit YJ code', () => {
    expect(parseYjCode('111111111111')).toBe('111111111111');
  });

  it('strips spaces and hyphens', () => {
    expect(parseYjCode('1111-1111-1111')).toBe('111111111111');
    expect(parseYjCode(' 111111111111 ')).toBe('111111111111');
  });

  it('handles alphanumeric YJ codes', () => {
    expect(parseYjCode('1121001X1018')).toBe('1121001X1018');
  });

  it('returns null for codes shorter than 12', () => {
    expect(parseYjCode('12345')).toBe(null);
  });

  it('returns null for codes longer than 12', () => {
    expect(parseYjCode('1234567890123')).toBe(null);
  });

  it('normalizes NFKC characters', () => {
    // Full-width digits -> half-width
    const fullWidth = '\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18\uff19\uff10\uff11\uff12';
    expect(parseYjCode(fullWidth)).toBe('123456789012');
  });
});

describe('decodeCsvBuffer', () => {
  it('decodes UTF-8 buffer correctly', () => {
    const text = '薬価基準収載医薬品コード,品名\n111111111111,テスト薬';
    const buffer = Buffer.from(text, 'utf-8');
    const result = decodeCsvBuffer(buffer);
    expect(result).toContain('薬価基準収載医薬品コード');
  });

  it('decodes UTF-8 with BOM', () => {
    const text = '薬価基準収載医薬品コード,品名';
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const content = Buffer.from(text, 'utf-8');
    const buffer = Buffer.concat([bom, content]);
    const result = decodeCsvBuffer(buffer);
    expect(result).toContain('薬価基準収載医薬品コード');
    // BOM should be stripped
    expect(result.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe('parseMhlwExcelData', () => {
  it('parses standard MHLW Excel format', () => {
    const rows: unknown[][] = [
      ['薬価基準収載医薬品コード', '品名', '薬価'],
      ['111111111111', 'テスト薬A', '10.5'],
      ['222222222222', 'テスト薬B', '20.0'],
    ];

    const result = parseMhlwExcelData(rows);
    expect(result).toHaveLength(2);
    expect(result[0].yjCode).toBe('111111111111');
    expect(result[0].drugName).toBe('テスト薬A');
    expect(result[0].yakkaPrice).toBe(10.5);
    expect(result[1].yjCode).toBe('222222222222');
  });

  it('throws when no recognizable header found', () => {
    const rows: unknown[][] = [
      ['列A', '列B', '列C'],
      ['data1', 'data2', 'data3'],
    ];

    expect(() => parseMhlwExcelData(rows)).toThrow('フォーマットを検出できません');
  });

  it('skips rows with missing required fields', () => {
    const rows: unknown[][] = [
      ['薬価基準収載医薬品コード', '品名', '薬価'],
      ['111111111111', 'テスト薬', '10.5'],
      [null, 'テスト薬B', '20.0'],         // missing yjCode
      ['222222222222', null, '30.0'],        // missing drugName
      ['333333333333', 'テスト薬D', null],   // missing price
      ['444444444444', 'テスト薬E', '-1'],   // negative price
    ];

    const result = parseMhlwExcelData(rows);
    expect(result).toHaveLength(1);
    expect(result[0].yjCode).toBe('111111111111');
  });

  it('handles header row not on first row', () => {
    const rows: unknown[][] = [
      ['タイトル行'],
      [],
      ['薬価基準収載医薬品コード', '品名', '薬価'],
      ['111111111111', 'テスト薬', '10.5'],
    ];

    const result = parseMhlwExcelData(rows);
    expect(result).toHaveLength(1);
    expect(result[0].yjCode).toBe('111111111111');
  });

  it('maps optional columns correctly', () => {
    const rows: unknown[][] = [
      ['薬価基準収載医薬品コード', '品名', '成分名', '規格', '単位', '薬価', 'メーカー', '区分', '薬効分類番号', '収載日', '経過措置期限'],
      ['111111111111', 'テスト薬', '成分A', '10mg', '錠', '10.5', 'メーカーA', '内用薬', '123', '2025-01-01', '2026-12-31'],
    ];

    const result = parseMhlwExcelData(rows);
    expect(result).toHaveLength(1);
    expect(result[0].genericName).toBe('成分A');
    expect(result[0].specification).toBe('10mg');
    expect(result[0].unit).toBe('錠');
    expect(result[0].manufacturer).toBe('メーカーA');
    expect(result[0].category).toBe('内用薬');
    expect(result[0].therapeuticCategory).toBe('123');
    expect(result[0].listedDate).toBe('2025-01-01');
    expect(result[0].transitionDeadline).toBe('2026-12-31');
  });

  it('skips null rows', () => {
    const rows: unknown[][] = [
      ['薬価基準収載医薬品コード', '品名', '薬価'],
      null as unknown as unknown[],
      ['111111111111', 'テスト薬', '10.5'],
    ];

    const result = parseMhlwExcelData(rows);
    expect(result).toHaveLength(1);
  });

  it('handles yakkaPrice column disambiguation from code column', () => {
    // '薬価基準収載医薬品コード' contains '薬価' but should NOT be mapped as yakkaPrice
    const rows: unknown[][] = [
      ['区分', '薬価基準収載医薬品コード', '品名', '薬価'],
      ['内用薬', '111111111111', 'テスト薬', '10.5'],
    ];

    const result = parseMhlwExcelData(rows);
    expect(result).toHaveLength(1);
    expect(result[0].yakkaPrice).toBe(10.5);
  });
});

describe('parseMhlwCsvData', () => {
  it('parses CSV with MHLW headers', () => {
    const csv = '薬価基準収載医薬品コード,品名,薬価\n111111111111,テスト薬,10.5';
    const result = parseMhlwCsvData(csv);
    expect(result).toHaveLength(1);
    expect(result[0].yjCode).toBe('111111111111');
  });

  it('returns empty for CSV with only header', () => {
    const csv = '薬価基準収載医薬品コード,品名,薬価';
    const result = parseMhlwCsvData(csv);
    expect(result).toHaveLength(0);
  });

  it('returns empty for single-line CSV', () => {
    const csv = 'just one line';
    const result = parseMhlwCsvData(csv);
    expect(result).toHaveLength(0);
  });

  it('handles quoted CSV fields with commas', () => {
    const csv = '薬価基準収載医薬品コード,品名,薬価\n111111111111,"テスト薬,特殊",10.5';
    const result = parseMhlwCsvData(csv);
    expect(result).toHaveLength(1);
    expect(result[0].drugName).toBe('テスト薬,特殊');
  });

  it('handles escaped quotes in CSV', () => {
    const csv = '薬価基準収載医薬品コード,品名,薬価\n111111111111,"テスト""薬",10.5';
    const result = parseMhlwCsvData(csv);
    expect(result).toHaveLength(1);
    expect(result[0].drugName).toBe('テスト"薬');
  });
});

describe('parsePackageExcelData', () => {
  it('throws when yjCode header is not found', () => {
    const rows: unknown[][] = [
      ['列A', '列B', '列C'],
      ['data1', 'data2', 'data3'],
    ];

    expect(() => parsePackageExcelData(rows)).toThrow('YJコードの列が必要');
  });

  it('skips rows without any code (gs1, jan, hot)', () => {
    const rows: unknown[][] = [
      ['YJコード', '包装'],
      ['111111111111', '100錠'],
    ];

    const result = parsePackageExcelData(rows);
    expect(result).toHaveLength(0);
  });

  it('parses package rows with JAN code', () => {
    const rows: unknown[][] = [
      ['YJコード', 'JANコード', '包装'],
      ['111111111111', '4987123456789', '100錠'],
    ];

    const result = parsePackageExcelData(rows);
    expect(result).toHaveLength(1);
    expect(result[0].janCode).toBe('4987123456789');
  });

  it('parses package rows with HOT code', () => {
    const rows: unknown[][] = [
      ['YJコード', 'HOTコード', '包装'],
      ['111111111111', '123456789', '100錠'],
    ];

    const result = parsePackageExcelData(rows);
    expect(result).toHaveLength(1);
    expect(result[0].hotCode).toBe('123456789');
  });
});

describe('parsePackageCsvData', () => {
  it('parses package CSV data', () => {
    const csv = 'YJコード,GS1コード,包装\n111111111111,14987123456789,100錠';
    const result = parsePackageCsvData(csv);
    expect(result).toHaveLength(1);
    expect(result[0].gs1Code).toBe('14987123456789');
  });
});

describe('parsePackageXmlData', () => {
  it('deduplicates identical XML entries', () => {
    const xml = `
      <items>
        <item>
          <薬価基準収載医薬品コード>111111111111</薬価基準収載医薬品コード>
          <販売包装単位コード>14987123456789</販売包装単位コード>
          <包装単位>100錠</包装単位>
        </item>
        <item>
          <薬価基準収載医薬品コード>111111111111</薬価基準収載医薬品コード>
          <販売包装単位コード>14987123456789</販売包装単位コード>
          <包装単位>100錠</包装単位>
        </item>
      </items>
    `;

    const result = parsePackageXmlData(xml);
    expect(result).toHaveLength(1);
  });

  it('returns empty for XML with no recognizable package data', () => {
    const xml = '<root><item><unrelated>data</unrelated></item></root>';
    const result = parsePackageXmlData(xml);
    expect(result).toHaveLength(0);
  });

  it('handles nested XML structures', () => {
    const xml = `
      <root>
        <container>
          <packages>
            <package>
              <yjcode>111111111111</yjcode>
              <gs1>14987123456789</gs1>
            </package>
          </packages>
        </container>
      </root>
    `;
    const result = parsePackageXmlData(xml);
    expect(result).toHaveLength(1);
  });

  it('ignores items without codes', () => {
    const xml = `
      <items>
        <item>
          <薬価基準収載医薬品コード>111111111111</薬価基準収載医薬品コード>
        </item>
      </items>
    `;
    const result = parsePackageXmlData(xml);
    expect(result).toHaveLength(0);
  });
});

describe('parsePackageZipData', () => {
  it('handles empty zip file', async () => {
    const zip = new AdmZip();
    const result = await parsePackageZipData(zip.toBuffer());
    expect(result).toHaveLength(0);
  });

  it('parses CSV inside zip', async () => {
    const zip = new AdmZip();
    zip.addFile(
      'packages.csv',
      Buffer.from('YJコード,GS1コード,包装\n111111111111,14987123456789,100錠', 'utf-8'),
    );
    const result = await parsePackageZipData(zip.toBuffer());
    expect(result).toHaveLength(1);
    expect(result[0].gs1Code).toBe('14987123456789');
  });

  it('skips directory entries', async () => {
    const zip = new AdmZip();
    zip.addFile('subdir/', Buffer.alloc(0));
    zip.addFile(
      'subdir/packages.xml',
      Buffer.from(
        `<items>
          <item>
            <薬価基準収載医薬品コード>111111111111</薬価基準収載医薬品コード>
            <販売包装単位コード>14987123456789</販売包装単位コード>
          </item>
        </items>`,
        'utf-8',
      ),
    );
    const result = await parsePackageZipData(zip.toBuffer());
    expect(result).toHaveLength(1);
  });

  it('handles non-matching file extensions in zip', async () => {
    const zip = new AdmZip();
    // .txt files should be ignored (not csv, xml, or xlsx)
    zip.addFile(
      'readme.txt',
      Buffer.from('This is not a package file', 'utf-8'),
    );
    const result = await parsePackageZipData(zip.toBuffer());
    expect(result).toHaveLength(0);
  });

  it('deduplicates entries across multiple files in zip', async () => {
    const zip = new AdmZip();
    const xml = `<items><item>
      <薬価基準収載医薬品コード>111111111111</薬価基準収載医薬品コード>
      <販売包装単位コード>14987123456789</販売包装単位コード>
    </item></items>`;
    zip.addFile('file1.xml', Buffer.from(xml, 'utf-8'));
    zip.addFile('file2.xml', Buffer.from(xml, 'utf-8'));
    const result = await parsePackageZipData(zip.toBuffer());
    expect(result).toHaveLength(1);
  });
});

describe('parseMhlwDrugFile', () => {
  it('detects CSV by content type', async () => {
    const csv = '薬価基準収載医薬品コード,品名,薬価\n111111111111,テスト薬,10.5';
    const buffer = Buffer.from(csv, 'utf-8');
    const result = await parseMhlwDrugFile('https://example.com/file.dat', 'text/csv', buffer);
    expect(result).toHaveLength(1);
  });

  it('detects CSV by text/plain content type', async () => {
    const csv = '薬価基準収載医薬品コード,品名,薬価\n111111111111,テスト薬,10.5';
    const buffer = Buffer.from(csv, 'utf-8');
    const result = await parseMhlwDrugFile('https://example.com/file.dat', 'text/plain', buffer);
    expect(result).toHaveLength(1);
  });

  it('detects CSV by file extension', async () => {
    const csv = '薬価基準収載医薬品コード,品名,薬価\n111111111111,テスト薬,10.5';
    const buffer = Buffer.from(csv, 'utf-8');
    const result = await parseMhlwDrugFile('https://example.com/file.csv', null, buffer);
    expect(result).toHaveLength(1);
  });

  it('falls back to Excel parsing for non-CSV', async () => {
    const buffer = Buffer.from('excel-data');
    const result = await parseMhlwDrugFile('https://example.com/file.xlsx', 'application/octet-stream', buffer);
    // parseExcelBuffer is mocked to return valid structure
    expect(result).toHaveLength(1);
  });
});
