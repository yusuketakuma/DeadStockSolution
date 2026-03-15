const DEFAULT_STATS_SUMMARY_CACHE_TTL_MS = 300_000;
const MAX_STATS_SUMMARY_CACHE_TTL_MS = 30 * 60_000;
const STATS_SUMMARY_CACHE_MAX_ENTRIES = 1_000;

const statisticsSummaryCache = new Map<number, {
  expiresAtMs: number;
  payload: unknown;
}>();

export function invalidateStatisticsSummaryCache(pharmacyId: number): void {
  if (!Number.isInteger(pharmacyId) || pharmacyId <= 0) return;
  statisticsSummaryCache.delete(pharmacyId);
}

export function invalidateStatisticsSummaryCacheForPharmacies(pharmacyIds: Iterable<number>): void {
  for (const pharmacyId of pharmacyIds) {
    invalidateStatisticsSummaryCache(pharmacyId);
  }
}

export function resolveStatsSummaryCacheTtlMs(): number {
  const raw = Number(process.env.STATISTICS_SUMMARY_CACHE_TTL_MS ?? DEFAULT_STATS_SUMMARY_CACHE_TTL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_STATS_SUMMARY_CACHE_TTL_MS;
  return Math.max(0, Math.min(MAX_STATS_SUMMARY_CACHE_TTL_MS, Math.floor(raw)));
}

export function pruneStatisticsSummaryCache(nowMs: number): void {
  for (const [pharmacyId, entry] of statisticsSummaryCache.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      statisticsSummaryCache.delete(pharmacyId);
    }
  }

  while (statisticsSummaryCache.size > STATS_SUMMARY_CACHE_MAX_ENTRIES) {
    const oldestKey = statisticsSummaryCache.keys().next().value;
    if (typeof oldestKey !== 'number') break;
    statisticsSummaryCache.delete(oldestKey);
  }
}

export function getCachedStatisticsSummary(pharmacyId: number, nowMs: number): unknown | null {
  const ttlMs = resolveStatsSummaryCacheTtlMs();
  if (ttlMs <= 0) return null;
  const cached = statisticsSummaryCache.get(pharmacyId);
  if (!cached) return null;
  if (cached.expiresAtMs <= nowMs) {
    statisticsSummaryCache.delete(pharmacyId);
    return null;
  }
  return cached.payload;
}

export function setCachedStatisticsSummary(pharmacyId: number, payload: unknown, nowMs: number): void {
  const ttlMs = resolveStatsSummaryCacheTtlMs();
  if (ttlMs <= 0) return;
  pruneStatisticsSummaryCache(nowMs);
  statisticsSummaryCache.set(pharmacyId, {
    expiresAtMs: nowMs + ttlMs,
    payload,
  });
}

export function clearStatisticsSummaryCacheForTests(): void {
  statisticsSummaryCache.clear();
}
