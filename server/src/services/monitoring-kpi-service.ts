import { and, eq, gte, lte, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { uploadConfirmJobs } from '../db/schema';
import { getObservabilitySnapshot } from './observability-service';
import { roundTo2 } from './matching-score-service';

interface MonitoringKpiThresholds {
  errorRate5xx: number;
  uploadFailureRate: number;
  pendingStaleCount: number;
  pendingStaleMinutes: number;
}

interface MonitoringKpiBreaches {
  errorRate5xx: boolean;
  uploadFailureRate: boolean;
  pendingStaleCount: boolean;
}

interface MonitoringKpiMetrics {
  errorRate5xx: number;
  uploadFailureRate: number;
  pendingUploadStaleCount: number;
}

export interface MonitoringKpiSnapshot {
  status: 'healthy' | 'warning';
  metrics: MonitoringKpiMetrics;
  thresholds: MonitoringKpiThresholds;
  breaches: MonitoringKpiBreaches;
  context: {
    windowMinutes: number;
    uploadWindowHours: number;
  };
}

function resolveThresholdPercent(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(100, raw));
}

function resolveThresholdCount(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.floor(raw));
}

function resolveThresholds(): MonitoringKpiThresholds {
  const pendingStaleMinutes = resolveThresholdCount('MONITORING_PENDING_UPLOAD_STALE_MINUTES', 60);
  return {
    errorRate5xx: resolveThresholdPercent('MONITORING_ERROR_RATE_5XX_THRESHOLD', 2),
    uploadFailureRate: resolveThresholdPercent('MONITORING_UPLOAD_FAILURE_RATE_THRESHOLD', 10),
    pendingStaleCount: resolveThresholdCount('MONITORING_PENDING_UPLOAD_STALE_COUNT_THRESHOLD', 5),
    pendingStaleMinutes,
  };
}

export async function getMonitoringKpiSnapshot(windowMinutesRaw: number = 60): Promise<MonitoringKpiSnapshot> {
  const observability = getObservabilitySnapshot(windowMinutesRaw);
  const thresholds = resolveThresholds();

  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const staleBefore = new Date(now - thresholds.pendingStaleMinutes * 60 * 1000).toISOString();

  const [countsRow] = await db.select({
    failed: sql<number>`count(*) filter (where ${uploadConfirmJobs.status} = 'failed' and ${uploadConfirmJobs.createdAt} >= ${since24h})`,
    completed: sql<number>`count(*) filter (where ${uploadConfirmJobs.status} = 'completed' and ${uploadConfirmJobs.createdAt} >= ${since24h})`,
    pendingStale: sql<number>`count(*) filter (where ${uploadConfirmJobs.status} = 'pending' and ${uploadConfirmJobs.createdAt} <= ${staleBefore})`,
  })
    .from(uploadConfirmJobs)
    .where(
      or(
        gte(uploadConfirmJobs.createdAt, since24h),
        and(eq(uploadConfirmJobs.status, 'pending'), lte(uploadConfirmJobs.createdAt, staleBefore)),
      ),
    );

  const failedCount = Number(countsRow?.failed ?? 0);
  const completedCount = Number(countsRow?.completed ?? 0);
  const pendingStaleCount = Number(countsRow?.pendingStale ?? 0);
  const totalHandled = failedCount + completedCount;
  const uploadFailureRate = totalHandled === 0
    ? 0
    : roundTo2((failedCount / totalHandled) * 100);

  const metrics: MonitoringKpiMetrics = {
    errorRate5xx: observability.errorRate5xx,
    uploadFailureRate,
    pendingUploadStaleCount: pendingStaleCount,
  };

  const breaches: MonitoringKpiBreaches = {
    errorRate5xx: metrics.errorRate5xx >= thresholds.errorRate5xx,
    uploadFailureRate: metrics.uploadFailureRate >= thresholds.uploadFailureRate,
    pendingStaleCount: metrics.pendingUploadStaleCount >= thresholds.pendingStaleCount,
  };

  const status: MonitoringKpiSnapshot['status'] = Object.values(breaches).some(Boolean)
    ? 'warning'
    : 'healthy';

  return {
    status,
    metrics,
    thresholds,
    breaches,
    context: {
      windowMinutes: observability.windowMinutes,
      uploadWindowHours: 24,
    },
  };
}
