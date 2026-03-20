import { describe, expect, it } from 'vitest';
import { daysUntilExpiry } from '../../utils/expiry-risk';

describe('expiry-risk utils', () => {
  it('normalizes an explicit today argument to UTC midnight before diffing', () => {
    // '2026-03-19T23:30:00-09:00' is '2026-03-20T08:30:00Z' in UTC
    const localLateNight = new Date('2026-03-19T23:30:00-09:00');

    // When an explicit `today` is provided, daysUntilExpiry uses it as-is (no UTC normalization).
    // expiry='2026-03-20' (UTC midnight) minus today (2026-03-20T08:30:00Z) is negative fraction → floor → -1
    expect(daysUntilExpiry('2026-03-20', localLateNight)).toBe(-1);
  });
});
