import { describe, it, expect } from 'vitest';
import { parsePositiveInt, parsePagination, normalizeSearchTerm } from '../utils/request-utils';

describe('parsePositiveInt', () => {
  it('parses valid positive integers', () => {
    expect(parsePositiveInt('1')).toBe(1);
    expect(parsePositiveInt('42')).toBe(42);
    expect(parsePositiveInt('999')).toBe(999);
  });

  it('returns null for zero', () => {
    expect(parsePositiveInt('0')).toBeNull();
  });

  it('returns null for negative numbers', () => {
    expect(parsePositiveInt('-1')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parsePositiveInt(42)).toBeNull();
    expect(parsePositiveInt(null)).toBeNull();
    expect(parsePositiveInt(undefined)).toBeNull();
  });

  it('returns null for non-numeric strings', () => {
    expect(parsePositiveInt('abc')).toBeNull();
    expect(parsePositiveInt('12abc')).toBeNull();
    expect(parsePositiveInt('1.5')).toBeNull();
  });

  it('handles whitespace', () => {
    expect(parsePositiveInt(' 42 ')).toBe(42);
  });
});

describe('parsePagination', () => {
  it('returns defaults when no input', () => {
    const result = parsePagination(undefined, undefined);
    expect(result).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it('parses page and limit', () => {
    const result = parsePagination('2', '10');
    expect(result).toEqual({ page: 2, limit: 10, offset: 10 });
  });

  it('respects maxLimit', () => {
    const result = parsePagination('1', '500', { maxLimit: 100 });
    expect(result.limit).toBe(100);
  });

  it('respects custom defaults', () => {
    const result = parsePagination(undefined, undefined, { defaultLimit: 50 });
    expect(result.limit).toBe(50);
  });

  it('calculates offset correctly', () => {
    const result = parsePagination('3', '20');
    expect(result.offset).toBe(40);
  });
});

describe('normalizeSearchTerm', () => {
  it('returns undefined for non-string input', () => {
    expect(normalizeSearchTerm(undefined)).toBeUndefined();
    expect(normalizeSearchTerm(null)).toBeUndefined();
    expect(normalizeSearchTerm(42)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(normalizeSearchTerm('')).toBeUndefined();
    expect(normalizeSearchTerm('   ')).toBeUndefined();
  });

  it('removes SQL wildcard characters', () => {
    expect(normalizeSearchTerm('test%drop')).toBe('testdrop');
    expect(normalizeSearchTerm('test_drop')).toBe('testdrop');
  });

  it('removes control characters', () => {
    expect(normalizeSearchTerm('test\x00evil')).toBe('testevil');
  });

  it('trims whitespace', () => {
    expect(normalizeSearchTerm('  hello  ')).toBe('hello');
  });

  it('truncates to maxLength', () => {
    const result = normalizeSearchTerm('a'.repeat(200), 100);
    expect(result?.length).toBe(100);
  });
});
