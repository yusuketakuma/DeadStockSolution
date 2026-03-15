import { logger } from './logger';

export interface LogAlertEntry {
  source: string;
  severity: 'critical' | 'error' | 'warning';
  errorCode: string | null;
  message: string;
  logId: number;
  occurredAt: string;
  detail?: unknown;
  codeLocation?: string | null;
  tenant?: {
    pharmacyId: number | null;
    pharmacyName?: string | null;
    pharmacyEmail?: string | null;
  };
  whatHappened?: string | null;
  improvementSuggestion?: string | null;
  recurrenceCount?: number;
  impactedTenantCount?: number;
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
  repeatedIssueCount?: number;
  impactedTenantCount?: number;
}

interface LogPushStats {
  enqueued: number;
  sent: number;
  failed: number;
  retried: number;
}

interface AutoEscalationDecision {
  shouldEscalate: boolean;
  reasonCodes: string[];
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

function scheduleSeverityFlush(severity: Severity): void {
  flushTimers[severity] = setTimeout(() => {
    flushTimers[severity] = null;
    flushBuffer(severity).catch(err => {
      logger.error(`Failed to flush ${severity} log alerts`, { error: String(err) });
    });
  }, FLUSH_INTERVALS[severity]);
}

function requeueRetryableEntries(severity: Severity, entries: PendingEntry[]): void {
  const retryable = entries.filter((entry) => entry._retries < 3);
  logPushStats.retried += retryable.length;
  for (const entry of retryable) {
    entry._retries += 1;
  }
  buffers[severity].unshift(...retryable);
  if (buffers[severity].length > MAX_BUFFER_SIZE) {
    buffers[severity].length = MAX_BUFFER_SIZE;
  }
}

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
    scheduleSeverityFlush(severity);
  }
}

function isAutoEscalationEnabled(): boolean {
  return process.env.OPENCLAW_AUTO_ESCALATE_ENABLED === 'true';
}

function getAutoEscalationThresholds(): { recurrence: number; impactedTenants: number } {
  const recurrence = Number(process.env.OPENCLAW_AUTO_ESCALATE_RECURRENCE_THRESHOLD ?? 3);
  const impactedTenants = Number(process.env.OPENCLAW_AUTO_ESCALATE_TENANT_THRESHOLD ?? 2);
  return {
    recurrence: Number.isFinite(recurrence) && recurrence > 0 ? recurrence : 3,
    impactedTenants: Number.isFinite(impactedTenants) && impactedTenants > 0 ? impactedTenants : 2,
  };
}

export function evaluateAutoEscalation(entry: LogAlertEntry): AutoEscalationDecision {
  if (!isAutoEscalationEnabled()) {
    return { shouldEscalate: false, reasonCodes: [] };
  }

  const thresholds = getAutoEscalationThresholds();
  const reasonCodes: string[] = [];

  if (entry.severity === 'critical') {
    reasonCodes.push('critical_severity');
  }
  if ((entry.recurrenceCount ?? 0) >= thresholds.recurrence) {
    reasonCodes.push('recurrence_threshold');
  }
  if ((entry.impactedTenantCount ?? 0) >= thresholds.impactedTenants) {
    reasonCodes.push('tenant_impact_threshold');
  }

  return {
    shouldEscalate: reasonCodes.length > 0,
    reasonCodes,
  };
}

export async function dispatchLogAlert(entry: LogAlertEntry): Promise<{
  mode: 'disabled' | 'enqueued' | 'auto_escalated';
  reasonCodes: string[];
}> {
  const autoDecision = evaluateAutoEscalation(entry);
  if (autoDecision.shouldEscalate) {
    await escalateLogAlertToOpenClaw(
      entry,
      `[Auto escalation]\n${autoDecision.reasonCodes.join(', ')}`,
    );
    return {
      mode: 'auto_escalated',
      reasonCodes: autoDecision.reasonCodes,
    };
  }

  if (!isEnabled()) {
    return {
      mode: 'disabled',
      reasonCodes: [],
    };
  }

  enqueueLogAlert(entry);
  return {
    mode: 'enqueued',
    reasonCodes: [],
  };
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
    requeueRetryableEntries(severity, entries);
    logger.error('Failed to send log alerts to OpenClaw', { error: String(err), count: entries.length });
  }
}

export function buildAlertPayload(severity: Severity, entries: LogAlertEntry[]): AlertPayload {
  const repeatedIssueCount = entries.filter((entry) => (entry.recurrenceCount ?? 0) > 1).length;
  const impactedTenantCount = new Set(
    entries
      .map((entry) => entry.tenant?.pharmacyId)
      .filter((value): value is number => value != null),
  ).size;
  return {
    type: 'log_alert',
    severity,
    logs: entries,
    sentAt: new Date().toISOString(),
    repeatedIssueCount,
    impactedTenantCount,
  };
}

export function buildOpenClawLogAlertMessage(payload: AlertPayload): string {
  const header = `[DeadStockSolution Log Alert] ${payload.severity.toUpperCase()} ${payload.logs.length}件`;
  const summary = [
    payload.repeatedIssueCount ? `再発中の論点: ${payload.repeatedIssueCount}件` : null,
    payload.impactedTenantCount ? `影響テナント数: ${payload.impactedTenantCount}` : null,
  ].filter(Boolean).join(' / ');

  const lines = payload.logs.map((entry) => {
    const tenantLabel = entry.tenant?.pharmacyName
      ?? (entry.tenant?.pharmacyId != null ? `薬局 #${entry.tenant.pharmacyId}` : null)
      ?? entry.tenant?.pharmacyEmail
      ?? 'テナント不明';
    return [
      `- [${entry.errorCode ?? 'N/A'}] ${entry.whatHappened ?? entry.message}`,
      `  source=${entry.source} logId=${entry.logId} at=${entry.occurredAt}`,
      `  tenant=${tenantLabel}`,
      entry.codeLocation ? `  code=${entry.codeLocation}` : null,
      entry.improvementSuggestion ? `  fix=${entry.improvementSuggestion}` : null,
      entry.recurrenceCount ? `  recurrence=${entry.recurrenceCount}` : null,
    ].filter(Boolean).join('\n');
  });

  return [header, summary, '', ...lines].filter(Boolean).join('\n');
}

export async function escalateLogAlertToOpenClaw(entry: LogAlertEntry, note?: string): Promise<void> {
  const payload: AlertPayload = {
    type: 'log_alert',
    severity: entry.severity,
    logs: [entry],
    sentAt: new Date().toISOString(),
    repeatedIssueCount: entry.recurrenceCount && entry.recurrenceCount > 1 ? 1 : 0,
    impactedTenantCount: entry.impactedTenantCount ?? (entry.tenant?.pharmacyId != null ? 1 : 0),
  };
  const message = [
    buildOpenClawLogAlertMessage(payload),
    note ? `\n[Operator note]\n${note}` : null,
  ].filter(Boolean).join('\n');
  await sendLogAlertToOpenClaw(payload, message);
}

async function sendLogAlertToOpenClaw(payload: AlertPayload, messageOverride?: string): Promise<void> {
  // Dynamic import to avoid circular dependencies
  const { getOpenClawConfig, sendToOpenClawGateway } = await import('./openclaw-service');
  const config = getOpenClawConfig();
  const connectorConfigured = config.mode === 'gateway_cli'
    ? Boolean(config.cliPath && config.agentId)
    : Boolean(config.baseUrl && config.apiKey && config.agentId);

  if (!connectorConfigured) {
    throw new Error('OpenClaw not configured for log push');
  }

  const message = messageOverride ?? buildOpenClawLogAlertMessage(payload);

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
