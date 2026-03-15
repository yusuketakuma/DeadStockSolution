export interface CacheOptions {
  ttlMs: number;
  maxEntries: number;
  name: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(opts: CacheOptions) {
    this.ttlMs = Number.isFinite(opts.ttlMs) ? Math.max(0, Math.floor(opts.ttlMs)) : 0;
    this.maxEntries = Number.isFinite(opts.maxEntries) ? Math.max(0, Math.floor(opts.maxEntries)) : 0;
    void opts.name;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.ttlMs <= 0 || this.maxEntries <= 0) return;

    const now = Date.now();
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
    }

    this.entries.set(key, {
      value,
      expiresAt: now + this.ttlMs,
    });

    if (this.entries.size <= this.maxEntries) {
      return;
    }

    for (const [oldestKey, oldestEntry] of this.entries) {
      if (oldestEntry.expiresAt <= now) {
        this.entries.delete(oldestKey);
      }
      if (this.entries.size <= this.maxEntries) {
        return;
      }
    }

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (typeof oldestKey !== 'string') break;
      this.entries.delete(oldestKey);
    }
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  invalidateAll(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

export function createCache<T>(opts: CacheOptions): TtlCache<T> {
  return new TtlCache<T>(opts);
}
