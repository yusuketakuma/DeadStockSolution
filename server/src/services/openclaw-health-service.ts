import { inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { openclawRequestEvents } from '../db/schema';
import { isFeatureEnabled } from '../config/feature-flags';
import { getOpenClawConfig, isOpenClawConnectorConfigured, isOpenClawWebhookConfigured } from './openclaw-status';
import { getOpenClawRetryQueueSnapshot } from './openclaw-retry-service';

const HANDOFF_EVENT_TYPES = ['handoff_accepted', 'handoff_deferred'] as const;

async function getHandoffKpi(): Promise<{
  handoffSuccessRate: number | null;
  lastHandoffAt: string | null;
}> {
  const rows = await db
    .select({ eventType: openclawRequestEvents.eventType, createdAt: openclawRequestEvents.createdAt })
    .from(openclawRequestEvents)
    .where(inArray(openclawRequestEvents.eventType, [...HANDOFF_EVENT_TYPES]));

  if (rows.length === 0) {
    return { handoffSuccessRate: null, lastHandoffAt: null };
  }

  let accepted = 0;
  let total = 0;
  let maxCreatedAt: string | null = null;

  for (const row of rows) {
    total += 1;
    if (row.eventType === 'handoff_accepted') {
      accepted += 1;
    }
    if (maxCreatedAt === null || row.createdAt > maxCreatedAt) {
      maxCreatedAt = row.createdAt;
    }
  }

  return {
    handoffSuccessRate: total > 0 ? accepted / total : null,
    lastHandoffAt: maxCreatedAt,
  };
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
  retryQueue: { pending: number; processing: number; completed: number; failed: number };
  handoffSuccessRate: number | null;
  lastHandoffAt: string | null;
}> {
  const connectorConfigured = isOpenClawConnectorConfigured();
  const webhookConfigured = isOpenClawWebhookConfigured();
  const [retryQueue, handoffKpi] = await Promise.all([
    getOpenClawRetryQueueSnapshot(),
    getHandoffKpi(),
  ]);
  const status = connectorConfigured && webhookConfigured && retryQueue.failed === 0 ? 'ok' : 'degraded';

  return {
    status,
    timestamp: new Date().toISOString(),
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
    retryQueue,
    handoffSuccessRate: handoffKpi.handoffSuccessRate,
    lastHandoffAt: handoffKpi.lastHandoffAt,
  };
}
