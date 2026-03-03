import { roundTo2 } from './matching-score-service';

interface RequestMetric {
  timestamp: number;
  path: string;
  method: string;
  status: number;
  durationMs: number;
  requestId?: string;
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
const metrics: Array<RequestMetric | undefined> = new Array(MAX_METRICS);
let metricsCount = 0;
let nextWriteIndex = 0;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export function recordRequestMetric(metric: RequestMetric): void {
  metrics[nextWriteIndex] = metric;
  nextWriteIndex = (nextWriteIndex + 1) % MAX_METRICS;
  if (metricsCount < MAX_METRICS) {
    metricsCount += 1;
  }
}

export function getObservabilitySnapshot(windowMinutesRaw: number = 60): ObservabilitySnapshot {
  const windowMinutes = Math.max(5, Math.min(1440, Math.floor(windowMinutesRaw)));
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  let totalRequests = 0;
  let errors5xx = 0;
  let authFailures401 = 0;
  let forbidden403 = 0;
  const durations: number[] = [];
  const pathMap = new Map<string, number[]>();

  const startIndex = metricsCount === MAX_METRICS ? nextWriteIndex : 0;
  for (let offset = 0; offset < metricsCount; offset += 1) {
    const idx = (startIndex + offset) % MAX_METRICS;
    const metric = metrics[idx];
    if (!metric || metric.timestamp < cutoff) continue;

    totalRequests += 1;
    if (metric.status >= 500) errors5xx += 1;
    if (metric.status === 401) authFailures401 += 1;
    if (metric.status === 403) forbidden403 += 1;
    durations.push(metric.durationMs);

    const key = `${metric.method} ${metric.path}`;
    const list = pathMap.get(key);
    if (list) {
      list.push(metric.durationMs);
    } else {
      pathMap.set(key, [metric.durationMs]);
    }
  }

  durations.sort((a, b) => a - b);
  const avgLatencyMs = totalRequests === 0
    ? 0
    : roundTo2(durations.reduce((sum, value) => sum + value, 0) / totalRequests);
  const p95LatencyMs = roundTo2(percentile(durations, 95));
  const errorRate5xx = totalRequests === 0 ? 0 : roundTo2((errors5xx / totalRequests) * 100);

  const topSlowPaths = [...pathMap.entries()]
    .map(([path, durationsMs]) => {
      const sortedDurations = durationsMs.slice().sort((a, b) => a - b);
      const avg = sortedDurations.reduce((sum, value) => sum + value, 0) / sortedDurations.length;
      return {
        path,
        count: sortedDurations.length,
        avgLatencyMs: roundTo2(avg),
        p95LatencyMs: roundTo2(percentile(sortedDurations, 95)),
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
  metrics.fill(undefined);
  metricsCount = 0;
  nextWriteIndex = 0;
}
