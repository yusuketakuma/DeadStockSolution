import { describe, expect, it } from 'vitest';
import { parseCameraCode } from '../services/gs1-parser';

describe('parseCameraCode', () => {
  it('parses bracketed GS1 code with GTIN, expiry, and lot', () => {
    const result = parseCameraCode('(01)04912345678904(17)260630(10)LOT1234');

    expect(result.codeType).toBe('gs1');
    expect(result.gtin).toBe('04912345678904');
    expect(result.expirationDate).toBe('2026-06-30');
    expect(result.lotNumber).toBe('LOT1234');
  });

  it('parses unbracketed GS1 code with group separator', () => {
    const result = parseCameraCode('01049123456789041726063010LOT1234\u001D');

    expect(result.codeType).toBe('gs1');
    expect(result.gtin).toBe('04912345678904');
    expect(result.expirationDate).toBe('2026-06-30');
    expect(result.lotNumber).toBe('LOT1234');
  });

  it('recognizes a yj code', () => {
    const result = parseCameraCode('2171014F1020');

    expect(result.codeType).toBe('yj');
    expect(result.yjCode).toBe('2171014F1020');
    expect(result.gtin).toBeNull();
  });

  it('handles GTIN-only scan as GS1 and warns about missing fields', () => {
    const result = parseCameraCode('04912345678904');

    expect(result.codeType).toBe('gs1');
    expect(result.gtin).toBe('04912345678904');
    expect(result.expirationDate).toBeNull();
    expect(result.lotNumber).toBeNull();
    expect(result.warnings).toContain('使用期限(AI17)はバーコードから取得できませんでした。');
    expect(result.warnings).toContain('ロット番号(AI10)はバーコードから取得できませんでした。');
  });

  it('returns unknown for unsupported code', () => {
    const result = parseCameraCode('INVALID-CODE-ABC');

    expect(result.codeType).toBe('unknown');
    expect(result.gtin).toBeNull();
    expect(result.yjCode).toBeNull();
  });

  it('does not contaminate lot value with next AI in bracketed form', () => {
    const result = parseCameraCode('(01)04912345678904(10)LOT123(240)ABC');

    expect(result.codeType).toBe('gs1');
    expect(result.gtin).toBe('04912345678904');
    expect(result.lotNumber).toBe('LOT123');
  });
});
