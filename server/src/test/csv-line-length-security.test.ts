import { describe, it, expect } from 'vitest';
import { parseMhlwCsvData, parsePackageCsvData } from '../services/drug-master-parser-service';

const MAX_CSV_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_CSV_ROWS = 100000; // 10万行

describe('CSV line length security', () => {
  it('should reject CSV lines exceeding MAX_CSV_LINE_LENGTH', () => {
    // Create a malicious CSV with a very long line
    const longLine = 'a'.repeat(15000);
    const maliciousCsv = `薬価基準収載医薬品コード,品名,薬価\n${longLine},test,100`;

    expect(() => parseMhlwCsvData(maliciousCsv)).toThrow(/CSV行が長すぎます/);
  });

  it('should accept CSV lines within MAX_CSV_LINE_LENGTH', () => {
    // Create a normal CSV within limits
    const normalCsv = `薬価基準収載医薬品コード,品名,薬価
123456789012,テスト薬品,100`;

    const result = parseMhlwCsvData(normalCsv);
    expect(result).toHaveLength(1);
    expect(result[0].yjCode).toBe('123456789012');
    expect(result[0].drugName).toBe('テスト薬品');
    expect(result[0].yakkaPrice).toBe(100);
  });

  it('should handle CSV lines at exactly MAX_CSV_LINE_LENGTH boundary', () => {
    // Create a CSV line exactly at the limit (10000 chars)
    const headerLine = '薬価基準収載医薬品コード,品名,薬価';
    const maxLineLength = 10000;
    const yjCode = '123456789012';
    const drugName = 'a'.repeat(maxLineLength - yjCode.length - ',薬価'.length - 2); // -2 for commas
    const boundaryCsv = `${headerLine}\n${yjCode},${drugName},100`;

    // Should not throw
    const result = parseMhlwCsvData(boundaryCsv);
    expect(result).toHaveLength(1);
  });
});

describe('CSV file size security', () => {
  it('should reject CSV files exceeding MAX_CSV_FILE_SIZE', () => {
    // Create a CSV larger than 50MB (we'll just test the check logic)
    // Note: Actually creating 50MB+ would be slow, so we test with a mock
    const hugeContent = 'x'.repeat(MAX_CSV_FILE_SIZE + 1);
    expect(() => parseMhlwCsvData(hugeContent)).toThrow(/CSVファイルが大きすぎます/);
  });

  it('should reject CSV files with too many rows', () => {
    // Create a CSV with more than 100000 rows
    const header = '薬価基準収載医薬品コード,品名,薬価\n';
    const row = '123456789012,テスト,100\n';
    const hugeRows = row.repeat(MAX_CSV_ROWS + 1);
    const hugeCsv = header + hugeRows;

    expect(() => parseMhlwCsvData(hugeCsv)).toThrow(/CSV行数が上限を超えています/);
  });

  it('should accept CSV files within size and row limits', () => {
    const normalCsv = `薬価基準収載医薬品コード,品名,薬価
123456789012,テスト薬品,100
987654321098,別の薬品,200`;

    const result = parseMhlwCsvData(normalCsv);
    expect(result).toHaveLength(2);
  });
});

describe('parsePackageCsvData security', () => {
  it('should reject package CSV files exceeding MAX_CSV_FILE_SIZE', () => {
    const hugeContent = 'x'.repeat(MAX_CSV_FILE_SIZE + 1);
    expect(() => parsePackageCsvData(hugeContent)).toThrow(/CSVファイルが大きすぎます/);
  });

  it('should reject package CSV files with too many rows', () => {
    const header = 'YJコード,GS1コード,包装\n';
    const row = '123456789012,14987654321001,10錠\n';
    const hugeRows = row.repeat(MAX_CSV_ROWS + 1);
    const hugeCsv = header + hugeRows;

    expect(() => parsePackageCsvData(hugeCsv)).toThrow(/CSV行数が上限を超えています/);
  });
});
