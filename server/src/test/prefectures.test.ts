import { describe, it, expect } from 'vitest';
import { PREFECTURES, isValidPrefecture, extractPrefecture } from '../utils/prefectures';

describe('PREFECTURES', () => {
  it('has 47 entries', () => {
    expect(PREFECTURES).toHaveLength(47);
  });

  it('includes 北海道', () => {
    expect(PREFECTURES).toContain('北海道');
  });

  it('includes 東京都', () => {
    expect(PREFECTURES).toContain('東京都');
  });

  it('includes 大阪府', () => {
    expect(PREFECTURES).toContain('大阪府');
  });

  it('includes 沖縄県', () => {
    expect(PREFECTURES).toContain('沖縄県');
  });

  it('has no duplicates', () => {
    const unique = new Set(PREFECTURES);
    expect(unique.size).toBe(PREFECTURES.length);
  });

  it('starts with 北海道', () => {
    expect(PREFECTURES[0]).toBe('北海道');
  });

  it('ends with 沖縄県', () => {
    expect(PREFECTURES[PREFECTURES.length - 1]).toBe('沖縄県');
  });
});

describe('isValidPrefecture', () => {
  it('returns true for valid prefecture 東京都', () => {
    expect(isValidPrefecture('東京都')).toBe(true);
  });

  it('returns true for valid prefecture 北海道', () => {
    expect(isValidPrefecture('北海道')).toBe(true);
  });

  it('returns true for valid prefecture 京都府', () => {
    expect(isValidPrefecture('京都府')).toBe(true);
  });

  it('returns false for partial name 東京', () => {
    expect(isValidPrefecture('東京')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidPrefecture('')).toBe(false);
  });

  it('returns false for English name', () => {
    expect(isValidPrefecture('Tokyo')).toBe(false);
  });

  it('returns false for non-existent prefecture', () => {
    expect(isValidPrefecture('架空県')).toBe(false);
  });
});

describe('extractPrefecture', () => {
  it('extracts prefecture from full address', () => {
    expect(extractPrefecture('東京都新宿区西新宿2-8-1')).toBe('東京都');
  });

  it('extracts prefecture when address is prefecture only', () => {
    expect(extractPrefecture('大阪府')).toBe('大阪府');
  });

  it('returns null for no match', () => {
    expect(extractPrefecture('ニューヨーク市マンハッタン')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractPrefecture('')).toBeNull();
  });

  it('extracts 北海道 from address', () => {
    expect(extractPrefecture('北海道札幌市中央区')).toBe('北海道');
  });

  it('does not match substring that is not a prefix', () => {
    expect(extractPrefecture('住所は東京都です')).toBeNull();
  });

  it('extracts 神奈川県 from address', () => {
    expect(extractPrefecture('神奈川県横浜市中区')).toBe('神奈川県');
  });

  it('extracts 京都府 from address', () => {
    expect(extractPrefecture('京都府京都市左京区')).toBe('京都府');
  });
});
