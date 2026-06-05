import { describe, expect, it } from 'vitest';
import {
  formatBoxCount,
  formatPackageNumber,
  formatPackageSize,
  formatPackageSummary,
  formatTotalQuantity,
  resolvePackageBoxCount,
  summarizePackageDisplay,
} from '../../utils/package-display';

describe('package-display', () => {
  it('formats total quantity with the item unit', () => {
    expect(formatTotalQuantity({ quantity: 100, unit: '錠' })).toBe('100錠');
    expect(formatTotalQuantity({ quantity: 12.34567, unit: 'mL' })).toBe('12.346mL');
    expect(formatPackageNumber(null)).toBe('-');
  });

  it('resolves box count from package quantity without changing total quantity semantics', () => {
    const item = {
      quantity: 250,
      unit: '錠',
      packageQuantity: 100,
      packageUnit: '錠',
      packageLabel: 'PTP 100錠',
    };

    expect(resolvePackageBoxCount(item)).toBe(2);
    expect(formatBoxCount(item)).toBe('2');
    expect(formatPackageSize(item)).toBe('100錠');
    expect(formatTotalQuantity(item)).toBe('250錠');
    expect(formatPackageSummary(item)).toBe('総数量 250錠 / 箱数 2箱 / 1箱入数 100錠 / 包装 PTP 100錠');
  });

  it('does not trust a stale boxCount when quantity and package quantity disagree', () => {
    const item = {
      quantity: 200,
      unit: '錠',
      packageQuantity: 100,
      packageUnit: '錠',
      boxCount: 3,
    };

    expect(resolvePackageBoxCount(item)).toBe(2);
    expect(formatBoxCount(item)).toBe('2');
  });

  it('marks loose packages as not applicable for box-based labels', () => {
    const summary = summarizePackageDisplay({
      quantity: 30,
      unit: '錠',
      packageQuantity: 10,
      packageUnit: '錠',
      packageForm: 'loose',
      packageLabel: null,
    });

    expect(summary.isLoosePackage).toBe(true);
    expect(summary.boxCountLabel).toBe('対象外');
    expect(summary.packageSizeLabel).toBe('対象外');
    expect(summary.totalQuantityLabel).toBe('30錠');
  });
});
