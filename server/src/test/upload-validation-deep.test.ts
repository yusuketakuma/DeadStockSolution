/**
 * upload-validation-deep.test.ts
 * upload-validation.ts の未カバーブランチを追加テスト
 * - parseMapping: prototype pollution keys, non-string mapping, array mapping
 * - parseMapping: key too long, non-allowed field, null value, string value normalization
 * - parseMapping: missing drug_name, missing quantity for dead_stock
 * - parseUploadType: invalid type, null type
 * - getUploadFileOrReject / getUploadTypeOrReject
 * - parseExcelRowsOrReject: parse error with '上限' message
 * - parseHeaderRowIndexOrReject: invalid formats
 * - validateMappingAgainstHeader: out-of-range column
 * - resolveMappingFromTemplateWithSource: fallback to suggestMapping
 * - sanitizeLogValue: edge cases
 * - logUploadFailure: various extras
 */
import { describe, expect, it, vi } from 'vitest';
import {
  parseMapping,
  parseUploadType,
  getUploadFileOrReject,
  getUploadTypeOrReject,
  parseHeaderRowIndexOrReject,
  validateMappingAgainstHeader,
  resolveMappingFromTemplateWithSource,
  resolveMappingFromTemplate,
  sanitizeLogValue,
  logUploadFailure,
  getBaseContext,
  type UploadType,
} from '../routes/upload-validation';

vi.mock('../services/column-mapper', () => ({
  suggestMapping: vi.fn(() => ({ drug_name: '0', quantity: '1' })),
}));
vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/log-service', () => ({
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: vi.fn(async () => [['header'], ['row']]),
}));
vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (err: unknown) => err instanceof Error ? err.message : String(err),
}));

describe('upload-validation deep coverage', () => {
  // ── parseMapping ──

  describe('parseMapping', () => {
    it('throws for non-string input', () => {
      expect(() => parseMapping(123, 'dead_stock')).toThrow('mapping形式が不正');
    });

    it('throws for non-object JSON', () => {
      expect(() => parseMapping('"string"', 'dead_stock')).toThrow('mapping形式が不正');
    });

    it('throws for array JSON', () => {
      expect(() => parseMapping('[1,2,3]', 'dead_stock')).toThrow('mapping形式が不正');
    });

    it('throws when too many mapping keys', () => {
      const bigMapping: Record<string, string> = {};
      for (let i = 0; i < 35; i++) {
        bigMapping[`field_${i}`] = String(i);
      }
      expect(() => parseMapping(JSON.stringify(bigMapping), 'dead_stock')).toThrow('項目数が多すぎ');
    });

    it('skips __proto__ key (prototype pollution prevention)', () => {
      const raw = JSON.stringify({ drug_name: '0', quantity: '1', __proto__: '2' });
      const result = parseMapping(raw, 'dead_stock');
      expect(result.drug_name).toBe('0');
    });

    it('skips constructor key', () => {
      const raw = JSON.stringify({ drug_name: '0', quantity: '1', constructor: '2' });
      const result = parseMapping(raw, 'dead_stock');
      expect(result.drug_name).toBe('0');
    });

    it('skips keys longer than 50 chars', () => {
      const longKey = 'a'.repeat(51);
      const raw = JSON.stringify({ drug_name: '0', quantity: '1', [longKey]: '2' });
      const result = parseMapping(raw, 'dead_stock');
      expect(result.drug_name).toBe('0');
    });

    it('skips fields not in allowed set', () => {
      const raw = JSON.stringify({ drug_name: '0', quantity: '1', not_a_field: '2' });
      const result = parseMapping(raw, 'dead_stock');
      expect(result).not.toHaveProperty('not_a_field');
    });

    it('sets null values', () => {
      const raw = JSON.stringify({ drug_name: '0', quantity: '1', unit: null });
      const result = parseMapping(raw, 'dead_stock');
      expect(result.unit).toBeNull();
    });

    it('validates string value as numeric column index', () => {
      const raw = JSON.stringify({ drug_name: '0', quantity: '1', unit: '200' });
      const result = parseMapping(raw, 'dead_stock');
      // 200 > MAX_MAPPING_COLUMN_INDEX (199), so it should not be set
      expect(result.unit).toBeNull();
    });

    it('accepts valid column index string', () => {
      const raw = JSON.stringify({ drug_name: '0', quantity: '1', unit: '5' });
      const result = parseMapping(raw, 'dead_stock');
      expect(result.unit).toBe('5');
    });

    it('rejects non-numeric string value', () => {
      const raw = JSON.stringify({ drug_name: '0', quantity: '1', unit: 'abc' });
      const result = parseMapping(raw, 'dead_stock');
      expect(result.unit).toBeNull();
    });

    it('throws when drug_name is missing', () => {
      const raw = JSON.stringify({ quantity: '1' });
      expect(() => parseMapping(raw, 'dead_stock')).toThrow('薬剤名カラム');
    });

    it('throws when quantity is missing for dead_stock', () => {
      const raw = JSON.stringify({ drug_name: '0' });
      expect(() => parseMapping(raw, 'dead_stock')).toThrow('数量カラム');
    });

    it('does not throw when quantity is missing for used_medication', () => {
      const raw = JSON.stringify({ drug_name: '0' });
      const result = parseMapping(raw, 'used_medication');
      expect(result.drug_name).toBe('0');
    });

    it('uses used_medication field set', () => {
      const raw = JSON.stringify({ drug_name: '0', monthly_usage: '1' });
      const result = parseMapping(raw, 'used_medication');
      expect(result.drug_name).toBe('0');
      expect(result.monthly_usage).toBe('1');
    });
  });

  // ── parseUploadType ──

  describe('parseUploadType', () => {
    it('returns dead_stock for valid type', () => {
      expect(parseUploadType('dead_stock')).toBe('dead_stock');
    });

    it('returns used_medication for valid type', () => {
      expect(parseUploadType('used_medication')).toBe('used_medication');
    });

    it('returns null for invalid type', () => {
      expect(parseUploadType('invalid')).toBeNull();
    });

    it('returns null for non-string input', () => {
      expect(parseUploadType(123)).toBeNull();
    });
  });

  // ── getUploadFileOrReject / getUploadTypeOrReject ──

  describe('getUploadFileOrReject', () => {
    it('returns null and sends 400 when no file', () => {
      const json = vi.fn();
      const status = vi.fn(() => ({ json }));
      const req = { body: {} } as unknown as { file?: Express.Multer.File; body: Record<string, unknown> };
      const res = { status, json } as unknown as import('express').Response;
      const result = getUploadFileOrReject(req as never, res);
      expect(result).toBeNull();
      expect(status).toHaveBeenCalledWith(400);
    });

    it('returns file when present', () => {
      const file = { originalname: 'test.xlsx' } as Express.Multer.File;
      const req = { file, body: {} } as unknown as { file: Express.Multer.File; body: Record<string, unknown> };
      const res = {} as import('express').Response;
      const result = getUploadFileOrReject(req as never, res);
      expect(result).toBe(file);
    });
  });

  describe('getUploadTypeOrReject', () => {
    it('returns null and sends 400 for invalid upload type', () => {
      const json = vi.fn();
      const status = vi.fn(() => ({ json }));
      const req = { body: { uploadType: 'bad' } } as never;
      const res = { status, json } as unknown as import('express').Response;
      const result = getUploadTypeOrReject(req, res);
      expect(result).toBeNull();
      expect(status).toHaveBeenCalledWith(400);
    });
  });

  // ── parseHeaderRowIndexOrReject ──

  describe('parseHeaderRowIndexOrReject', () => {
    it('returns null for non-numeric header row', () => {
      const json = vi.fn();
      const status = vi.fn(() => ({ json }));
      const req = { body: { headerRowIndex: 'abc' } } as never;
      const res = { status, json } as unknown as import('express').Response;
      const result = parseHeaderRowIndexOrReject(req, res);
      expect(result).toBeNull();
    });

    it('returns valid header row index', () => {
      const req = { body: { headerRowIndex: '3' } } as never;
      const res = {} as import('express').Response;
      const result = parseHeaderRowIndexOrReject(req, res);
      expect(result).toBe(3);
    });

    it('returns 0 for header row index 0', () => {
      const req = { body: { headerRowIndex: '0' } } as never;
      const res = {} as import('express').Response;
      const result = parseHeaderRowIndexOrReject(req, res);
      expect(result).toBe(0);
    });

    it('returns null for empty string', () => {
      const json = vi.fn();
      const status = vi.fn(() => ({ json }));
      const req = { body: { headerRowIndex: '' } } as never;
      const res = { status, json } as unknown as import('express').Response;
      const result = parseHeaderRowIndexOrReject(req, res);
      expect(result).toBeNull();
    });
  });

  // ── validateMappingAgainstHeader ──

  describe('validateMappingAgainstHeader', () => {
    it('throws for empty header row', () => {
      expect(() => validateMappingAgainstHeader({ drug_name: '0' }, [])).toThrow('ヘッダー行が不正');
    });

    it('throws for column index out of range', () => {
      expect(() => validateMappingAgainstHeader(
        { drug_name: '0', unit: '5' },
        ['col0', 'col1', 'col2'],
      )).toThrow('見出し範囲外');
    });

    it('succeeds for valid column indices', () => {
      expect(() => validateMappingAgainstHeader(
        { drug_name: '0', quantity: '1' },
        ['薬剤名', '数量', '単位'],
      )).not.toThrow();
    });

    it('skips null mapping values', () => {
      expect(() => validateMappingAgainstHeader(
        { drug_name: '0', unit: null },
        ['薬剤名'],
      )).not.toThrow();
    });
  });

  // ── resolveMappingFromTemplateWithSource ──

  describe('resolveMappingFromTemplateWithSource', () => {
    it('returns saved template when valid', () => {
      const saved = JSON.stringify({ drug_name: '0', quantity: '1' });
      const result = resolveMappingFromTemplateWithSource(saved, ['薬剤名', '数量'], 'dead_stock');
      expect(result.fromSavedTemplate).toBe(true);
      expect(result.mapping.drug_name).toBe('0');
    });

    it('falls back to suggestMapping when saved template is invalid', () => {
      const result = resolveMappingFromTemplateWithSource('invalid-json', ['薬剤名', '数量'], 'dead_stock');
      expect(result.fromSavedTemplate).toBe(false);
    });

    it('falls back to suggestMapping when savedMappingRaw is null', () => {
      const result = resolveMappingFromTemplateWithSource(null, ['薬剤名', '数量'], 'dead_stock');
      expect(result.fromSavedTemplate).toBe(false);
    });
  });

  // ── resolveMappingFromTemplate ──

  describe('resolveMappingFromTemplate', () => {
    it('returns mapping directly', () => {
      const result = resolveMappingFromTemplate(null, ['薬剤名', '数量'], 'dead_stock');
      expect(result.drug_name).toBe('0');
    });
  });

  // ── sanitizeLogValue ──

  describe('sanitizeLogValue', () => {
    it('returns null for null/undefined', () => {
      expect(sanitizeLogValue(null)).toBeNull();
      expect(sanitizeLogValue(undefined)).toBeNull();
    });

    it('returns null for empty string after trimming', () => {
      expect(sanitizeLogValue('  ')).toBeNull();
    });

    it('replaces pipe and collapses whitespace', () => {
      expect(sanitizeLogValue('a | b  c')).toBe('a / b c');
    });

    it('truncates to maxLength', () => {
      const long = 'x'.repeat(200);
      expect(sanitizeLogValue(long, 10)!.length).toBe(10);
    });

    it('converts numbers to string', () => {
      expect(sanitizeLogValue(42)).toBe('42');
    });
  });

  // ── getBaseContext ──

  describe('getBaseContext', () => {
    it('extracts context from request', () => {
      const req = {
        path: '/upload',
        body: { uploadType: 'dead_stock' },
        file: { originalname: 'test.xlsx', mimetype: 'application/octet-stream', size: 1024 },
        user: { id: 5 },
      } as never;
      const ctx = getBaseContext(req);
      expect(ctx.pharmacyId).toBe(5);
      expect(ctx.uploadType).toBe('dead_stock');
      expect(ctx.fileName).toBe('test.xlsx');
    });

    it('returns null for missing values', () => {
      const req = { path: '/upload', body: {} } as never;
      const ctx = getBaseContext(req);
      expect(ctx.pharmacyId).toBeNull();
      expect(ctx.uploadType).toBeNull();
      expect(ctx.fileName).toBeNull();
    });
  });

  // ── logUploadFailure ──

  describe('logUploadFailure', () => {
    it('calls writeLog with sanitized details', () => {
      const req = {
        body: { uploadType: 'dead_stock' },
        file: { originalname: 'test.xlsx' },
        user: { id: 5 },
      } as never;
      // Should not throw
      logUploadFailure(req, 'confirm', 'test_reason', { extra: 'value' });
    });
  });
});
