interface RequestMetric {
  timestamp: number;
  path: string;
  method: string;
  status: number;
  durationMs: number;
}

interface SlowPathStat {
  path: string;
  count: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export interface ObservabilitySnapshot {
  windowMinutes: number;
  totalRequests: number;
  totalErrors5xx: number;
  errorRate5xx: number;
  authFailures401: number;
  forbidden403: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  topSlowPaths: SlowPathStat[];
}

const MAX_METRICS = 20000;
const metrics: RequestMetric[] = [];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function recordRequestMetric(metric: RequestMetric): void {
  metrics.push(metric);
  if (metrics.length > MAX_METRICS) {
    metrics.splice(0, metrics.length - MAX_METRICS);
  }
}

export function getObservabilitySnapshot(windowMinutesRaw: number = 60): ObservabilitySnapshot {
  const windowMinutes = Math.max(5, Math.min(1440, Math.floor(windowMinutesRaw)));
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  const target = metrics.filter((metric) => metric.timestamp >= cutoff);

  const totalRequests = target.length;
  const errors5xx = target.filter((metric) => metric.status >= 500).length;
  const authFailures401 = target.filter((metric) => metric.status === 401).length;
  const forbidden403 = target.filter((metric) => metric.status === 403).length;

  const durations = target.map((metric) => metric.durationMs).sort((a, b) => a - b);
  const avgLatencyMs = totalRequests === 0
    ? 0
    : round(durations.reduce((sum, value) => sum + value, 0) / totalRequests);
  const p95LatencyMs = round(percentile(durations, 95));
  const errorRate5xx = totalRequests === 0 ? 0 : round((errors5xx / totalRequests) * 100);

  const pathMap = new Map<string, number[]>();
  for (const metric of target) {
    const key = `${metric.method} ${metric.path}`;
    const list = pathMap.get(key) ?? [];
    list.push(metric.durationMs);
    pathMap.set(key, list);
  }

  const topSlowPaths = [...pathMap.entries()]
    .map(([path, durationsMs]) => {
      const sortedDurations = durationsMs.slice().sort((a, b) => a - b);
      const avg = sortedDurations.reduce((sum, value) => sum + value, 0) / sortedDurations.length;
      return {
        path,
        count: sortedDurations.length,
        avgLatencyMs: round(avg),
        p95LatencyMs: round(percentile(sortedDurations, 95)),
      };
    })
    .sort((a, b) => b.p95LatencyMs - a.p95LatencyMs || b.count - a.count)
    .slice(0, 5);

  return {
    windowMinutes,
    totalRequests,
    totalErrors5xx: errors5xx,
    errorRate5xx,
    authFailures401,
    forbidden403,
    avgLatencyMs,
    p95LatencyMs,
    topSlowPaths,
  };
}

export function resetObservabilityMetrics(): void {
  metrics.length = 0;
}
