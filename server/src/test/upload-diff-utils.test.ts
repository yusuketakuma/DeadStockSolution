import { describe, it, expect } from 'vitest';
import {
  normalizeString,
  normalizeNullableNumber,
  normalizeDate,
  deadStockKey,
  usedMedicationKey,
  equalNullableNumber,
  dedupeIncomingByKey,
  buildExistingByKey,
} from '../utils/upload-diff-utils';

describe('normalizeString', () => {
  it('returns empty string for null', () => {
    expect(normalizeString(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeString(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeString('')).toBe('');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeString('  hello  ')).toBe('hello');
  });

  it('returns value unchanged when no whitespace', () => {
    expect(normalizeString('abc')).toBe('abc');
  });

  it('trims tabs and newlines', () => {
    expect(normalizeString('\t\n value \n\t')).toBe('value');
  });
});

describe('normalizeNullableNumber', () => {
  it('returns null for null', () => {
    expect(normalizeNullableNumber(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeNullableNumber(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(normalizeNullableNumber(NaN)).toBeNull();
  });

  it('returns integer unchanged', () => {
    expect(normalizeNullableNumber(42)).toBe(42);
  });

  it('rounds to 3 decimal places', () => {
    expect(normalizeNullableNumber(1.23456)).toBe(1.235);
  });

  it('preserves value with fewer than 3 decimals', () => {
    expect(normalizeNullableNumber(1.5)).toBe(1.5);
  });

  it('handles zero', () => {
    expect(normalizeNullableNumber(0)).toBe(0);
  });

  it('handles negative numbers', () => {
    expect(normalizeNullableNumber(-3.14159)).toBe(-3.142);
  });

  it('rounds 0.0005 up at third decimal', () => {
    expect(normalizeNullableNumber(1.0005)).toBe(1.001);
  });
});

describe('normalizeDate', () => {
  it('returns null for null', () => {
    expect(normalizeDate(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeDate(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeDate('')).toBeNull();
  });

  it('converts slash format to dash format', () => {
    expect(normalizeDate('2025/03/15')).toBe('2025-03-15');
  });

  it('returns dash format as-is', () => {
    expect(normalizeDate('2025-03-15')).toBe('2025-03-15');
  });

  it('trims whitespace', () => {
    expect(normalizeDate('  2025-03-15  ')).toBe('2025-03-15');
  });

  it('returns null for invalid format (no day)', () => {
    expect(normalizeDate('2025-03')).toBeNull();
  });

  it('returns null for datetime string', () => {
    expect(normalizeDate('2025-03-15T10:00:00')).toBeNull();
  });

  it('returns null for text', () => {
    expect(normalizeDate('not-a-date')).toBeNull();
  });
});

describe('deadStockKey', () => {
  it('joins all fields with pipe separator', () => {
    const item = {
      drugCode: 'DC001',
      drugName: 'DrugA',
      unit: 'mg',
      expirationDate: '2025-12-31',
      lotNumber: 'LOT001',
    };
    expect(deadStockKey(item)).toBe('DC001|DrugA|mg|2025-12-31|LOT001');
  });

  it('uses empty string for null fields', () => {
    const item = {
      drugCode: null,
      drugName: 'DrugB',
      unit: null,
      expirationDate: null,
      lotNumber: null,
    };
    expect(deadStockKey(item)).toBe('|DrugB|||');
  });

  it('trims whitespace from all fields', () => {
    const item = {
      drugCode: ' DC001 ',
      drugName: ' DrugA ',
      unit: ' mg ',
      expirationDate: ' 2025-12-31 ',
      lotNumber: ' LOT001 ',
    };
    expect(deadStockKey(item)).toBe('DC001|DrugA|mg|2025-12-31|LOT001');
  });
});

describe('usedMedicationKey', () => {
  it('joins drugCode, drugName, unit with pipe separator', () => {
    const item = { drugCode: 'DC001', drugName: 'DrugA', unit: 'mg' };
    expect(usedMedicationKey(item)).toBe('DC001|DrugA|mg');
  });

  it('uses empty string for null drugCode', () => {
    const item = { drugCode: null, drugName: 'DrugA', unit: 'mg' };
    expect(usedMedicationKey(item)).toBe('|DrugA|mg');
  });

  it('uses empty string for null unit', () => {
    const item = { drugCode: 'DC001', drugName: 'DrugA', unit: null };
    expect(usedMedicationKey(item)).toBe('DC001|DrugA|');
  });

  it('uses empty string for both null drugCode and unit', () => {
    const item = { drugCode: null, drugName: 'DrugA', unit: null };
    expect(usedMedicationKey(item)).toBe('|DrugA|');
  });
});

describe('equalNullableNumber', () => {
  it('returns true when both are null', () => {
    expect(equalNullableNumber(null, null)).toBe(true);
  });

  it('returns false when only left is null', () => {
    expect(equalNullableNumber(null, 1)).toBe(false);
  });

  it('returns false when only right is null', () => {
    expect(equalNullableNumber(1, null)).toBe(false);
  });

  it('returns true for equal numbers', () => {
    expect(equalNullableNumber(42, 42)).toBe(true);
  });

  it('returns true for nearly equal numbers within threshold', () => {
    expect(equalNullableNumber(1.00009, 1.0001)).toBe(true);
  });

  it('returns false for numbers differing by more than 0.0001', () => {
    expect(equalNullableNumber(1.0, 1.001)).toBe(false);
  });

  it('accepts string left operand and converts to number', () => {
    expect(equalNullableNumber('42', 42)).toBe(true);
  });

  it('returns true for difference exactly at threshold boundary', () => {
    expect(equalNullableNumber(1.0, 1.00005)).toBe(true);
  });

  it('returns false for difference exceeding 0.0001', () => {
    expect(equalNullableNumber(1.0, 1.0002)).toBe(false);
  });
});

describe('dedupeIncomingByKey', () => {
  const keyFn = (item: { id: string }) => item.id;

  it('returns empty array for empty input', () => {
    expect(dedupeIncomingByKey([], keyFn)).toEqual([]);
  });

  it('returns all items when no duplicates', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(dedupeIncomingByKey(items, keyFn)).toEqual(items);
  });

  it('keeps last item for duplicate keys', () => {
    const items = [
      { id: 'a', value: 1 },
      { id: 'a', value: 2 },
    ];
    const result = dedupeIncomingByKey(items, (i) => i.id);
    expect(result).toEqual([{ id: 'a', value: 2 }]);
  });

  it('returns single item unchanged', () => {
    const items = [{ id: 'x' }];
    expect(dedupeIncomingByKey(items, keyFn)).toEqual([{ id: 'x' }]);
  });

  it('preserves order of first occurrence keys', () => {
    const items = [
      { id: 'b', v: 1 },
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
    ];
    const result = dedupeIncomingByKey(items, (i) => i.id);
    expect(result.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('buildExistingByKey', () => {
  const keyFn = (item: { id: string }) => item.id;

  it('returns empty map for empty input', () => {
    const result = buildExistingByKey([], keyFn);
    expect(result.size).toBe(0);
  });

  it('builds map from unique items', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const result = buildExistingByKey(items, keyFn);
    expect(result.size).toBe(2);
    expect(result.get('a')).toEqual({ id: 'a' });
    expect(result.get('b')).toEqual({ id: 'b' });
  });

  it('keeps first item for duplicate keys', () => {
    const items = [
      { id: 'a', value: 1 },
      { id: 'a', value: 2 },
    ];
    const result = buildExistingByKey(items, (i) => i.id);
    expect(result.get('a')).toEqual({ id: 'a', value: 1 });
  });

  it('returns correct map for single item', () => {
    const items = [{ id: 'only' }];
    const result = buildExistingByKey(items, keyFn);
    expect(result.size).toBe(1);
    expect(result.get('only')).toEqual({ id: 'only' });
  });
});
