import { describe, it, expect } from 'vitest';
import { haversineDistance } from '../utils/geo-utils';

describe('haversineDistance', () => {
  it('returns 0 for same point', () => {
    expect(haversineDistance(35.6762, 139.6503, 35.6762, 139.6503)).toBe(0);
  });

  it('calculates distance between Tokyo and Osaka correctly', () => {
    // Tokyo: 35.6762, 139.6503
    // Osaka: 34.6937, 135.5023
    const distance = haversineDistance(35.6762, 139.6503, 34.6937, 135.5023);
    // Should be approximately 400km
    expect(distance).toBeGreaterThan(380);
    expect(distance).toBeLessThan(420);
  });

  it('calculates short distances', () => {
    // Two nearby points in Tokyo
    const distance = haversineDistance(35.6762, 139.6503, 35.6800, 139.6550);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(1); // Less than 1km
  });

  it('is symmetric', () => {
    const d1 = haversineDistance(35.6762, 139.6503, 34.6937, 135.5023);
    const d2 = haversineDistance(34.6937, 135.5023, 35.6762, 139.6503);
    expect(d1).toBeCloseTo(d2, 10);
  });
});
