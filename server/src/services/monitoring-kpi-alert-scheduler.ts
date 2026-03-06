import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseBooleanFlag, parseBoundedInt } from '../utils/number-utils';
import { getMonitoringKpiSnapshot, MonitoringKpiSnapshot } from './monitoring-kpi-service';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

const DEFAULT_INTERVAL_MINUTES = 10;
const DEFAULT_WINDOW_MINUTES = 60;
const DEFAULT_COOLDOWN_MINUTES = 30;
const DEFAULT_OPENCLAW_CLI_PATH = 'openclaw';
const DEFAULT_ALERT_CHANNEL = 'telegram';
const DEFAULT_ALERT_TARGET = '';
const SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'SCHEDULER_OPTIMIZED_LOOP_ENABLED';
const MONITORING_SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'MONITORING_KPI_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED';

interface MonitoringKpiAlertConfig {
  enabled: boolean;
  intervalMinutes: number;
  windowMinutes: number;
  cooldownMinutes: number;
  openclawCliPath: string;
  alertChannel: string;
  alertTarget: string;
}

export interface MonitoringKpiAlertCheckResult {
  status: 'disabled' | 'healthy' | 'cooldown' | 'alerted' | 'failed';
  notified: boolean;
  snapshot: MonitoringKpiSnapshot | null;
}

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerActive = false;
let checkRunning = false;
let lastAlertAtMs = 0;
let lastAlertFingerprint = '';

function buildAlertFingerprint(snapshot: MonitoringKpiSnapshot): string {
  return JSON.stringify(snapshot.breaches);
}

function isOptimizedLoopEnabledForMonitoringScheduler(): boolean {
  const localFlag = process.env[MONITORING_SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV];
  if (typeof localFlag === 'string' && localFlag.trim().length > 0) {
    return parseBooleanFlag(localFlag, true);
  }
  return parseBooleanFlag(process.env[SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV], true);
}

function readConfig(): MonitoringKpiAlertConfig {
  return {
    enabled: process.env.MONITORING_KPI_ALERT_ENABLED === 'true',
    intervalMinutes: parseBoundedInt(
      process.env.MONITORING_KPI_ALERT_INTERVAL_MINUTES,
      DEFAULT_INTERVAL_MINUTES,
      1,
      24 * 60,
    ),
    windowMinutes: parseBoundedInt(
      process.env.MONITORING_KPI_ALERT_WINDOW_MINUTES,
      DEFAULT_WINDOW_MINUTES,
      5,
      24 * 60,
    ),
    cooldownMinutes: parseBoundedInt(
      process.env.MONITORING_KPI_ALERT_COOLDOWN_MINUTES,
      DEFAULT_COOLDOWN_MINUTES,
      1,
      24 * 7,
    ),
    openclawCliPath: (process.env.MONITORING_KPI_ALERT_OPENCLAW_CLI_PATH ?? DEFAULT_OPENCLAW_CLI_PATH).trim() || DEFAULT_OPENCLAW_CLI_PATH,
    alertChannel: (process.env.MONITORING_KPI_ALERT_CHANNEL ?? DEFAULT_ALERT_CHANNEL).trim() || DEFAULT_ALERT_CHANNEL,
    alertTarget: (process.env.MONITORING_KPI_ALERT_TARGET ?? DEFAULT_ALERT_TARGET).trim() || DEFAULT_ALERT_TARGET,
  };
}

function shouldNotify(config: MonitoringKpiAlertConfig, snapshot: MonitoringKpiSnapshot, nowMs: number): boolean {
  if (snapshot.status !== 'warning') return false;

  const fingerprint = buildAlertFingerprint(snapshot);
  const cooldownMs = config.cooldownMinutes * 60 * 1000;
  const cooldownActive = nowMs - lastAlertAtMs < cooldownMs;
  if (cooldownActive && lastAlertFingerprint === fingerprint) {
    return false;
  }
  return true;
}

function buildAlertMessage(snapshot: MonitoringKpiSnapshot): string {
  const reasons: string[] = [];
  if (snapshot.breaches.errorRate5xx) {
    reasons.push(`5xx率 ${snapshot.metrics.errorRate5xx}% (閾値 ${snapshot.thresholds.errorRate5xx}%)`);
  }
  if (snapshot.breaches.uploadFailureRate) {
    reasons.push(`取込失敗率 ${snapshot.metrics.uploadFailureRate}% (閾値 ${snapshot.thresholds.uploadFailureRate}%)`);
  }
  if (snapshot.breaches.pendingStaleCount) {
    reasons.push(`滞留ジョブ ${snapshot.metrics.pendingUploadStaleCount}件 (閾値 ${snapshot.thresholds.pendingStaleCount}件)`);
  }

  const reasonText = reasons.length > 0 ? reasons.join(' / ') : '異常指標は検出されました';
  return [
    '⚠️ DeadStockSolution 監視アラート',
    reasonText,
    `ウィンドウ: ${snapshot.context.windowMinutes}分`,
    '対応: /admin ダッシュボードの運用KPIを確認',
  ].join('\n');
}

function buildMonitoringAlertEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
  };
}

async function sendAlertMessage(config: MonitoringKpiAlertConfig, snapshot: MonitoringKpiSnapshot): Promise<boolean> {
  try {
    const message = buildAlertMessage(snapshot);
    await execFileAsync(config.openclawCliPath, [
      'message',
      'send',
      '--channel',
      config.alertChannel,
      '--target',
      config.alertTarget,
      '--message',
      message,
    ], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      env: buildMonitoringAlertEnv(),
    });
    return true;
  } catch (err) {
    logger.error('Monitoring KPI alert: failed to send alert message', {
      error: err instanceof Error ? err.message : String(err),
      channel: config.alertChannel,
      target: config.alertTarget,
    });
    return false;
  }
}

export async function runMonitoringKpiAlertCheck(): Promise<MonitoringKpiAlertCheckResult> {
  const config = readConfig();
  if (!config.enabled) {
    return { status: 'disabled', notified: false, snapshot: null };
  }

  try {
    const snapshot = await getMonitoringKpiSnapshot(config.windowMinutes);
    const nowMs = Date.now();

    if (snapshot.status !== 'warning') {
      return { status: 'healthy', notified: false, snapshot };
    }

    if (!shouldNotify(config, snapshot, nowMs)) {
      return { status: 'cooldown', notified: false, snapshot };
    }

    const notified = await sendAlertMessage(config, snapshot);
    if (notified) {
      lastAlertAtMs = nowMs;
      lastAlertFingerprint = buildAlertFingerprint(snapshot);
      logger.warn('Monitoring KPI alert triggered', {
        status: snapshot.status,
        metrics: snapshot.metrics,
      });
      return { status: 'alerted', notified: true, snapshot };
    }

    return { status: 'failed', notified: false, snapshot };
  } catch (err) {
    logger.error('Monitoring KPI alert check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 'failed', notified: false, snapshot: null };
  }
}

async function runScheduledCheck(): Promise<void> {
  if (checkRunning) {
    logger.info('Monitoring KPI alert: previous check still running, skipping');
    return;
  }

  checkRunning = true;
  try {
    await runMonitoringKpiAlertCheck();
  } finally {
    checkRunning = false;
  }
}

function scheduleWithTimeoutThenInterval(intervalMs: number): void {
  if (!schedulerActive) return;

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
    void runScheduledCheck();
  }, 1500);
  schedulerTimer.unref();

  schedulerInterval = setInterval(() => {
    if (!schedulerActive) return;
    void runScheduledCheck();
  }, intervalMs);
  schedulerInterval.unref();
}

function scheduleWithImmediateLoop(intervalMs: number): void {
  if (!schedulerActive) return;

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
    if (!schedulerActive) return;
    void runScheduledCheck();
  }, 1500);
  schedulerTimer.unref();

  schedulerInterval = setInterval(() => {
    if (!schedulerActive) return;
    void runScheduledCheck();
  }, intervalMs);
  schedulerInterval.unref();
}

export function startMonitoringKpiAlertScheduler(): void {
  const config = readConfig();
  if (!config.enabled) {
    logger.info('Monitoring KPI alert: disabled (set MONITORING_KPI_ALERT_ENABLED=true to enable)');
    return;
  }

  if (!config.alertTarget) {
    logger.warn('Monitoring KPI alert: MONITORING_KPI_ALERT_TARGET is empty; scheduler will not start');
    return;
  }

  if (schedulerActive) {
    logger.warn('Monitoring KPI alert: scheduler already running');
    return;
  }

  const intervalMs = config.intervalMinutes * 60 * 1000;
  schedulerActive = true;
  logger.info('Monitoring KPI alert: starting scheduler', {
    intervalMinutes: config.intervalMinutes,
    windowMinutes: config.windowMinutes,
    cooldownMinutes: config.cooldownMinutes,
    alertChannel: config.alertChannel,
    alertTarget: config.alertTarget,
  });

  if (isOptimizedLoopEnabledForMonitoringScheduler()) {
    scheduleWithImmediateLoop(intervalMs);
  } else {
    scheduleWithTimeoutThenInterval(intervalMs);
  }
}

export function stopMonitoringKpiAlertScheduler(): void {
  const wasActive = schedulerActive || schedulerTimer !== null || schedulerInterval !== null;
  schedulerActive = false;

  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  if (wasActive) {
    logger.info('Monitoring KPI alert: scheduler stopped');
  }
}

export function resetMonitoringKpiAlertSchedulerForTests(): void {
  schedulerActive = false;
  checkRunning = false;
  lastAlertAtMs = 0;
  lastAlertFingerprint = '';

  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
