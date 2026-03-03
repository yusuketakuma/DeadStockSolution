import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getStaleBeforeIso, getNextRetryIso } from '../utils/job-retry-utils';

describe('getStaleBeforeIso', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an ISO string', () => {
    const result = getStaleBeforeIso(60_000);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns exact ISO string with faked time', () => {
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    const result = getStaleBeforeIso(60_000);
    expect(result).toBe('2026-03-01T11:59:00.000Z');
  });

  it('returns current time when timeout is zero', () => {
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    const result = getStaleBeforeIso(0);
    expect(result).toBe('2026-03-01T12:00:00.000Z');
  });

  it('handles large timeout (24 hours)', () => {
    vi.setSystemTime(new Date('2026-03-02T00:00:00.000Z'));
    const result = getStaleBeforeIso(24 * 60 * 60 * 1000);
    expect(result).toBe('2026-03-01T00:00:00.000Z');
  });

  it('returns a time in the past relative to now', () => {
    vi.setSystemTime(new Date('2026-06-15T08:30:00.000Z'));
    const result = getStaleBeforeIso(5_000);
    const resultDate = new Date(result);
    expect(resultDate.getTime()).toBe(new Date('2026-06-15T08:29:55.000Z').getTime());
  });

  it('handles 1ms timeout', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.001Z'));
    const result = getStaleBeforeIso(1);
    expect(result).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('getNextRetryIso', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when nextAttempts > maxAttempts', () => {
    expect(getNextRetryIso(5, 3, 1000)).toBeNull();
  });

  it('returns null when nextAttempts equals maxAttempts', () => {
    expect(getNextRetryIso(3, 3, 1000)).toBeNull();
  });

  it('returns an ISO string when retries remain', () => {
    const result = getNextRetryIso(0, 3, 1000);
    expect(result).not.toBeNull();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('first attempt (nextAttempts=0) uses backoffBaseMs * 1', () => {
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    const result = getNextRetryIso(0, 5, 10_000);
    expect(result).toBe('2026-03-01T12:00:10.000Z');
  });

  it('second attempt (nextAttempts=1) uses backoffBaseMs * 1', () => {
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    const result = getNextRetryIso(1, 5, 10_000);
    expect(result).toBe('2026-03-01T12:00:10.000Z');
  });

  it('third attempt (nextAttempts=2) uses backoffBaseMs * 2', () => {
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    const result = getNextRetryIso(2, 5, 10_000);
    expect(result).toBe('2026-03-01T12:00:20.000Z');
  });

  it('fourth attempt (nextAttempts=3) uses backoffBaseMs * 3', () => {
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    const result = getNextRetryIso(3, 5, 10_000);
    expect(result).toBe('2026-03-01T12:00:30.000Z');
  });

  it('returns exact ISO string with faked time', () => {
    vi.setSystemTime(new Date('2026-06-15T00:00:00.000Z'));
    const result = getNextRetryIso(0, 3, 5_000);
    expect(result).toBe('2026-06-15T00:00:05.000Z');
  });

  it('returns a time in the future relative to now', () => {
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    const result = getNextRetryIso(1, 3, 2_000);
    const resultDate = new Date(result!);
    expect(resultDate.getTime()).toBeGreaterThan(new Date('2026-03-01T12:00:00.000Z').getTime());
  });

  it('zero backoff base results in current time (Math.max(1, n) * 0 = 0)', () => {
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    const result = getNextRetryIso(0, 3, 0);
    expect(result).toBe('2026-03-01T12:00:00.000Z');
  });
});
