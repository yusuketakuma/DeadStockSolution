import { and, desc, gte, inArray, like, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { activityLogs } from '../db/schema';
import { rowCount } from '../utils/db-utils';
import { parseBooleanFlag, parseBoundedInt } from '../utils/number-utils';
import { logger } from './logger';
import { handoffImportFailureAlertToOpenClaw } from './openclaw-auto-handoff-service';

type WebhookUrlError = 'invalid' | 'insecure';

const DEFAULT_MONITORED_ACTIONS = ['upload', 'drug_master_sync', 'drug_master_package_upload'] as const;
const DEFAULT_INTERVAL_MINUTES = 5;
const DEFAULT_WINDOW_MINUTES = 30;
const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MINUTES = 60;
const DEFAULT_WEBHOOK_TIMEOUT_MS = 10000;
const SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'SCHEDULER_OPTIMIZED_LOOP_ENABLED';
const IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED';

export interface ImportFailureAlertConfig {
  enabled: boolean;
  intervalMinutes: number;
  windowMinutes: number;
  threshold: number;
  cooldownMinutes: number;
  monitoredActions: string[];
  webhookUrl: string;
  webhookUrlError: WebhookUrlError | null;
  webhookToken: string;
  webhookTimeoutMs: number;
}

interface ImportFailureReasonCount {
  reason: string;
  count: number;
}

interface ImportFailureActionCount {
  action: string;
  count: number;
}

interface ImportFailureAlertPayload {
  event: 'import_failure_alert';
  detectedAt: string;
  windowMinutes: number;
  threshold: number;
  totalFailures: number;
  monitoredActions: string[];
  latestFailureAt: string | null;
  failureByAction: ImportFailureActionCount[];
  failureByReason: ImportFailureReasonCount[];
}

export interface ImportFailureAlertCheckResult {
  status: 'disabled' | 'below_threshold' | 'cooldown' | 'alerted';
  totalFailures: number;
  threshold: number;
  webhookDelivered: boolean;
}

interface ImportFailureSummary {
  totalFailures: number;
  latestFailureAt: string | null;
  failureByAction: ImportFailureActionCount[];
  failureByReason: ImportFailureReasonCount[];
}

type ActivityLogWhereClause = ReturnType<typeof and>;

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerActive = false;
let isRunning = false;
let lastAlertAtMs = 0;
let lastAlertFailureTotal: number | null = null;

function isLocalhostHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function normalizeWebhookUrl(webhookUrlRaw: string): { value: string; error: WebhookUrlError | null } {
  const trimmed = webhookUrlRaw.trim();
  if (!trimmed) {
    return { value: '', error: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { value: '', error: 'invalid' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'https:' || (protocol === 'http:' && isLocalhostHost(parsed.hostname))) {
    parsed.search = '';
    parsed.hash = '';
    return { value: parsed.toString(), error: null };
  }

  return { value: '', error: 'insecure' };
}

function parseMonitoredActions(raw: string | undefined): string[] {
  const source = typeof raw === 'string' && raw.trim().length > 0
    ? raw
    : DEFAULT_MONITORED_ACTIONS.join(',');

  const values = source
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return [...new Set(values)];
}

function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isOptimizedLoopEnabledForImportFailureAlertScheduler(): boolean {
  const localFlag = process.env[IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV];
  if (typeof localFlag === 'string' && localFlag.trim().length > 0) {
    return parseBooleanFlag(localFlag, true);
  }
  return parseBooleanFlag(process.env[SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV], true);
}

function buildFailureWhereClause(windowStartIso: string, monitoredActions: string[]): ActivityLogWhereClause {
  return and(
    gte(activityLogs.createdAt, windowStartIso),
    like(activityLogs.detail, '失敗|%'),
    inArray(activityLogs.action, monitoredActions),
  );
}

async function fetchFailureTotal(whereClause: ActivityLogWhereClause): Promise<number> {
  const [failureTotalRow] = await db.select({ count: rowCount })
    .from(activityLogs)
    .where(whereClause);
  return failureTotalRow?.count ?? 0;
}

async function fetchFailureSummary(
  whereClause: ActivityLogWhereClause,
  totalFailures: number,
): Promise<ImportFailureSummary> {
  const failureByActionRows = await db.select({
    action: activityLogs.action,
    count: rowCount,
  })
    .from(activityLogs)
    .where(whereClause)
    .groupBy(activityLogs.action);

  const failureReasonExpr = sql<string>`coalesce(substring(${activityLogs.detail} from 'reason=([^|]+)'), 'unknown')`;
  const failureByReasonRows = await db.select({
    reason: failureReasonExpr,
    count: rowCount,
  })
    .from(activityLogs)
    .where(whereClause)
    .groupBy(failureReasonExpr)
    .orderBy(sql`count(*)::int desc`)
    .limit(10);

  const [latestFailure] = await db.select({
    createdAt: activityLogs.createdAt,
  })
    .from(activityLogs)
    .where(whereClause)
    .orderBy(desc(activityLogs.createdAt))
    .limit(1);

  return {
    totalFailures,
    latestFailureAt: latestFailure?.createdAt ?? null,
    failureByAction: failureByActionRows.map((row) => ({
      action: row.action,
      count: row.count,
    })),
    failureByReason: failureByReasonRows.map((row) => ({
      reason: row.reason,
      count: row.count,
    })),
  };
}

function buildAlertPayload(
  config: ImportFailureAlertConfig,
  now: Date,
  summary: ImportFailureSummary,
): ImportFailureAlertPayload {
  return {
    event: 'import_failure_alert',
    detectedAt: now.toISOString(),
    windowMinutes: config.windowMinutes,
    threshold: config.threshold,
    totalFailures: summary.totalFailures,
    monitoredActions: config.monitoredActions,
    latestFailureAt: summary.latestFailureAt,
    failureByAction: summary.failureByAction,
    failureByReason: summary.failureByReason,
  };
}

export function getImportFailureAlertConfig(): ImportFailureAlertConfig {
  const normalizedWebhookUrl = normalizeWebhookUrl(process.env.IMPORT_FAILURE_ALERT_WEBHOOK_URL ?? '');
  return {
    enabled: process.env.IMPORT_FAILURE_ALERT_ENABLED === 'true',
    intervalMinutes: parseBoundedInt(process.env.IMPORT_FAILURE_ALERT_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES, 1, 24 * 60),
    windowMinutes: parseBoundedInt(process.env.IMPORT_FAILURE_ALERT_WINDOW_MINUTES, DEFAULT_WINDOW_MINUTES, 1, 24 * 7),
    threshold: parseBoundedInt(process.env.IMPORT_FAILURE_ALERT_THRESHOLD, DEFAULT_FAILURE_THRESHOLD, 1, 10000),
    cooldownMinutes: parseBoundedInt(process.env.IMPORT_FAILURE_ALERT_COOLDOWN_MINUTES, DEFAULT_COOLDOWN_MINUTES, 1, 24 * 7),
    monitoredActions: parseMonitoredActions(process.env.IMPORT_FAILURE_ALERT_ACTIONS),
    webhookUrl: normalizedWebhookUrl.value,
    webhookUrlError: normalizedWebhookUrl.error,
    webhookToken: (process.env.IMPORT_FAILURE_ALERT_WEBHOOK_TOKEN ?? '').trim(),
    webhookTimeoutMs: parseBoundedInt(process.env.IMPORT_FAILURE_ALERT_WEBHOOK_TIMEOUT_MS, DEFAULT_WEBHOOK_TIMEOUT_MS, 1000, 120000),
  };
}

async function sendAlertWebhook(
  config: ImportFailureAlertConfig,
  payload: ImportFailureAlertPayload,
): Promise<boolean> {
  if (!config.webhookUrl || config.webhookUrlError) {
    return false;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.webhookToken) {
    headers.Authorization = `Bearer ${config.webhookToken}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.webhookTimeoutMs);

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error('Import failure alert: webhook request failed', {
        status: response.status,
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('Import failure alert: webhook request error', {
      error: formatErrorMessage(err),
    });
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runImportFailureAlertCheck(
  config: ImportFailureAlertConfig = getImportFailureAlertConfig(),
  now: Date = new Date(),
): Promise<ImportFailureAlertCheckResult> {
  if (!config.enabled || config.monitoredActions.length === 0) {
    return {
      status: 'disabled',
      totalFailures: 0,
      threshold: config.threshold,
      webhookDelivered: false,
    };
  }

  const nowMs = now.getTime();
  const cooldownMs = config.cooldownMinutes * 60_000;
  if (lastAlertAtMs > 0 && nowMs - lastAlertAtMs < cooldownMs && lastAlertFailureTotal !== null) {
    return {
      status: 'cooldown',
      totalFailures: lastAlertFailureTotal,
      threshold: config.threshold,
      webhookDelivered: false,
    };
  }

  const windowStartIso = new Date(now.getTime() - config.windowMinutes * 60_000).toISOString();
  const whereClause = buildFailureWhereClause(windowStartIso, config.monitoredActions);
  const failureTotal = await fetchFailureTotal(whereClause);
  if (failureTotal < config.threshold) {
    return {
      status: 'below_threshold',
      totalFailures: failureTotal,
      threshold: config.threshold,
      webhookDelivered: false,
    };
  }

  if (lastAlertAtMs > 0 && nowMs - lastAlertAtMs < cooldownMs) {
    return {
      status: 'cooldown',
      totalFailures: failureTotal,
      threshold: config.threshold,
      webhookDelivered: false,
    };
  }

  const summary = await fetchFailureSummary(whereClause, failureTotal);
  const payload = buildAlertPayload(config, now, summary);

  lastAlertAtMs = nowMs;
  lastAlertFailureTotal = summary.totalFailures;
  const webhookDelivered = await sendAlertWebhook(config, payload);
  const autoHandoff = await handoffImportFailureAlertToOpenClaw(payload);

  logger.warn('Import failure alert: threshold exceeded', {
    totalFailures: failureTotal,
    threshold: config.threshold,
    windowMinutes: config.windowMinutes,
    cooldownMinutes: config.cooldownMinutes,
    webhookDelivered,
    webhookConfigured: Boolean(config.webhookUrl && !config.webhookUrlError),
    openclawAutoHandoffTriggered: autoHandoff.triggered,
    openclawAutoHandoffAccepted: autoHandoff.accepted,
    openclawAutoHandoffRequestId: autoHandoff.requestId,
  });

  return {
    status: 'alerted',
    totalFailures: summary.totalFailures,
    threshold: config.threshold,
    webhookDelivered,
  };
}

async function runScheduledCheck(): Promise<void> {
  if (isRunning) {
    logger.info('Import failure alert: previous check still running, skipping');
    return;
  }

  isRunning = true;
  const config = getImportFailureAlertConfig();
  try {
    await runImportFailureAlertCheck(config);
  } catch (err) {
    logger.error('Import failure alert: scheduled check failed', {
      error: formatErrorMessage(err),
    });
  } finally {
    isRunning = false;
  }
}

function scheduleNextImportFailureAlertCheck(intervalMs: number, delayMs: number): void {
  if (!schedulerActive) {
    return;
  }

  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }

  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;
    void runScheduledCheck().finally(() => {
      if (!schedulerActive) {
        return;
      }
      scheduleNextImportFailureAlertCheck(intervalMs, intervalMs);
    });
  }, delayMs);

  schedulerTimer.unref();
}

function startLegacyImportFailureAlertIntervalScheduler(intervalMs: number): void {
  if (!schedulerActive) {
    return;
  }

  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;
    if (!schedulerActive) {
      return;
    }
    void runScheduledCheck();
  }, Math.min(60_000, intervalMs));
  schedulerTimer.unref();

  schedulerInterval = setInterval(() => {
    if (!schedulerActive) {
      return;
    }
    void runScheduledCheck();
  }, intervalMs);
  schedulerInterval.unref();
}

function clearImportFailureAlertSchedulerHandles(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

export function startImportFailureAlertScheduler(): void {
  const config = getImportFailureAlertConfig();
  if (!config.enabled) {
    logger.info('Import failure alert: disabled (set IMPORT_FAILURE_ALERT_ENABLED=true to enable)');
    return;
  }

  if (config.monitoredActions.length === 0) {
    logger.warn('Import failure alert: no actions configured; scheduler will not start');
    return;
  }

  if (schedulerActive) {
    logger.warn('Import failure alert: scheduler already running');
    return;
  }

  if (config.webhookUrlError) {
    logger.warn('Import failure alert: webhook URL is invalid; alert is log-only mode', {
      reason: config.webhookUrlError,
    });
  }

  const optimizedLoopEnabled = isOptimizedLoopEnabledForImportFailureAlertScheduler();

  logger.info('Import failure alert: starting scheduler', {
    intervalMinutes: config.intervalMinutes,
    windowMinutes: config.windowMinutes,
    threshold: config.threshold,
    cooldownMinutes: config.cooldownMinutes,
    monitoredActions: config.monitoredActions,
    webhookConfigured: Boolean(config.webhookUrl && !config.webhookUrlError),
    loopMode: optimizedLoopEnabled ? 'timeout-chain' : 'legacy-interval',
  });

  const intervalMs = config.intervalMinutes * 60_000;
  schedulerActive = true;
  if (optimizedLoopEnabled) {
    scheduleNextImportFailureAlertCheck(intervalMs, Math.min(60_000, intervalMs));
    return;
  }
  startLegacyImportFailureAlertIntervalScheduler(intervalMs);
}

export function stopImportFailureAlertScheduler(): void {
  const wasActive = schedulerActive || schedulerTimer !== null || schedulerInterval !== null;
  schedulerActive = false;
  clearImportFailureAlertSchedulerHandles();
  if (wasActive) {
    logger.info('Import failure alert: scheduler stopped');
  }
}

export function resetImportFailureAlertStateForTests(): void {
  schedulerActive = false;
  clearImportFailureAlertSchedulerHandles();
  lastAlertAtMs = 0;
  lastAlertFailureTotal = null;
  isRunning = false;
}
