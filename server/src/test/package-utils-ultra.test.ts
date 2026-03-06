import { describe, it, expect } from 'vitest';
import { normalizePackageInfo, scorePackageMatch } from '../utils/package-utils';

describe('package-utils ultra coverage', () => {
  describe('normalizePackageInfo edge cases', () => {
    it('returns null label when description is empty and no quantity/unit', () => {
      const result = normalizePackageInfo({
        packageDescription: '',
        packageQuantity: null,
        packageUnit: null,
      });
      expect(result.normalizedPackageLabel).toBeNull();
      expect(result.packageForm).toBeNull();
      expect(result.isLoosePackage).toBe(false);
      expect(result.quantity).toBeNull();
      expect(result.unit).toBeNull();
    });

    it('detects bottle package form', () => {
      const result = normalizePackageInfo({
        packageDescription: '100mL瓶',
        packageQuantity: null,
        packageUnit: null,
      });
      expect(result.packageForm).toBe('bottle');
      expect(result.quantity).toBe(100);
      expect(result.unit).toBe('mL');
    });

    it('detects sachet (分包) package form', () => {
      const result = normalizePackageInfo({
        packageDescription: '30包分包',
        packageQuantity: null,
        packageUnit: null,
      });
      expect(result.packageForm).toBe('sachet');
      expect(result.quantity).toBe(30);
      expect(result.unit).toBe('包');
    });

    it('detects vial package form', () => {
      const result = normalizePackageInfo({
        packageDescription: '10mLバイアル',
        packageQuantity: null,
        packageUnit: null,
      });
      expect(result.packageForm).toBe('vial');
    });

    it('detects ampoule package form', () => {
      const result = normalizePackageInfo({
        packageDescription: '5mLアンプル',
        packageQuantity: null,
        packageUnit: null,
      });
      expect(result.packageForm).toBe('ampoule');
    });

    it('falls back to other package form for unrecognized descriptions', () => {
      const result = normalizePackageInfo({
        packageDescription: 'チューブ入り',
        packageQuantity: null,
        packageUnit: null,
      });
      expect(result.packageForm).toBe('other');
    });

    it('normalizes capsule unit from "cap"', () => {
      const result = normalizePackageInfo({
        packageDescription: null,
        packageQuantity: 100,
        packageUnit: 'cap',
      });
      expect(result.unit).toBe('カプセル');
      expect(result.normalizedPackageLabel).toBe('100カプセル');
    });

    it('normalizes capsule unit from "カプセル" in description', () => {
      const result = normalizePackageInfo({
        packageDescription: '100カプセル',
        packageQuantity: null,
        packageUnit: null,
      });
      expect(result.unit).toBe('カプセル');
      expect(result.quantity).toBe(100);
    });

    it('normalizes μg unit from "ug"', () => {
      const result = normalizePackageInfo({
        packageDescription: null,
        packageQuantity: 250,
        packageUnit: 'ug',
      });
      expect(result.unit).toBe('μg');
    });

    it('normalizes "ml" to "mL"', () => {
      const result = normalizePackageInfo({
        packageDescription: null,
        packageQuantity: 500,
        packageUnit: 'ml',
      });
      expect(result.unit).toBe('mL');
    });

    it('returns null for unrecognizable unit', () => {
      const result = normalizePackageInfo({
        packageDescription: null,
        packageQuantity: 100,
        packageUnit: 'zzz',
      });
      expect(result.unit).toBeNull();
      expect(result.normalizedPackageLabel).toBeNull();
    });

    it('parses direct quantity from description (10錠×10) using direct match first', () => {
      // The direct regex matches '10錠' before the multiplied regex, so quantity=10
      const result = normalizePackageInfo({
        packageDescription: '10錠×10',
        packageQuantity: null,
        packageUnit: null,
      });
      expect(result.quantity).toBe(10);
      expect(result.unit).toBe('錠');
    });

    it('prefers structured quantity over parsed description', () => {
      const result = normalizePackageInfo({
        packageDescription: '10錠×10',
        packageQuantity: 200,
        packageUnit: '錠',
      });
      expect(result.quantity).toBe(200);
      expect(result.unit).toBe('錠');
      expect(result.normalizedPackageLabel).toBe('200錠');
    });

    it('uses parsed unit from description when packageUnit is null', () => {
      const result = normalizePackageInfo({
        packageDescription: '50mg',
        packageQuantity: 50,
        packageUnit: null,
      });
      expect(result.unit).toBe('mg');
      expect(result.normalizedPackageLabel).toBe('50mg');
    });

    it('normalizes full-width characters in description', () => {
      const result = normalizePackageInfo({
        packageDescription: '１００錠PTP',
        packageQuantity: null,
        packageUnit: null,
      });
      // Full-width digits normalize to half-width via NFKC, so "１００" -> "100"
      expect(result.quantity).toBe(100);
      expect(result.packageForm).toBe('ptp');
    });

    it('detects stick as sachet form', () => {
      const result = normalizePackageInfo({
        packageDescription: '30包スティック',
        packageQuantity: null,
        packageUnit: null,
      });
      expect(result.packageForm).toBe('sachet');
    });

    it('handles decimal quantity', () => {
      const result = normalizePackageInfo({
        packageDescription: '2.5mL',
        packageQuantity: null,
        packageUnit: null,
      });
      expect(result.quantity).toBe(2.5);
      expect(result.normalizedPackageLabel).toBe('2.5mL');
    });

    it('extracts unit from unrecognized text with embedded known unit', () => {
      const result = normalizePackageInfo({
        packageDescription: null,
        packageQuantity: 10,
        packageUnit: 'per錠',
      });
      expect(result.unit).toBe('錠');
    });

    it('handles null packageDescription', () => {
      const result = normalizePackageInfo({
        packageDescription: null,
        packageQuantity: null,
        packageUnit: null,
      });
      expect(result.normalizedPackageLabel).toBeNull();
      expect(result.packageForm).toBeNull();
    });

    it('handles empty string unit', () => {
      const result = normalizePackageInfo({
        packageDescription: null,
        packageQuantity: 100,
        packageUnit: '',
      });
      expect(result.unit).toBeNull();
    });

    it('handles whitespace-only unit', () => {
      const result = normalizePackageInfo({
        packageDescription: null,
        packageQuantity: 100,
        packageUnit: '   ',
      });
      expect(result.unit).toBeNull();
    });
  });

  describe('scorePackageMatch edge cases', () => {
    it('returns 0 when rowUnit is null', () => {
      const score = scorePackageMatch({
        rowUnit: null,
        normalizedPackageLabel: '100錠',
        packageDescription: '100錠PTP',
        isLoosePackage: false,
      });
      expect(score).toBe(0);
    });

    it('returns 0 when rowUnit is empty string', () => {
      const score = scorePackageMatch({
        rowUnit: '',
        normalizedPackageLabel: '100錠',
        packageDescription: '100錠PTP',
        isLoosePackage: false,
      });
      expect(score).toBe(0);
    });

    it('scores exact match with normalizedPackageLabel', () => {
      const score = scorePackageMatch({
        rowUnit: '100錠',
        normalizedPackageLabel: '100錠',
        packageDescription: null,
        isLoosePackage: false,
      });
      expect(score).toBeGreaterThan(0);
    });

    it('scores partial label inclusion', () => {
      const score = scorePackageMatch({
        rowUnit: '100錠PTP10シート',
        normalizedPackageLabel: '100錠',
        packageDescription: null,
        isLoosePackage: false,
      });
      expect(score).toBeGreaterThan(0);
    });

    it('scores when label includes rowUnit', () => {
      const score = scorePackageMatch({
        rowUnit: '錠',
        normalizedPackageLabel: '100錠',
        packageDescription: null,
        isLoosePackage: false,
      });
      expect(score).toBeGreaterThan(0);
    });

    it('scores exact description match', () => {
      const score = scorePackageMatch({
        rowUnit: '100錠ptp',
        normalizedPackageLabel: null,
        packageDescription: '100錠PTP',
        isLoosePackage: false,
      });
      expect(score).toBeGreaterThan(0);
    });

    it('scores description includes rowUnit', () => {
      const score = scorePackageMatch({
        rowUnit: '100',
        normalizedPackageLabel: null,
        packageDescription: '100錠PTP',
        isLoosePackage: false,
      });
      expect(score).toBeGreaterThan(0);
    });

    it('penalizes loose mismatch', () => {
      const looseMismatch = scorePackageMatch({
        rowUnit: '100錠',
        normalizedPackageLabel: '100錠',
        packageDescription: null,
        isLoosePackage: true, // package is loose
      });
      const looseMatch = scorePackageMatch({
        rowUnit: '100錠',
        normalizedPackageLabel: '100錠',
        packageDescription: null,
        isLoosePackage: false, // package is not loose
      });
      // loose mismatch is penalized (-10) while looseMatch gets neither bonus nor penalty
      expect(looseMismatch).toBeLessThan(looseMatch);
    });

    it('gives bonus for matching loose hint', () => {
      const score = scorePackageMatch({
        rowUnit: '100錠バラ',
        normalizedPackageLabel: '100錠バラ',
        packageDescription: null,
        isLoosePackage: true,
      });
      // Should have loose bonus (+20) instead of penalty
      expect(score).toBeGreaterThan(100);
    });

    it('handles null description and null label with no loose mismatch', () => {
      const score = scorePackageMatch({
        rowUnit: '100錠',
        normalizedPackageLabel: null,
        packageDescription: null,
        isLoosePackage: false,
      });
      // No label or description matches, rowLoose=false, isLoosePackage=false => no penalty
      expect(score).toBe(0);
    });

    it('penalizes when rowUnit has バラ but package is not loose', () => {
      const score = scorePackageMatch({
        rowUnit: '100錠バラ',
        normalizedPackageLabel: null,
        packageDescription: null,
        isLoosePackage: false,
      });
      // rowLoose=true, isLoosePackage=false => -10 penalty
      expect(score).toBe(-10);
    });
  });
});
