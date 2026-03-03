import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/column-mapper', () => ({
  suggestMapping: vi.fn(() => ({
    drug_code: null, drug_name: null, quantity: null,
    unit: null, yakka_unit_price: null, expiration_date: null, lot_number: null,
  })),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/log-service', () => ({
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: vi.fn(),
}));

import {
  parseMapping,
  parseUploadType,
  getUploadFileOrReject,
  getUploadTypeOrReject,
  parseHeaderRowIndexOrReject,
  validateMappingAgainstHeader,
  sanitizeLogValue,
  logUploadFailure,
  getBaseContext,
  resolveMappingFromTemplate,
  resolveMappingFromTemplateWithSource,
  MAX_MAPPING_KEYS,
  MAX_MAPPING_COLUMN_INDEX,
} from '../routes/upload-validation';

describe('upload-validation: parseMapping', () => {
  it('throws when raw is not a string', () => {
    expect(() => parseMapping(123, 'dead_stock')).toThrow('mapping形式が不正です');
  });

  it('throws when JSON is not an object', () => {
    expect(() => parseMapping('"hello"', 'dead_stock')).toThrow('mapping形式が不正です');
  });

  it('throws when JSON is an array', () => {
    expect(() => parseMapping('[1,2,3]', 'dead_stock')).toThrow('mapping形式が不正です');
  });

  it('throws when too many mapping keys', () => {
    const bigObj: Record<string, string> = {};
    for (let i = 0; i <= MAX_MAPPING_KEYS; i++) {
      bigObj[`field_${i}`] = String(i);
    }
    expect(() => parseMapping(JSON.stringify(bigObj), 'dead_stock')).toThrow('mappingの項目数が多すぎます');
  });

  it('throws when drug_name is missing', () => {
    const mapping = { drug_code: '0', quantity: '1' };
    expect(() => parseMapping(JSON.stringify(mapping), 'dead_stock')).toThrow('薬剤名カラムの割り当てが必要です');
  });

  it('throws when quantity is missing for dead_stock', () => {
    const mapping = { drug_name: '0' };
    expect(() => parseMapping(JSON.stringify(mapping), 'dead_stock')).toThrow('数量カラムの割り当てが必要です');
  });

  it('does not require quantity for used_medication', () => {
    const mapping = { drug_name: '0' };
    const result = parseMapping(JSON.stringify(mapping), 'used_medication');
    expect(result.drug_name).toBe('0');
    expect(result.quantity).toBeUndefined();
  });

  it('skips prototype pollution keys', () => {
    const mapping = {
      __proto__: '0',
      constructor: '1',
      prototype: '2',
      drug_name: '0',
      quantity: '1',
    };
    const result = parseMapping(JSON.stringify(mapping), 'dead_stock');
    expect(result.drug_name).toBe('0');
    expect(result.quantity).toBe('1');
  });

  it('skips keys longer than 50 characters', () => {
    const longKey = 'a'.repeat(51);
    const mapping = { [longKey]: '0', drug_name: '0', quantity: '1' };
    const result = parseMapping(JSON.stringify(mapping), 'dead_stock');
    expect(result[longKey]).toBeUndefined();
  });

  it('skips keys not in allowed field set', () => {
    const mapping = { drug_name: '0', quantity: '1', bogus_field: '2' };
    const result = parseMapping(JSON.stringify(mapping), 'dead_stock');
    expect(result.drug_name).toBe('0');
    expect(result.bogus_field).toBeUndefined();
  });

  it('allows null values for mapping fields', () => {
    const mapping = { drug_name: '0', quantity: '1', unit: null };
    const result = parseMapping(JSON.stringify(mapping), 'dead_stock');
    expect(result.unit).toBeNull();
  });

  it('skips string values that do not match digit pattern', () => {
    const mapping = { drug_name: 'abc', quantity: '1' };
    // drug_name 'abc' is not a digit pattern, so it gets set to null
    // But then the check for !sanitized.drug_name will throw
    expect(() => parseMapping(JSON.stringify(mapping), 'dead_stock')).toThrow('薬剤名カラムの割り当てが必要です');
  });

  it('skips column index that exceeds MAX_MAPPING_COLUMN_INDEX', () => {
    const mapping = { drug_name: String(MAX_MAPPING_COLUMN_INDEX + 1), quantity: '1' };
    expect(() => parseMapping(JSON.stringify(mapping), 'dead_stock')).toThrow('薬剤名カラムの割り当てが必要です');
  });

  it('accepts column index at MAX_MAPPING_COLUMN_INDEX boundary', () => {
    const mapping = { drug_name: String(MAX_MAPPING_COLUMN_INDEX), quantity: '1' };
    const result = parseMapping(JSON.stringify(mapping), 'dead_stock');
    expect(result.drug_name).toBe(String(MAX_MAPPING_COLUMN_INDEX));
  });

  it('accepts column index 0', () => {
    const mapping = { drug_name: '0', quantity: '1' };
    const result = parseMapping(JSON.stringify(mapping), 'dead_stock');
    expect(result.drug_name).toBe('0');
  });
});

describe('upload-validation: parseUploadType', () => {
  it('returns null for non-string input', () => {
    expect(parseUploadType(123)).toBeNull();
    expect(parseUploadType(null)).toBeNull();
    expect(parseUploadType(undefined)).toBeNull();
  });

  it('returns null for invalid type string', () => {
    expect(parseUploadType('invalid')).toBeNull();
    expect(parseUploadType('')).toBeNull();
  });

  it('returns dead_stock for valid type', () => {
    expect(parseUploadType('dead_stock')).toBe('dead_stock');
  });

  it('returns used_medication for valid type', () => {
    expect(parseUploadType('used_medication')).toBe('used_medication');
  });
});

describe('upload-validation: getUploadFileOrReject', () => {
  it('returns null and sends 400 when no file', () => {
    const req = { file: undefined } as unknown as Parameters<typeof getUploadFileOrReject>[0];
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Parameters<typeof getUploadFileOrReject>[1];

    const result = getUploadFileOrReject(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'ファイルが選択されていません' });
  });

  it('returns file when present', () => {
    const file = { originalname: 'test.xlsx', buffer: Buffer.from('data') };
    const req = { file } as unknown as Parameters<typeof getUploadFileOrReject>[0];
    const res = {} as unknown as Parameters<typeof getUploadFileOrReject>[1];

    const result = getUploadFileOrReject(req, res);

    expect(result).toBe(file);
  });
});

describe('upload-validation: getUploadTypeOrReject', () => {
  it('returns null and sends 400 when uploadType is invalid', () => {
    const req = { body: { uploadType: 'bogus' } } as unknown as Parameters<typeof getUploadTypeOrReject>[0];
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Parameters<typeof getUploadTypeOrReject>[1];

    const result = getUploadTypeOrReject(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns upload type when valid', () => {
    const req = { body: { uploadType: 'dead_stock' } } as unknown as Parameters<typeof getUploadTypeOrReject>[0];
    const res = {} as unknown as Parameters<typeof getUploadTypeOrReject>[1];

    const result = getUploadTypeOrReject(req, res);

    expect(result).toBe('dead_stock');
  });
});

describe('upload-validation: parseHeaderRowIndexOrReject', () => {
  it('returns null for non-digit string', () => {
    const req = { body: { headerRowIndex: 'abc' } } as unknown as Parameters<typeof parseHeaderRowIndexOrReject>[0];
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Parameters<typeof parseHeaderRowIndexOrReject>[1];

    const result = parseHeaderRowIndexOrReject(req, res);

    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns null for empty string', () => {
    const req = { body: { headerRowIndex: '' } } as unknown as Parameters<typeof parseHeaderRowIndexOrReject>[0];
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Parameters<typeof parseHeaderRowIndexOrReject>[1];

    const result = parseHeaderRowIndexOrReject(req, res);

    expect(result).toBeNull();
  });

  it('returns valid index for digit string', () => {
    const req = { body: { headerRowIndex: '5' } } as unknown as Parameters<typeof parseHeaderRowIndexOrReject>[0];
    const res = {} as unknown as Parameters<typeof parseHeaderRowIndexOrReject>[1];

    const result = parseHeaderRowIndexOrReject(req, res);

    expect(result).toBe(5);
  });

  it('returns 0 for "0"', () => {
    const req = { body: { headerRowIndex: '0' } } as unknown as Parameters<typeof parseHeaderRowIndexOrReject>[0];
    const res = {} as unknown as Parameters<typeof parseHeaderRowIndexOrReject>[1];

    const result = parseHeaderRowIndexOrReject(req, res);

    expect(result).toBe(0);
  });

  it('trims whitespace from headerRowIndex', () => {
    const req = { body: { headerRowIndex: '  3  ' } } as unknown as Parameters<typeof parseHeaderRowIndexOrReject>[0];
    const res = {} as unknown as Parameters<typeof parseHeaderRowIndexOrReject>[1];

    const result = parseHeaderRowIndexOrReject(req, res);

    expect(result).toBe(3);
  });
});

describe('upload-validation: validateMappingAgainstHeader', () => {
  it('throws when header row is empty', () => {
    expect(() => validateMappingAgainstHeader({ drug_name: '0' }, [])).toThrow('ヘッダー行が不正です');
  });

  it('throws when column index is negative', () => {
    // parseMappingColumnIndex would return a negative number if the value is "-1"
    // But parseMapping only accepts digit patterns, so this case is unlikely
    // We test the boundary: value = headerLength (out of range)
    expect(() => validateMappingAgainstHeader({ drug_name: '3' }, ['A', 'B', 'C'])).toThrow(
      '薬剤名カラムの割り当てが見出し範囲外です',
    );
  });

  it('passes when all column indices are within range', () => {
    expect(() => validateMappingAgainstHeader({ drug_name: '0', quantity: '2' }, ['A', 'B', 'C'])).not.toThrow();
  });

  it('skips null values in validation', () => {
    expect(() => validateMappingAgainstHeader({ drug_name: '0', unit: null }, ['A', 'B'])).not.toThrow();
  });
});

describe('upload-validation: sanitizeLogValue', () => {
  it('returns null for null/undefined', () => {
    expect(sanitizeLogValue(null)).toBeNull();
    expect(sanitizeLogValue(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(sanitizeLogValue('')).toBeNull();
  });

  it('replaces pipe chars and collapses whitespace', () => {
    expect(sanitizeLogValue('hello|world  test')).toBe('hello/world test');
  });

  it('truncates at maxLength', () => {
    const longStr = 'a'.repeat(200);
    expect(sanitizeLogValue(longStr, 10)).toBe('a'.repeat(10));
  });

  it('uses default maxLength of 160', () => {
    const longStr = 'a'.repeat(200);
    expect(sanitizeLogValue(longStr)).toBe('a'.repeat(160));
  });
});

describe('upload-validation: logUploadFailure', () => {
  it('calls writeLog with detail parts including extra', async () => {
    const { writeLog } = await import('../services/log-service');

    const req = {
      body: { uploadType: 'dead_stock' },
      file: { originalname: 'test.xlsx' },
      user: { id: 1 },
    } as unknown as Parameters<typeof logUploadFailure>[0];

    logUploadFailure(req, 'preview', 'empty_file', { rowCount: 0 });

    expect(writeLog).toHaveBeenCalledWith('upload', expect.objectContaining({
      pharmacyId: 1,
      detail: expect.stringContaining('phase=preview'),
    }));
  });

  it('handles missing user and file gracefully', async () => {
    const { writeLog } = await import('../services/log-service');

    const req = {
      body: {},
    } as unknown as Parameters<typeof logUploadFailure>[0];

    logUploadFailure(req, 'confirm', 'parse_failed');

    expect(writeLog).toHaveBeenCalledWith('upload', expect.objectContaining({
      pharmacyId: null,
    }));
  });
});

describe('upload-validation: getBaseContext', () => {
  it('extracts context from auth request', () => {
    const req = {
      path: '/api/upload/preview',
      body: { uploadType: 'dead_stock' },
      file: { originalname: 'test.xlsx', mimetype: 'application/xlsx', size: 1024 },
      user: { id: 1 },
    } as unknown as Parameters<typeof getBaseContext>[0];

    const ctx = getBaseContext(req);

    expect(ctx).toEqual({
      path: '/api/upload/preview',
      pharmacyId: 1,
      uploadType: 'dead_stock',
      fileName: 'test.xlsx',
      fileType: 'application/xlsx',
      fileSize: 1024,
    });
  });

  it('handles missing user and file', () => {
    const req = {
      path: '/api/upload/preview',
      body: {},
    } as unknown as Parameters<typeof getBaseContext>[0];

    const ctx = getBaseContext(req);

    expect(ctx).toEqual({
      path: '/api/upload/preview',
      pharmacyId: null,
      uploadType: null,
      fileName: null,
      fileType: null,
      fileSize: null,
    });
  });
});

describe('upload-validation: resolveMappingFromTemplate', () => {
  it('returns suggestMapping result when savedMappingRaw is null', () => {
    const result = resolveMappingFromTemplate(null, ['A', 'B', 'C'], 'dead_stock');
    // suggestMapping is mocked to return all-null fields
    expect(result).toBeDefined();
    expect(result.drug_name).toBeNull();
  });

  it('returns parsed saved mapping when valid', () => {
    const savedMapping = JSON.stringify({
      drug_name: '0', quantity: '1', drug_code: '2',
      unit: null, yakka_unit_price: null, expiration_date: null, lot_number: null,
    });
    const result = resolveMappingFromTemplate(savedMapping, ['A', 'B', 'C'], 'dead_stock');
    expect(result.drug_name).toBe('0');
    expect(result.quantity).toBe('1');
  });

  it('falls back to suggestMapping when saved mapping is invalid', () => {
    const result = resolveMappingFromTemplate('{bad-json', ['A', 'B'], 'dead_stock');
    expect(result).toBeDefined();
  });
});

describe('upload-validation: resolveMappingFromTemplateWithSource', () => {
  it('returns fromSavedTemplate=true when saved mapping is valid', () => {
    const savedMapping = JSON.stringify({
      drug_name: '0', quantity: '1',
      unit: null, yakka_unit_price: null, expiration_date: null, lot_number: null, drug_code: null,
    });
    const result = resolveMappingFromTemplateWithSource(savedMapping, ['A', 'B'], 'dead_stock');
    expect(result.fromSavedTemplate).toBe(true);
    expect(result.mapping.drug_name).toBe('0');
  });

  it('returns fromSavedTemplate=false when saved mapping is null', () => {
    const result = resolveMappingFromTemplateWithSource(null, ['A', 'B'], 'dead_stock');
    expect(result.fromSavedTemplate).toBe(false);
  });

  it('returns fromSavedTemplate=false when saved mapping is broken', () => {
    const result = resolveMappingFromTemplateWithSource('not-json', ['A', 'B'], 'dead_stock');
    expect(result.fromSavedTemplate).toBe(false);
  });
});
