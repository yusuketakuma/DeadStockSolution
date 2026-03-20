import { describe, expect, it } from 'vitest';
import { formatDateJa, formatDateTimeJa } from '../../utils/formatters';

describe('formatters', () => {
  it('formats date values in Asia/Tokyo regardless of runtime timezone', () => {
    expect(formatDateJa('2026-03-19T23:30:00Z')).toBe('2026/3/20');
  });

  it('formats datetime values in Asia/Tokyo regardless of runtime timezone', () => {
    expect(formatDateTimeJa('2026-03-19T23:30:00Z')).toContain('2026/3/20 8:30:00');
  });
});
