import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  suggestMapping: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(),
  parseExcelBuffer: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../services/column-mapper', () => ({
  suggestMapping: mocks.suggestMapping,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: mocks.parseExcelBuffer,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: vi.fn(),
  },
}));

import {
  getBaseContext,
  sanitizeLogValue,
  logUploadFailure,
  parseMapping,
  parseUploadType,
  getUploadFileOrReject,
  getUploadTypeOrReject,
  parseExcelRowsOrReject,
  parseHeaderRowIndexOrReject,
  validateMappingAgainstHeader,
  resolveMappingFromTemplateWithSource,
  resolveMappingFromTemplate,
} from '../routes/upload-validation';
import type { AuthRequest } from '../types';

function createRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('upload-validation-ultra', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.writeLog.mockResolvedValue(undefined);
    mocks.getClientIp.mockReturnValue('127.0.0.1');
    mocks.suggestMapping.mockReturnValue({ drug_name: '0' });
  });

  // ── getBaseContext ──
  describe('getBaseContext', () => {
    it('returns null pharmacyId when user is undefined', () => {
      const req = { path: '/test', body: {} } as unknown as AuthRequest;
      const ctx = getBaseContext(req);
      expect(ctx.pharmacyId).toBeNull();
      expect(ctx.uploadType).toBeNull();
      expect(ctx.fileName).toBeNull();
      expect(ctx.fileType).toBeNull();
      expect(ctx.fileSize).toBeNull();
    });

    it('returns null uploadType when body.uploadType is not a string', () => {
      const req = {
        path: '/test',
        body: { uploadType: 123 },
        user: { id: 1 },
      } as unknown as AuthRequest;
      const ctx = getBaseContext(req);
      expect(ctx.uploadType).toBeNull();
    });

    it('returns file metadata when file is present', () => {
      const req = {
        path: '/upload',
        body: { uploadType: 'dead_stock' },
        user: { id: 5 },
        file: { originalname: 'test.xlsx', mimetype: 'application/octet-stream', size: 1024 },
      } as unknown as AuthRequest;
      const ctx = getBaseContext(req);
      expect(ctx.pharmacyId).toBe(5);
      expect(ctx.uploadType).toBe('dead_stock');
      expect(ctx.fileName).toBe('test.xlsx');
      expect(ctx.fileType).toBe('application/octet-stream');
      expect(ctx.fileSize).toBe(1024);
    });
  });

  // ── sanitizeLogValue ──
  describe('sanitizeLogValue', () => {
    it('returns null for null/undefined', () => {
      expect(sanitizeLogValue(null)).toBeNull();
      expect(sanitizeLogValue(undefined)).toBeNull();
    });

    it('replaces pipe characters and collapses whitespace', () => {
      expect(sanitizeLogValue('a|b  c')).toBe('a/b c');
    });

    it('returns null for empty string after trim', () => {
      expect(sanitizeLogValue('   ')).toBeNull();
    });

    it('truncates to maxLength', () => {
      const long = 'a'.repeat(200);
      const result = sanitizeLogValue(long, 10);
      expect(result).toBe('aaaaaaaaaa');
      expect(result!.length).toBe(10);
    });

    it('converts non-string values to string', () => {
      expect(sanitizeLogValue(12345)).toBe('12345');
    });
  });

  // ── logUploadFailure ──
  describe('logUploadFailure', () => {
    it('includes uploadType and fileName in log detail when present', () => {
      const req = {
        body: { uploadType: 'dead_stock' },
        file: { originalname: 'inventory.xlsx' },
        user: { id: 10 },
      } as unknown as AuthRequest;

      logUploadFailure(req as never, 'file_upload', 'test_reason', { count: 3 });

      expect(mocks.writeLog).toHaveBeenCalledWith('upload', expect.objectContaining({
        pharmacyId: 10,
      }));
      const detail = mocks.writeLog.mock.calls[0][1].detail as string;
      expect(detail).toContain('uploadType=dead_stock');
      expect(detail).toContain('file=inventory.xlsx');
      expect(detail).toContain('count=3');
    });

    it('skips extra entries with null sanitized value', () => {
      const req = {
        body: {},
        user: { id: 1 },
      } as unknown as AuthRequest;

      logUploadFailure(req as never, 'preview', 'some_error', { empty: '   ' });

      const detail = mocks.writeLog.mock.calls[0][1].detail as string;
      expect(detail).not.toContain('empty=');
    });

    it('handles missing user gracefully', () => {
      const req = { body: {} } as unknown as AuthRequest;
      logUploadFailure(req as never, 'preview', 'error');

      expect(mocks.writeLog).toHaveBeenCalledWith('upload', expect.objectContaining({
        pharmacyId: null,
      }));
    });
  });

  // ── parseMapping ──
  describe('parseMapping', () => {
    it('throws when raw is not a string', () => {
      expect(() => parseMapping(123, 'dead_stock')).toThrow('mapping形式が不正です');
    });

    it('throws when parsed value is an array', () => {
      expect(() => parseMapping('[]', 'dead_stock')).toThrow('mapping形式が不正です');
    });

    it('throws when parsed value is null', () => {
      expect(() => parseMapping('null', 'dead_stock')).toThrow('mapping形式が不正です');
    });

    it('throws when too many mapping keys', () => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < 31; i++) {
        obj[`key_${i}`] = '0';
      }
      expect(() => parseMapping(JSON.stringify(obj), 'dead_stock')).toThrow('mappingの項目数が多すぎます');
    });

    it('skips prototype pollution keys', () => {
      const mapping = JSON.stringify({
        __proto__: '0',
        constructor: '1',
        prototype: '2',
        drug_name: '3',
        quantity: '4',
      });
      const result = parseMapping(mapping, 'dead_stock');
      expect(result.drug_name).toBe('3');
      expect(result.quantity).toBe('4');
    });

    it('skips keys longer than 50 characters', () => {
      const longKey = 'a'.repeat(51);
      const mapping = JSON.stringify({
        [longKey]: '0',
        drug_name: '1',
        quantity: '2',
      });
      const result = parseMapping(mapping, 'dead_stock');
      expect(result.drug_name).toBe('1');
    });

    it('skips keys not in allowed fields', () => {
      const mapping = JSON.stringify({
        invalid_field: '0',
        drug_name: '1',
        quantity: '2',
      });
      const result = parseMapping(mapping, 'dead_stock');
      expect((result as Record<string, unknown>)['invalid_field']).toBeUndefined();
    });

    it('sets null for null values', () => {
      const mapping = JSON.stringify({
        drug_name: '1',
        quantity: '2',
        lot_number: null,
      });
      const result = parseMapping(mapping, 'dead_stock');
      expect(result.lot_number).toBeNull();
    });

    it('rejects non-numeric string values', () => {
      const mapping = JSON.stringify({
        drug_name: '1',
        quantity: 'abc',
      });
      expect(() => parseMapping(mapping, 'dead_stock')).toThrow('数量カラムの割り当てが必要です');
    });

    it('rejects column index exceeding MAX_MAPPING_COLUMN_INDEX', () => {
      const mapping = JSON.stringify({
        drug_name: '1',
        quantity: '200', // exceeds 199
      });
      expect(() => parseMapping(mapping, 'dead_stock')).toThrow('数量カラムの割り当てが必要です');
    });

    it('rejects non-integer values in string form', () => {
      const mapping = JSON.stringify({
        drug_name: '1',
        quantity: '1.5',
      });
      expect(() => parseMapping(mapping, 'dead_stock')).toThrow('数量カラムの割り当てが必要です');
    });

    it('throws when drug_name mapping is missing', () => {
      const mapping = JSON.stringify({
        quantity: '0',
      });
      expect(() => parseMapping(mapping, 'dead_stock')).toThrow('薬剤名カラムの割り当てが必要です');
    });

    it('throws for dead_stock when quantity mapping is missing', () => {
      const mapping = JSON.stringify({
        drug_name: '0',
      });
      expect(() => parseMapping(mapping, 'dead_stock')).toThrow('数量カラムの割り当てが必要です');
    });

    it('does not require quantity for used_medication', () => {
      const mapping = JSON.stringify({
        drug_name: '0',
      });
      const result = parseMapping(mapping, 'used_medication');
      expect(result.drug_name).toBe('0');
    });

    it('ignores non-string, non-null values', () => {
      const mapping = JSON.stringify({
        drug_name: '0',
        quantity: '1',
        unit: 42, // number, not string
      });
      const result = parseMapping(mapping, 'dead_stock');
      expect(result.unit).toBeNull();
    });

    it('trims whitespace from string values', () => {
      const mapping = JSON.stringify({
        drug_name: ' 0 ',
        quantity: ' 1 ',
      });
      const result = parseMapping(mapping, 'dead_stock');
      expect(result.drug_name).toBe('0');
      expect(result.quantity).toBe('1');
    });
  });

  // ── parseUploadType ──
  describe('parseUploadType', () => {
    it('returns null for non-string', () => {
      expect(parseUploadType(123)).toBeNull();
      expect(parseUploadType(undefined)).toBeNull();
    });

    it('returns null for invalid upload type', () => {
      expect(parseUploadType('invalid')).toBeNull();
    });

    it('returns the valid type', () => {
      expect(parseUploadType('dead_stock')).toBe('dead_stock');
      expect(parseUploadType('used_medication')).toBe('used_medication');
    });
  });

  // ── getUploadFileOrReject ──
  describe('getUploadFileOrReject', () => {
    it('returns null and sends 400 when no file', () => {
      const req = {} as AuthRequest;
      const res = createRes();
      const result = getUploadFileOrReject(req, res as never);
      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns the file when present', () => {
      const file = { originalname: 'test.xlsx' } as Express.Multer.File;
      const req = { file } as unknown as AuthRequest;
      const res = createRes();
      const result = getUploadFileOrReject(req, res as never);
      expect(result).toBe(file);
    });
  });

  // ── getUploadTypeOrReject ──
  describe('getUploadTypeOrReject', () => {
    it('returns null and sends 400 when uploadType is invalid', () => {
      const req = { body: { uploadType: 'invalid' } } as unknown as AuthRequest;
      const res = createRes();
      const result = getUploadTypeOrReject(req, res as never);
      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns valid type', () => {
      const req = { body: { uploadType: 'dead_stock' } } as unknown as AuthRequest;
      const res = createRes();
      const result = getUploadTypeOrReject(req, res as never);
      expect(result).toBe('dead_stock');
    });
  });

  // ── parseExcelRowsOrReject ──
  describe('parseExcelRowsOrReject', () => {
    it('returns rows on success', async () => {
      mocks.parseExcelBuffer.mockResolvedValue([['a', 'b']]);
      const req = { body: {}, user: { id: 1 } } as unknown as AuthRequest;
      const res = createRes();
      const result = await parseExcelRowsOrReject(req, res as never, 'preview', Buffer.from(''));
      expect(result).toEqual([['a', 'b']]);
    });

    it('returns null and sends error with 上限 message when error contains 上限', async () => {
      mocks.parseExcelBuffer.mockRejectedValue(new Error('行数が上限を超えています'));
      const req = { body: {}, user: { id: 1 } } as unknown as AuthRequest;
      const res = createRes();
      const result = await parseExcelRowsOrReject(req, res as never, 'preview', Buffer.from(''));
      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: '行数が上限を超えています' });
    });

    it('returns null with generic message on other parse errors', async () => {
      mocks.parseExcelBuffer.mockRejectedValue(new Error('corrupted file'));
      const req = { body: {}, user: { id: 1 } } as unknown as AuthRequest;
      const res = createRes();
      const result = await parseExcelRowsOrReject(req, res as never, 'confirm', Buffer.from(''));
      expect(result).toBeNull();
      expect(res.json).toHaveBeenCalledWith({ error: 'ファイルの解析に失敗しました。xlsx形式を確認してください' });
    });
  });

  // ── parseHeaderRowIndexOrReject ──
  describe('parseHeaderRowIndexOrReject', () => {
    it('returns null for non-numeric headerRowIndex', () => {
      const req = { body: { headerRowIndex: 'abc' }, user: { id: 1 } } as unknown as AuthRequest;
      const res = createRes();
      const result = parseHeaderRowIndexOrReject(req, res as never);
      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns null for empty headerRowIndex', () => {
      const req = { body: {}, user: { id: 1 } } as unknown as AuthRequest;
      const res = createRes();
      const result = parseHeaderRowIndexOrReject(req, res as never);
      expect(result).toBeNull();
    });

    it('returns the parsed number', () => {
      const req = { body: { headerRowIndex: '5' }, user: { id: 1 } } as unknown as AuthRequest;
      const res = createRes();
      const result = parseHeaderRowIndexOrReject(req, res as never);
      expect(result).toBe(5);
    });

    it('returns 0 for headerRowIndex "0"', () => {
      const req = { body: { headerRowIndex: '0' }, user: { id: 1 } } as unknown as AuthRequest;
      const res = createRes();
      const result = parseHeaderRowIndexOrReject(req, res as never);
      expect(result).toBe(0);
    });

    it('returns null for non-safe integer', () => {
      const req = { body: { headerRowIndex: '99999999999999999999' }, user: { id: 1 } } as unknown as AuthRequest;
      const res = createRes();
      const result = parseHeaderRowIndexOrReject(req, res as never);
      // Number('99999999999999999999') is not safe integer
      expect(result).toBeNull();
    });
  });

  // ── validateMappingAgainstHeader ──
  describe('validateMappingAgainstHeader', () => {
    it('throws when headerRow is empty', () => {
      expect(() => validateMappingAgainstHeader({ drug_name: '0' }, []))
        .toThrow('ヘッダー行が不正です');
    });

    it('throws when column index exceeds header length', () => {
      expect(() => validateMappingAgainstHeader({ drug_name: '5' }, ['a', 'b', 'c']))
        .toThrow('薬剤名カラムの割り当てが見出し範囲外です');
    });

    it('throws when column index is negative', () => {
      expect(() => validateMappingAgainstHeader({ drug_name: '-1' }, ['a', 'b']))
        .toThrow('薬剤名カラムの割り当てが見出し範囲外です');
    });

    it('skips null mapping entries', () => {
      expect(() => validateMappingAgainstHeader({ drug_name: '0', quantity: null }, ['a', 'b']))
        .not.toThrow();
    });

    it('passes when all indices are within range', () => {
      expect(() => validateMappingAgainstHeader({ drug_name: '0', quantity: '1' }, ['a', 'b', 'c']))
        .not.toThrow();
    });

    it('handles non-numeric mapping value gracefully', () => {
      expect(() => validateMappingAgainstHeader({ drug_name: 'abc' }, ['a', 'b']))
        .toThrow('薬剤名カラムの割り当てが見出し範囲外です');
    });

    it('resolves label for known fields', () => {
      try {
        validateMappingAgainstHeader({ yakka_unit_price: '99' }, ['a']);
      } catch (e) {
        expect((e as Error).message).toContain('薬価');
      }
    });
  });

  // ── resolveMappingFromTemplateWithSource ──
  describe('resolveMappingFromTemplateWithSource', () => {
    it('uses saved mapping when valid', () => {
      const saved = JSON.stringify({ drug_name: '0', quantity: '1' });
      const result = resolveMappingFromTemplateWithSource(saved, ['a', 'b'], 'dead_stock');
      expect(result.fromSavedTemplate).toBe(true);
      expect(result.mapping.drug_name).toBe('0');
    });

    it('falls back to suggestMapping when saved mapping is invalid', () => {
      mocks.suggestMapping.mockReturnValue({ drug_name: '0' });
      const result = resolveMappingFromTemplateWithSource('invalid json', ['a', 'b'], 'used_medication');
      expect(result.fromSavedTemplate).toBe(false);
      expect(mocks.suggestMapping).toHaveBeenCalled();
    });

    it('falls back when savedMappingRaw is null', () => {
      mocks.suggestMapping.mockReturnValue({ drug_name: '0' });
      const result = resolveMappingFromTemplateWithSource(null, ['a', 'b'], 'used_medication');
      expect(result.fromSavedTemplate).toBe(false);
    });

    it('falls back when savedMappingRaw is undefined', () => {
      mocks.suggestMapping.mockReturnValue({ drug_name: '0' });
      const result = resolveMappingFromTemplateWithSource(undefined, ['a', 'b'], 'used_medication');
      expect(result.fromSavedTemplate).toBe(false);
    });
  });

  // ── resolveMappingFromTemplate ──
  describe('resolveMappingFromTemplate', () => {
    it('returns just the mapping (without source flag)', () => {
      const saved = JSON.stringify({ drug_name: '0', quantity: '1' });
      const result = resolveMappingFromTemplate(saved, ['a', 'b'], 'dead_stock');
      expect(result.drug_name).toBe('0');
    });
  });
});
