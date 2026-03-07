import { describe, it, expect } from 'vitest';
import {
  sanitizeRawCode,
  normalizeExpirationDateIso,
  normalizeOptionalText,
  normalizeOptionalNumber,
  toNumericText,
  buildCameraUploadFilename,
  resolveDisplayCode,
} from '../services/camera-dead-stock-service';
import type { ParsedCameraCode } from '../services/gs1-parser';

describe('camera-dead-stock-service', () => {
  describe('sanitizeRawCode', () => {
    it('returns null for non-string input', () => {
      expect(sanitizeRawCode(null)).toBeNull();
      expect(sanitizeRawCode(undefined)).toBeNull();
      expect(sanitizeRawCode(123)).toBeNull();
      expect(sanitizeRawCode({})).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(sanitizeRawCode('')).toBeNull();
      expect(sanitizeRawCode('   ')).toBeNull();
    });

    it('removes control characters', () => {
      expect(sanitizeRawCode('test\x00code')).toBe('testcode');
      expect(sanitizeRawCode('test\x1Fcode')).toBe('testcode');
      expect(sanitizeRawCode('test\x7Fcode')).toBe('testcode');
    });

    it('trims whitespace', () => {
      expect(sanitizeRawCode('  test  ')).toBe('test');
    });

    it('truncates to 500 characters', () => {
      const longCode = 'a'.repeat(600);
      const result = sanitizeRawCode(longCode);
      expect(result?.length).toBe(500);
    });

    it('preserves valid codes', () => {
      expect(sanitizeRawCode('1234567890123')).toBe('1234567890123');
      expect(sanitizeRawCode('YJ-CODE-123')).toBe('YJ-CODE-123');
    });
  });

  describe('normalizeExpirationDateIso', () => {
    it('returns null for non-string input', () => {
      expect(normalizeExpirationDateIso(null)).toBeNull();
      expect(normalizeExpirationDateIso(undefined)).toBeNull();
      expect(normalizeExpirationDateIso(123)).toBeNull();
    });

    it('returns null for invalid formats', () => {
      expect(normalizeExpirationDateIso('2026/01/01')).toBe('2026-01-01'); // slash is converted
      expect(normalizeExpirationDateIso('01-01-2026')).toBeNull();
      expect(normalizeExpirationDateIso('2026-1-1')).toBeNull();
      expect(normalizeExpirationDateIso('2026-13-01')).toBeNull();
      expect(normalizeExpirationDateIso('2026-01-32')).toBeNull();
      expect(normalizeExpirationDateIso('not-a-date')).toBeNull();
    });

    it('normalizes valid ISO dates', () => {
      expect(normalizeExpirationDateIso('2026-01-15')).toBe('2026-01-15');
      expect(normalizeExpirationDateIso('2026-12-31')).toBe('2026-12-31');
    });

    it('converts slash format to hyphen', () => {
      expect(normalizeExpirationDateIso('2026/01/15')).toBe('2026-01-15');
      expect(normalizeExpirationDateIso('2026/12/31')).toBe('2026-12-31');
    });

    it('rejects invalid dates', () => {
      expect(normalizeExpirationDateIso('2026-02-30')).toBeNull(); // Feb 30 doesn't exist
      expect(normalizeExpirationDateIso('2026-04-31')).toBeNull(); // Apr 31 doesn't exist
    });
  });

  describe('normalizeOptionalText', () => {
    it('returns null for non-string input', () => {
      expect(normalizeOptionalText(null, 100)).toBeNull();
      expect(normalizeOptionalText(undefined, 100)).toBeNull();
      expect(normalizeOptionalText(123, 100)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(normalizeOptionalText('', 100)).toBeNull();
      expect(normalizeOptionalText('   ', 100)).toBeNull();
    });

    it('trims whitespace', () => {
      expect(normalizeOptionalText('  test  ', 100)).toBe('test');
    });

    it('truncates to maxLength', () => {
      expect(normalizeOptionalText('abcdefghij', 5)).toBe('abcde');
    });

    it('preserves valid text', () => {
      expect(normalizeOptionalText('テスト包装', 100)).toBe('テスト包装');
    });
  });

  describe('normalizeOptionalNumber', () => {
    it('returns number for number input', () => {
      expect(normalizeOptionalNumber(123)).toBe(123);
      expect(normalizeOptionalNumber(0)).toBe(0);
      expect(normalizeOptionalNumber(-5)).toBe(-5);
      expect(normalizeOptionalNumber(1.5)).toBe(1.5);
    });

    it('parses string to number', () => {
      expect(normalizeOptionalNumber('123')).toBe(123);
      expect(normalizeOptionalNumber('1.5')).toBe(1.5);
    });

    it('returns null for non-numeric input', () => {
      expect(normalizeOptionalNumber('abc')).toBeNull();
      expect(normalizeOptionalNumber(null)).toBeNull();
      expect(normalizeOptionalNumber(undefined)).toBeNull();
      expect(normalizeOptionalNumber({})).toBeNull();
    });

    it('returns null for NaN', () => {
      expect(normalizeOptionalNumber(Number.NaN)).toBeNull();
      expect(normalizeOptionalNumber(Infinity)).toBeNull();
      expect(normalizeOptionalNumber(-Infinity)).toBeNull();
    });
  });

  describe('toNumericText', () => {
    it('converts number to string', () => {
      expect(toNumericText(123)).toBe('123');
      expect(toNumericText(0)).toBe('0');
      expect(toNumericText(1.5)).toBe('1.5');
    });

    it('returns null for null input', () => {
      expect(toNumericText(null)).toBeNull();
    });

    it('returns null for NaN', () => {
      expect(toNumericText(Number.NaN)).toBeNull();
    });
  });

  describe('buildCameraUploadFilename', () => {
    it('generates filename with ISO timestamp', () => {
      const date = new Date('2026-03-06T12:30:45.123Z');
      const result = buildCameraUploadFilename(date);
      expect(result).toMatch(/^camera-scan-/);
      expect(result).toContain('2026-03-06');
      expect(result).toMatch(/\.json$/);
    });

    it('replaces colons and dots in timestamp part', () => {
      const date = new Date('2026-03-06T12:30:45.123Z');
      const result = buildCameraUploadFilename(date);
      // Only .json extension should contain dot
      expect(result.endsWith('.json')).toBe(true);
      const withoutExtension = result.slice(0, -5);
      expect(withoutExtension).not.toMatch(/[:.]/);
    });
  });

  describe('resolveDisplayCode', () => {
    const createParsedCode = (
      overrides: Partial<ParsedCameraCode> = {},
    ): ParsedCameraCode => ({
      codeType: 'unknown',
      normalizedCode: '',
      yjCode: null,
      gtin: null,
      expirationDate: null,
      lotNumber: null,
      warnings: [],
      ...overrides,
    });

    it('returns yjCode when available', () => {
      const parsed = createParsedCode({ yjCode: 'YJ123' });
      expect(resolveDisplayCode(parsed, 'fallback')).toBe('YJ123');
    });

    it('returns gtin when yjCode is not available', () => {
      const parsed = createParsedCode({ gtin: '12345678901234' });
      expect(resolveDisplayCode(parsed, 'fallback')).toBe('12345678901234');
    });

    it('prefers yjCode over gtin', () => {
      const parsed = createParsedCode({
        yjCode: 'YJ123',
        gtin: '12345678901234',
      });
      expect(resolveDisplayCode(parsed, 'fallback')).toBe('YJ123');
    });

    it('returns fallback when neither yjCode nor gtin available', () => {
      const parsed = createParsedCode();
      expect(resolveDisplayCode(parsed, 'fallback-code')).toBe('fallback-code');
    });
  });
});
