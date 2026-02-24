import { describe, it, expect } from 'vitest';
import { normalizeString, normalizeDrugName, toHalfWidth, parseNumber } from '../utils/string-utils';

describe('normalizeString', () => {
  it('converts full-width to half-width', () => {
    expect(normalizeString('ＡＢＣ１２３')).toBe('abc123');
  });

  it('removes whitespace', () => {
    expect(normalizeString('hello  world')).toBe('helloworld');
  });

  it('removes parentheses', () => {
    expect(normalizeString('test（inner）end')).toBe('testinnerend');
  });

  it('converts to lowercase', () => {
    expect(normalizeString('UPPER')).toBe('upper');
  });
});

describe('normalizeDrugName', () => {
  it('normalizes NFKC', () => {
    expect(normalizeDrugName('テスト薬')).toBe('テスト薬');
  });

  it('removes whitespace', () => {
    expect(normalizeDrugName('テスト 薬')).toBe('テスト薬');
  });
});

describe('toHalfWidth', () => {
  it('converts full-width alphanumeric to half-width', () => {
    expect(toHalfWidth('Ａ')).toBe('A');
    expect(toHalfWidth('ｚ')).toBe('z');
    expect(toHalfWidth('０')).toBe('0');
    expect(toHalfWidth('９')).toBe('9');
  });

  it('preserves half-width characters', () => {
    expect(toHalfWidth('abc123')).toBe('abc123');
  });

  it('preserves non-alphanumeric characters', () => {
    expect(toHalfWidth('あいう')).toBe('あいう');
  });
});

describe('parseNumber', () => {
  it('returns number for valid number', () => {
    expect(parseNumber(42)).toBe(42);
    expect(parseNumber(3.14)).toBe(3.14);
  });

  it('parses string numbers', () => {
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber('3.14')).toBe(3.14);
  });

  it('handles comma-separated numbers', () => {
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('1,234,567')).toBe(1234567);
  });

  it('returns null for empty/null/undefined', () => {
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('returns null for NaN/Infinity', () => {
    expect(parseNumber(NaN)).toBeNull();
    expect(parseNumber(Infinity)).toBeNull();
  });

  it('returns null for non-numeric strings', () => {
    expect(parseNumber('abc')).toBeNull();
  });

  it('handles whitespace', () => {
    expect(parseNumber('  42  ')).toBe(42);
  });
});
