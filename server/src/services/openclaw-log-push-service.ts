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

type Severity = LogAlertEntry['severity'];

/** Internal wrapper with retry tracking */
interface PendingEntry extends LogAlertEntry {
  _retries: number;
}

interface AlertPayload {
  type: 'log_alert';
  severity: string;
  logs: LogAlertEntry[];
  sentAt: string;
}

interface LogPushStats {
  enqueued: number;
  sent: number;
  failed: number;
  retried: number;
}

// In-memory buffers by severity (typed keys)
const buffers: Record<Severity, PendingEntry[]> = {
  critical: [],
  error: [],
  warning: [],
};

const MAX_BUFFER_SIZE = 500;

// Resolve flush intervals once at module init
function resolveInterval(severity: Severity, defaultMs: number): number {
  const envKey = `OPENCLAW_LOG_PUSH_${severity.toUpperCase()}_BUFFER_MS`;
  return Number(process.env[envKey]) || defaultMs;
}

const FLUSH_INTERVALS: Record<Severity, number> = {
  critical: 0,
  error: resolveInterval('error', 30_000),
  warning: resolveInterval('warning', 300_000),
};

const flushTimers: Record<Severity, ReturnType<typeof setTimeout> | null> = {
  critical: null,
  error: null,
  warning: null,
};

const logPushStats: LogPushStats = {
  enqueued: 0,
  sent: 0,
  failed: 0,
  retried: 0,
};

export function enqueueLogAlert(entry: LogAlertEntry): void {
  if (!isEnabled()) return;
  logPushStats.enqueued += 1;

  const severity = entry.severity;

  // Drop oldest entries if buffer is at capacity
  if (buffers[severity].length >= MAX_BUFFER_SIZE) {
    buffers[severity].shift();
  }

  buffers[severity].push({ ...entry, _retries: 0 });

  if (severity === 'critical') {
    flushBuffer('critical').catch(err => {
      logger.error('Failed to flush critical log alerts', { error: String(err) });
    });
    return;
  }

  // Schedule flush if not already scheduled
  if (!flushTimers[severity]) {
    flushTimers[severity] = setTimeout(() => {
      flushTimers[severity] = null;
      flushBuffer(severity).catch(err => {
        logger.error(`Failed to flush ${severity} log alerts`, { error: String(err) });
      });
    }, FLUSH_INTERVALS[severity]);
  }
}

export async function flushBuffer(severity: Severity): Promise<void> {
  const entries = buffers[severity].splice(0);
  if (entries.length === 0) return;

  const payload = buildAlertPayload(severity, entries);

  try {
    await sendLogAlertToOpenClaw(payload);
    logPushStats.sent += entries.length;
    logger.info(`Sent ${entries.length} ${severity} log alerts to OpenClaw`);
  } catch (err) {
    logPushStats.failed += entries.length;
    // Re-add entries for retry, up to 3 times each
    const retryable = entries.filter(e => e._retries < 3);
    logPushStats.retried += retryable.length;
    for (const e of retryable) e._retries += 1;
    buffers[severity].unshift(...retryable);
    // Enforce cap after re-add to prevent unbounded growth
    if (buffers[severity].length > MAX_BUFFER_SIZE) {
      buffers[severity].length = MAX_BUFFER_SIZE;
    }
    logger.error('Failed to send log alerts to OpenClaw', { error: String(err), count: entries.length });
  }
}

export function buildAlertPayload(severity: Severity, entries: LogAlertEntry[]): AlertPayload {
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
  const connectorConfigured = config.mode === 'gateway_cli'
    ? Boolean(config.cliPath && config.agentId)
    : Boolean(config.baseUrl && config.apiKey && config.agentId);

  if (!connectorConfigured) {
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
  if (!(severity in buffers)) return 0;
  return buffers[severity as Severity].length;
}

export function clearBuffer(): void {
  buffers.critical = [];
  buffers.error = [];
  buffers.warning = [];
  for (const key of Object.keys(flushTimers) as Severity[]) {
    if (flushTimers[key]) clearTimeout(flushTimers[key]!);
    flushTimers[key] = null;
  }
}

export function getLogPushStats(): LogPushStats {
  return {
    enqueued: logPushStats.enqueued,
    sent: logPushStats.sent,
    failed: logPushStats.failed,
    retried: logPushStats.retried,
  };
}

function isEnabled(): boolean {
  return process.env.OPENCLAW_LOG_PUSH_ENABLED === 'true';
}
