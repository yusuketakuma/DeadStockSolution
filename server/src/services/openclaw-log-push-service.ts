import { logger } from './logger';

export interface LogAlertEntry {
  source: string;
  severity: 'critical' | 'error' | 'warning';
  errorCode: string | null;
  message: string;
  logId: number;
  occurredAt: string;
  detail?: unknown;
}

interface AlertPayload {
  type: 'log_alert';
  severity: string;
  logs: LogAlertEntry[];
  sentAt: string;
}

// In-memory buffers by severity
const buffers: Record<string, LogAlertEntry[]> = {
  critical: [],
  error: [],
  warning: [],
};

// Flush intervals (ms)
const FLUSH_INTERVALS: Record<string, number> = {
  critical: 0,        // Immediate
  error: 30_000,      // 30 seconds
  warning: 300_000,   // 5 minutes
};

let flushTimers: Record<string, ReturnType<typeof setTimeout> | null> = {
  critical: null,
  error: null,
  warning: null,
};

export function enqueueLogAlert(entry: LogAlertEntry): void {
  if (!isEnabled()) return;

  const severity = entry.severity;
  buffers[severity].push(entry);

  if (severity === 'critical') {
    // Flush immediately for critical
    flushBuffer('critical').catch(err => {
      logger.error('Failed to flush critical log alerts', { error: String(err) });
    });
    return;
  }

  // Schedule flush if not already scheduled
  if (!flushTimers[severity]) {
    const envKey = `OPENCLAW_LOG_PUSH_${severity.toUpperCase()}_BUFFER_MS`;
    const interval = Number(process.env[envKey]) || FLUSH_INTERVALS[severity];
    flushTimers[severity] = setTimeout(() => {
      flushTimers[severity] = null;
      flushBuffer(severity).catch(err => {
        logger.error(`Failed to flush ${severity} log alerts`, { error: String(err) });
      });
    }, interval);
  }
}

export async function flushBuffer(severity: string): Promise<void> {
  const entries = buffers[severity].splice(0);
  if (entries.length === 0) return;

  const payload = buildAlertPayload(severity, entries);

  try {
    await sendLogAlertToOpenClaw(payload);
    logger.info(`Sent ${entries.length} ${severity} log alerts to OpenClaw`);
  } catch (err) {
    // Re-add entries for retry, up to 3 times each
    const retryable = entries.filter(e => ((e as any)._retries ?? 0) < 3);
    for (const e of retryable) (e as any)._retries = ((e as any)._retries ?? 0) + 1;
    buffers[severity].unshift(...retryable);
    logger.error('Failed to send log alerts to OpenClaw', { error: String(err), count: entries.length });
  }
}

export function buildAlertPayload(severity: string, entries: LogAlertEntry[]): AlertPayload {
  return {
    type: 'log_alert',
    severity,
    logs: entries,
    sentAt: new Date().toISOString(),
  };
}

async function sendLogAlertToOpenClaw(payload: AlertPayload): Promise<void> {
  // Dynamic import to avoid circular dependencies
  const { getOpenClawConfig, sendToOpenClawGateway } = await import('./openclaw-service');
  const config = getOpenClawConfig();
  if (!config.agentId || !config.apiKey) {
    throw new Error('OpenClaw not configured for log push');
  }

  const message = `[DeadStockSolution Log Alert] ${payload.severity.toUpperCase()}: ${payload.logs.length}件のログ\n\n` +
    payload.logs.map(l => `- [${l.errorCode ?? 'N/A'}] ${l.message} (${l.occurredAt})`).join('\n');

  await sendToOpenClawGateway({
    agentId: config.agentId,
    message,
    metadata: payload,
  });
}

export function getBufferSize(severity: string): number {
  return buffers[severity]?.length ?? 0;
}

export function clearBuffer(): void {
  buffers.critical = [];
  buffers.error = [];
  buffers.warning = [];
  for (const key of Object.keys(flushTimers)) {
    if (flushTimers[key]) clearTimeout(flushTimers[key]!);
    flushTimers[key] = null;
  }
}

function isEnabled(): boolean {
  return process.env.OPENCLAW_LOG_PUSH_ENABLED === 'true';
}
