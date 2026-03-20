import { describe, expect, it } from 'vitest';

import { createCache } from '../services/cache-service';

describe('cache-service', () => {
  it('removes expired oldest entries before falling back to live-entry eviction', () => {
    const baseNow = 1_000_000;
    const originalNow = Date.now;
    Date.now = () => baseNow;

    try {
      const cache = createCache<number>({
        ttlMs: 1_000,
        maxEntries: 2,
        name: 'test-cache',
      });

      cache.set('first', 1);
      Date.now = () => baseNow + 900;
      cache.set('second', 2);
      Date.now = () => baseNow + 950;
      cache.set('third', 3);

      Date.now = () => baseNow + 1_100;
      cache.set('fourth', 4);

      expect(cache.size()).toBe(2);
      expect(cache.get('first')).toBeUndefined();
      expect(cache.get('second')).toBeUndefined();
      expect(cache.get('third')).toBe(3);
      expect(cache.get('fourth')).toBe(4);
    } finally {
      Date.now = originalNow;
    }
  });
});
