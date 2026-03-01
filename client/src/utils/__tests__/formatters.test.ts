import { describe, expect, it } from 'vitest';
import {
  formatCountJa,
  formatDateJa,
  formatDateTimeJa,
  formatNumberJa,
  formatYen,
} from '../formatters';

describe('formatters', () => {
  it('formats number in ja-JP locale', () => {
    expect(formatNumberJa(1234567)).toBe('1,234,567');
    expect(formatNumberJa(0)).toBe('0');
    expect(formatNumberJa(null)).toBe('-');
  });

  it('formats count with suffix', () => {
    expect(formatCountJa(456)).toBe('456件');
    expect(formatCountJa(1234, '人')).toBe('1,234人');
    expect(formatCountJa(undefined)).toBe('-');
  });

  it('formats yen with currency suffix', () => {
    expect(formatYen(12000)).toBe('12,000円');
    expect(formatYen(null)).toBe('-');
  });

  it('formats date values safely', () => {
    expect(formatDateTimeJa('2026-02-01T09:00:00.000Z')).toContain('2026');
    expect(formatDateJa('2026-02-01T09:00:00.000Z')).toContain('2026');
    expect(formatDateTimeJa('invalid', 'N/A')).toBe('N/A');
    expect(formatDateJa(undefined)).toBe('-');
  });
});
