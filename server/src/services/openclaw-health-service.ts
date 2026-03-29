import { and, inArray, gte, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { openclawRequestEvents } from '../db/schema';
import { isFeatureEnabled } from '../config/feature-flags';
import { getOpenClawConfig, isOpenClawConnectorConfigured, isOpenClawWebhookConfigured } from './openclaw-status';
import { getOpenClawRetryQueueMetrics } from './openclaw-retry-service';
import { getDdsConnectionStatus } from './dds-agent-service';

const HANDOFF_EVENT_TYPES = ['handoff_accepted', 'handoff_deferred'] as const;

async function getHandoffKpi(): Promise<{
  handoffSuccessRate: number | null;
  lastHandoffAt: string | null;
}> {
  const rows = await db
    .select({
      eventType: openclawRequestEvents.eventType,
      count: sql<number>`count(*)::int`,
      latest: sql<string>`max(${openclawRequestEvents.createdAt})`,
    })
    .from(openclawRequestEvents)
    .where(and(
      inArray(openclawRequestEvents.eventType, [...HANDOFF_EVENT_TYPES]),
      gte(openclawRequestEvents.createdAt, sql`now() - interval '30 days'`),
    ))
    .groupBy(openclawRequestEvents.eventType);

  if (rows.length === 0) {
    return { handoffSuccessRate: null, lastHandoffAt: null };
  }

  let accepted = 0;
  let total = 0;
  let maxCreatedAt: string | null = null;

  for (const row of rows) {
    total += row.count;
    if (row.eventType === 'handoff_accepted') {
      accepted = row.count;
    }
    if (maxCreatedAt === null || (row.latest && row.latest > maxCreatedAt)) {
      maxCreatedAt = row.latest;
    }
  }

  return {
    handoffSuccessRate: total > 0 ? accepted / total : null,
    lastHandoffAt: maxCreatedAt,
  };
}

const RETRY_QUEUE_WARNING_PENDING_THRESHOLD = 50;
const RETRY_QUEUE_WARNING_OLDEST_PENDING_MS = 6 * 60 * 60 * 1000; // 6 hours in ms

function resolveRetryQueueWarning(
  pending: number,
  oldestPendingCreatedAt: string | null,
  nowMs: number,
): boolean {
  if (pending > RETRY_QUEUE_WARNING_PENDING_THRESHOLD) return true;
  if (oldestPendingCreatedAt !== null) {
    const ageMs = nowMs - new Date(oldestPendingCreatedAt).getTime();
    if (ageMs > RETRY_QUEUE_WARNING_OLDEST_PENDING_MS) return true;
  }
  return false;
}

export async function getOpenClawHealthSnapshot(): Promise<{
  status: 'ok' | 'degraded';
  timestamp: string;
  connector: { configured: boolean; mode: string };
  webhook: { configured: boolean };
  commands: { enabled: boolean };
  logPush: { enabled: boolean };
  autoFix: { enabled: boolean };
  autoEscalate: { enabled: boolean };
  retryQueue: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    failedLast24h: number;
    oldestPendingCreatedAt: string | null;
    warning: boolean;
  };
  handoffSuccessRate: number | null;
  lastHandoffAt: string | null;
  ddsAgent: {
    connected: boolean;
    agentId: string | null;
    lastSeenAt: string | null;
    queuedJobs: number;
    awaitingUser: number;
  };
}> {
  const connectorConfigured = isOpenClawConnectorConfigured();
  const webhookConfigured = isOpenClawWebhookConfigured();
  const nowMs = Date.now();
  const [retryMetrics, handoffKpi, ddsStatus] = await Promise.all([
    getOpenClawRetryQueueMetrics(),
    getHandoffKpi(),
    getDdsConnectionStatus().catch(() => null),
  ]);
  const status = connectorConfigured && webhookConfigured ? 'ok' : 'degraded';
  const retryQueueWarning = resolveRetryQueueWarning(
    retryMetrics.pending,
    retryMetrics.oldestPendingCreatedAt,
    nowMs,
  );

  return {
    status,
    timestamp: new Date(nowMs).toISOString(),
    connector: {
      configured: connectorConfigured,
      mode: getOpenClawConfig().mode,
    },
    webhook: {
      configured: webhookConfigured,
    },
    commands: {
      enabled: isFeatureEnabled('OPENCLAW_COMMANDS_ENABLED'),
    },
    logPush: {
      enabled: isFeatureEnabled('OPENCLAW_LOG_PUSH_ENABLED'),
    },
    autoFix: {
      enabled: isFeatureEnabled('OPENCLAW_ERROR_AUTOFIX_ENABLED'),
    },
    autoEscalate: {
      enabled: isFeatureEnabled('OPENCLAW_AUTO_ESCALATE_ENABLED'),
    },
    retryQueue: {
      pending: retryMetrics.pending,
      processing: retryMetrics.processing,
      completed: retryMetrics.completed,
      failed: retryMetrics.failed,
      failedLast24h: retryMetrics.failedLast24h,
      oldestPendingCreatedAt: retryMetrics.oldestPendingCreatedAt,
      warning: retryQueueWarning,
    },
    handoffSuccessRate: handoffKpi.handoffSuccessRate,
    lastHandoffAt: handoffKpi.lastHandoffAt,
    ddsAgent: {
      connected: ddsStatus?.connected ?? false,
      agentId: ddsStatus?.agentId ?? null,
      lastSeenAt: ddsStatus?.lastSeenAt ?? null,
      queuedJobs: ddsStatus?.queuedJobs ?? 0,
      awaitingUser: ddsStatus?.awaitingUser ?? 0,
    },
  };
}
