import { describe, it, expect } from 'vitest';
import { computeOptimalBatchSize } from '../services/upload-diff-utils';

describe('computeOptimalBatchSize', () => {
  it('returns 500 for small datasets (≤1000)', () => {
    expect(computeOptimalBatchSize(0)).toBe(500);
    expect(computeOptimalBatchSize(1)).toBe(500);
    expect(computeOptimalBatchSize(500)).toBe(500);
    expect(computeOptimalBatchSize(1000)).toBe(500);
  });

  it('returns 1000 for medium datasets (1001-10000)', () => {
    expect(computeOptimalBatchSize(1001)).toBe(1_000);
    expect(computeOptimalBatchSize(5000)).toBe(1_000);
    expect(computeOptimalBatchSize(10_000)).toBe(1_000);
  });

  it('returns 2000 for large datasets (10001-100000)', () => {
    expect(computeOptimalBatchSize(10_001)).toBe(2_000);
    expect(computeOptimalBatchSize(50_000)).toBe(2_000);
    expect(computeOptimalBatchSize(100_000)).toBe(2_000);
  });

  it('returns 5000 for very large datasets (>100000)', () => {
    expect(computeOptimalBatchSize(100_001)).toBe(5_000);
    expect(computeOptimalBatchSize(500_000)).toBe(5_000);
    expect(computeOptimalBatchSize(1_000_000)).toBe(5_000);
  });
});
