import { describe, it, expect } from 'vitest';
import { normalizeString, parseNumber } from '../utils/string-utils';

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
