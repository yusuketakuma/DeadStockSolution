import { describe, it, expect } from 'vitest';
import { parseMhlwCsvData } from '../services/drug-master-parser-service';

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
