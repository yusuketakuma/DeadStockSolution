import { and, desc, gte, inArray, like, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { events } from '../db/schema';
import { rowCount } from '../utils/db-utils';
import { parseBooleanFlag, parseBoundedInt } from '../utils/number-utils';
import { normalizeHttpsOrLoopbackHttpUrl } from '../utils/url-config';
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

function normalizeWebhookUrl(webhookUrlRaw: string): { value: string; error: WebhookUrlError | null } {
  const normalized = normalizeHttpsOrLoopbackHttpUrl(webhookUrlRaw, { allowEmpty: true });
  return {
    value: normalized.value,
    error: normalized.error === 'missing' ? null : normalized.error,
  };
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

function buildCheckResult(
  status: ImportFailureAlertCheckResult['status'],
  threshold: number,
  totalFailures: number,
  webhookDelivered: boolean = false,
): ImportFailureAlertCheckResult {
  return { status, totalFailures, threshold, webhookDelivered };
}

function resolveCooldownResult(
  nowMs: number,
  cooldownMs: number,
  threshold: number,
  totalFailures: number,
): ImportFailureAlertCheckResult | null {
  if (lastAlertAtMs <= 0 || nowMs - lastAlertAtMs >= cooldownMs) {
    return null;
  }
  return buildCheckResult('cooldown', threshold, totalFailures);
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
    gte(events.createdAt, windowStartIso),
    like(events.detail, '失敗|%'),
    inArray(events.action, monitoredActions),
  );
}

async function fetchFailureTotal(whereClause: ActivityLogWhereClause): Promise<number> {
  const [failureTotalRow] = await db.select({ count: rowCount })
    .from(events)
    .where(whereClause);
  return failureTotalRow?.count ?? 0;
}

async function fetchFailureSummary(
  whereClause: ActivityLogWhereClause,
  totalFailures: number,
): Promise<ImportFailureSummary> {
  const failureByActionRows = await db.select({
    action: events.action,
    count: rowCount,
  })
    .from(events)
    .where(whereClause)
    .groupBy(events.action);

  const failureReasonExpr = sql<string>`coalesce(substring(${events.detail} from 'reason=([^|]+)'), 'unknown')`;
  const failureByReasonRows = await db.select({
    reason: failureReasonExpr,
    count: rowCount,
  })
    .from(events)
    .where(whereClause)
    .groupBy(failureReasonExpr)
    .orderBy(sql`count(*)::int desc`)
    .limit(10);

  const [latestFailure] = await db.select({
    createdAt: events.createdAt,
  })
    .from(events)
    .where(whereClause)
    .orderBy(desc(events.createdAt))
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

function buildAlertWebhookHeaders(config: ImportFailureAlertConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.webhookToken) {
    headers.Authorization = `Bearer ${config.webhookToken}`;
  }
  return headers;
}

async function sendAlertWebhook(
  config: ImportFailureAlertConfig,
  payload: ImportFailureAlertPayload,
): Promise<boolean> {
  if (!config.webhookUrl || config.webhookUrlError) {
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.webhookTimeoutMs);

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: buildAlertWebhookHeaders(config),
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
    return buildCheckResult('disabled', config.threshold, 0);
  }

  const nowMs = now.getTime();
  const cooldownMs = config.cooldownMinutes * 60_000;
  if (lastAlertFailureTotal !== null) {
    const preThresholdCooldown = resolveCooldownResult(nowMs, cooldownMs, config.threshold, lastAlertFailureTotal);
    if (preThresholdCooldown) {
      return preThresholdCooldown;
    }
  }

  const windowStartIso = new Date(now.getTime() - config.windowMinutes * 60_000).toISOString();
  const whereClause = buildFailureWhereClause(windowStartIso, config.monitoredActions);
  const failureTotal = await fetchFailureTotal(whereClause);
  if (failureTotal < config.threshold) {
    return buildCheckResult('below_threshold', config.threshold, failureTotal);
  }

  const postThresholdCooldown = resolveCooldownResult(nowMs, cooldownMs, config.threshold, failureTotal);
  if (postThresholdCooldown) {
    return postThresholdCooldown;
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

  return buildCheckResult('alerted', config.threshold, summary.totalFailures, webhookDelivered);
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

function getInitialImportFailureAlertDelay(intervalMs: number): number {
  return Math.min(60_000, intervalMs);
}

function scheduleNextImportFailureAlertCheck(intervalMs: number, delayMs: number): void {
  if (!schedulerActive) {
    return;
  }

  clearImportFailureAlertSchedulerHandles();

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

  clearImportFailureAlertSchedulerHandles();

  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;
    if (!schedulerActive) {
      return;
    }
    void runScheduledCheck();
  }, getInitialImportFailureAlertDelay(intervalMs));
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
    scheduleNextImportFailureAlertCheck(intervalMs, getInitialImportFailureAlertDelay(intervalMs));
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
