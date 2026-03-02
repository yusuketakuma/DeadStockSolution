import { describe, expect, it } from 'vitest';
import {
  INITIAL_ERROR_CODES,
} from '../services/error-code-service';
import { errorCodeCategoryValues, errorCodeSeverityValues } from '../db/schema';

describe('INITIAL_ERROR_CODES', () => {
  it('should contain exactly 14 entries', () => {
    expect(INITIAL_ERROR_CODES).toHaveLength(14);
  });

  it('should have unique code values', () => {
    const codes = INITIAL_ERROR_CODES.map((e) => e.code);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });

  it('should only use valid categories', () => {
    const validCategories = new Set(errorCodeCategoryValues);
    for (const entry of INITIAL_ERROR_CODES) {
      expect(validCategories.has(entry.category)).toBe(true);
    }
  });

  it('should only use valid severities', () => {
    const validSeverities = new Set(errorCodeSeverityValues);
    for (const entry of INITIAL_ERROR_CODES) {
      expect(validSeverities.has(entry.severity)).toBe(true);
    }
  });

  it('should have non-empty code, titleJa, and descriptionJa for every entry', () => {
    for (const entry of INITIAL_ERROR_CODES) {
      expect(entry.code.length).toBeGreaterThan(0);
      expect(entry.titleJa.length).toBeGreaterThan(0);
      expect(entry.descriptionJa.length).toBeGreaterThan(0);
    }
  });

  it('should have codes that follow UPPER_SNAKE_CASE format', () => {
    const upperSnakeCase = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;
    for (const entry of INITIAL_ERROR_CODES) {
      expect(entry.code).toMatch(upperSnakeCase);
    }
  });

  it('should cover all expected categories', () => {
    const categories = new Set(INITIAL_ERROR_CODES.map((e) => e.category));
    expect(categories.has('upload')).toBe(true);
    expect(categories.has('auth')).toBe(true);
    expect(categories.has('sync')).toBe(true);
    expect(categories.has('system')).toBe(true);
    expect(categories.has('openclaw')).toBe(true);
  });

  it('should include all four severity levels across entries', () => {
    const severities = new Set(INITIAL_ERROR_CODES.map((e) => e.severity));
    expect(severities.has('critical')).toBe(true);
    expect(severities.has('error')).toBe(true);
    expect(severities.has('warning')).toBe(true);
    expect(severities.has('info')).toBe(true);
  });
});
