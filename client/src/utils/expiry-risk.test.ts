import { describe, it, expect } from 'vitest';
import { parseDateOnly, daysUntilExpiry, resolveBucket, bucketVariant, formatDaysRemaining } from './expiry-risk';

const TODAY = new Date('2026-03-01T00:00:00.000Z');

describe('parseDateOnly', () => {
  it('should parse YYYY-MM-DD', () => {
    expect(parseDateOnly('2026-03-15')?.toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('should parse YYYY/MM/DD', () => {
    expect(parseDateOnly('2026/03/15')?.toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('should return null for null/undefined/empty', () => {
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly(undefined)).toBeNull();
    expect(parseDateOnly('')).toBeNull();
  });

  it('should return null for invalid format', () => {
    expect(parseDateOnly('invalid')).toBeNull();
    expect(parseDateOnly('2026-13-01')).toBeNull();
  });

  it('should return null for impossible dates (round-trip validation)', () => {
    expect(parseDateOnly('2026-02-31')).toBeNull();
    expect(parseDateOnly('2026-04-31')).toBeNull();
    expect(parseDateOnly('2026-00-15')).toBeNull();
  });
});

describe('daysUntilExpiry', () => {
  it('should return days difference', () => {
    expect(daysUntilExpiry('2026-03-31', TODAY)).toBe(30);
  });

  it('should return negative for past dates', () => {
    expect(daysUntilExpiry('2026-02-28', TODAY)).toBe(-1);
  });

  it('should return 0 for today', () => {
    expect(daysUntilExpiry('2026-03-01', TODAY)).toBe(0);
  });

  it('should return null for null input', () => {
    expect(daysUntilExpiry(null, TODAY)).toBeNull();
  });
});

describe('resolveBucket', () => {
  it('should return unknown for null', () => {
    expect(resolveBucket(null)).toBe('unknown');
  });

  it('should return expired for negative', () => {
    expect(resolveBucket(-1)).toBe('expired');
  });

  it('should return within30 for 0', () => {
    expect(resolveBucket(0)).toBe('within30');
  });

  it('should return within30 for 30', () => {
    expect(resolveBucket(30)).toBe('within30');
  });

  it('should return within60 for 31', () => {
    expect(resolveBucket(31)).toBe('within60');
  });

  it('should return within60 for 60', () => {
    expect(resolveBucket(60)).toBe('within60');
  });

  it('should return within90 for 90', () => {
    expect(resolveBucket(90)).toBe('within90');
  });

  it('should return within120 for 120', () => {
    expect(resolveBucket(120)).toBe('within120');
  });

  it('should return over120 for 121', () => {
    expect(resolveBucket(121)).toBe('over120');
  });
});

describe('bucketVariant', () => {
  it('should map expired/within30 to danger', () => {
    expect(bucketVariant('expired')).toBe('danger');
    expect(bucketVariant('within30')).toBe('danger');
  });

  it('should map within60 to warning', () => {
    expect(bucketVariant('within60')).toBe('warning');
  });

  it('should map within90/120 to info', () => {
    expect(bucketVariant('within90')).toBe('info');
    expect(bucketVariant('within120')).toBe('info');
  });

  it('should map over120 to success', () => {
    expect(bucketVariant('over120')).toBe('success');
  });

  it('should map unknown to secondary', () => {
    expect(bucketVariant('unknown')).toBe('secondary');
  });
});

describe('formatDaysRemaining', () => {
  it('should format null as 不明', () => {
    expect(formatDaysRemaining(null)).toBe('不明');
  });

  it('should format negative as 期限切れ', () => {
    expect(formatDaysRemaining(-1)).toBe('期限切れ');
  });

  it('should format 0 as 本日期限', () => {
    expect(formatDaysRemaining(0)).toBe('本日期限');
  });

  it('should format positive as 残りN日', () => {
    expect(formatDaysRemaining(15)).toBe('残り15日');
    expect(formatDaysRemaining(120)).toBe('残り120日');
  });
});
