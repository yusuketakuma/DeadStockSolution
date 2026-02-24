import { describe, it, expect } from 'vitest';
import { normalizePackageInfo, scorePackageMatch } from '../utils/package-utils';

describe('package-utils', () => {
  it('normalizes PTP package labels', () => {
    const result = normalizePackageInfo({
      packageDescription: '100錠(10錠×10)PTP',
      packageQuantity: null,
      packageUnit: null,
    });

    expect(result.normalizedPackageLabel).toBe('100錠');
    expect(result.packageForm).toBe('ptp');
    expect(result.isLoosePackage).toBe(false);
  });

  it('normalizes loose package labels', () => {
    const result = normalizePackageInfo({
      packageDescription: '100錠バラ包装',
      packageQuantity: null,
      packageUnit: null,
    });

    expect(result.normalizedPackageLabel).toBe('100錠バラ');
    expect(result.packageForm).toBe('loose');
    expect(result.isLoosePackage).toBe(true);
  });

  it('prefers structured quantity/unit when available', () => {
    const result = normalizePackageInfo({
      packageDescription: null,
      packageQuantity: 1000,
      packageUnit: '錠',
    });

    expect(result.normalizedPackageLabel).toBe('1000錠');
    expect(result.quantity).toBe(1000);
    expect(result.unit).toBe('錠');
  });

  it('scores matching loose package higher than non-loose', () => {
    const looseScore = scorePackageMatch({
      rowUnit: '100錠バラ包装',
      normalizedPackageLabel: '100錠バラ',
      packageDescription: '100錠バラ包装',
      isLoosePackage: true,
    });
    const normalScore = scorePackageMatch({
      rowUnit: '100錠バラ包装',
      normalizedPackageLabel: '100錠',
      packageDescription: '100錠(10錠×10)PTP',
      isLoosePackage: false,
    });

    expect(looseScore).toBeGreaterThan(normalScore);
  });
});
