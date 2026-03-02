import {
  parsePackageExcelData,
  parsePackageCsvData,
  parsePackageXmlData,
  parsePackageZipData,
  decodeCsvBuffer,
  syncPackageData,
  createSyncLog,
  completeSyncLog,
} from './drug-master-service';
import { parseExcelBuffer } from './upload-service';
import { logger } from './logger';
import { createPinnedDnsAgent, validateExternalHttpsUrl } from '../utils/network-utils';
import { parseBooleanFlag, parseBoundedInt } from '../utils/number-utils';
import { summarizeSourceUrl, MHLW_DEFAULT_FETCH_RETRIES, type FetchDispatcher } from '../utils/http-utils';
import { getErrorMessage } from '../middleware/error-handler';
import { sha256 } from '../utils/crypto-utils';
import { persistSourceHeaders, SOURCE_KEY_PACKAGE } from './drug-master-source-state-service';
import { checkForUpdates, downloadFile } from './mhlw-source-fetch';

const CHECK_INTERVAL_HOURS = parseBoundedInt(process.env.DRUG_PACKAGE_CHECK_INTERVAL_HOURS, 24, 1, 24 * 30);
const CHECK_INTERVAL_MS = CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
const AUTO_SYNC_ENABLED = process.env.DRUG_PACKAGE_AUTO_SYNC === 'true';
const SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'SCHEDULER_OPTIMIZED_LOOP_ENABLED';
const DRUG_PACKAGE_SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'DRUG_PACKAGE_SCHEDULER_OPTIMIZED_LOOP_ENABLED';
const FETCH_RETRIES = parseBoundedInt(process.env.DRUG_PACKAGE_FETCH_RETRIES, MHLW_DEFAULT_FETCH_RETRIES, 0, 5);

function shouldAttachSourceCredentials(requestUrl: string): boolean {
  const configuredSourceUrl = getConfiguredSourceUrl();
  if (!configuredSourceUrl) {
    return false;
  }
  try {
    const requested = new URL(requestUrl);
    const configured = new URL(configuredSourceUrl);
    return requested.origin === configured.origin && requested.pathname === configured.pathname;
  } catch {
    return false;
  }
}

function buildSourceRequestHeaders(requestUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'DeadStockSolution-DrugPackageSync/1.0',
  };
  if (!shouldAttachSourceCredentials(requestUrl)) {
    return headers;
  }
  const authorization = process.env.DRUG_PACKAGE_SOURCE_AUTHORIZATION?.trim();
  const cookie = process.env.DRUG_PACKAGE_SOURCE_COOKIE?.trim();
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerActive = false;
let isRunning = false;

function getConfiguredSourceUrl(): string {
  return process.env.DRUG_PACKAGE_SOURCE_URL?.trim() || '';
}


async function persistHeaders(
  sourceUrl: string,
  headers: {
    etag: string | null;
    lastModified: string | null;
    contentHash?: string | null;
  },
  changed: boolean,
): Promise<void> {
  await persistSourceHeaders(SOURCE_KEY_PACKAGE, sourceUrl, headers, changed);
}

function isOptimizedLoopEnabledForDrugPackageScheduler(): boolean {
  const localFlag = process.env[DRUG_PACKAGE_SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV];
  if (typeof localFlag === 'string' && localFlag.trim().length > 0) {
    return parseBooleanFlag(localFlag, true);
  }
  return parseBooleanFlag(process.env[SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV], true);
}

async function parseDownloadedPackageRows(
  sourceUrl: string,
  contentType: string | null,
  buffer: Buffer,
) {
  const isCsv = contentType?.includes('csv')
    || contentType?.includes('text/plain')
    || sourceUrl.endsWith('.csv');
  const isXml = contentType?.includes('xml') || sourceUrl.endsWith('.xml');
  const isZip = contentType?.includes('zip') || sourceUrl.endsWith('.zip');

  if (isCsv) {
    const csvContent = decodeCsvBuffer(buffer);
    return parsePackageCsvData(csvContent);
  }
  if (isXml) {
    const xmlContent = buffer.toString('utf-8');
    return parsePackageXmlData(xmlContent);
  }
  if (isZip) {
    return parsePackageZipData(buffer);
  }

  const excelRows = await parseExcelBuffer(buffer);
  return parsePackageExcelData(excelRows);
}

function runPackageAutoSyncSafely(mode: 'initial' | 'scheduled' | 'manual', sourceUrl?: string): Promise<void> {
  const task = sourceUrl ? runPackageAutoSyncWithSource(sourceUrl) : runPackageAutoSync();
  return task.catch((err) => {
    const suffix = mode === 'manual' ? 'manual trigger' : `${mode} run`;
    logger.error(`Drug package auto-sync: ${suffix} failed`, {
      error: getErrorMessage(err),
    });
  });
}

async function runPackageAutoSync(): Promise<void> {
  await runPackageAutoSyncWithSource(getConfiguredSourceUrl());
}

async function runPackageAutoSyncWithSource(sourceUrl: string): Promise<void> {
  if (isRunning) {
    logger.info('Drug package auto-sync: already running, skipping');
    return;
  }

  if (!sourceUrl) {
    logger.warn('Drug package auto-sync: DRUG_PACKAGE_SOURCE_URL is not configured');
    return;
  }

  isRunning = true;
  let pinnedAgent: { close: () => Promise<void> } | null = null;

  try {
    const validated = await validateExternalHttpsUrl(sourceUrl);
    if (!validated.ok) {
      logger.error('Drug package auto-sync: source URL is invalid', {
        source: summarizeSourceUrl(sourceUrl),
        reason: validated.reason,
      });
      return;
    }

    pinnedAgent = createPinnedDnsAgent(
      validated.hostname ?? new URL(sourceUrl).hostname,
      validated.resolvedAddresses,
    );
    const pinnedDispatcher = pinnedAgent as unknown as FetchDispatcher;

    logger.info('Drug package auto-sync: checking for updates', { source: summarizeSourceUrl(sourceUrl) });
    const fetchOpts = { sourceKey: SOURCE_KEY_PACKAGE, retries: FETCH_RETRIES, headers: buildSourceRequestHeaders(sourceUrl) };
    const updateCheck = await checkForUpdates(sourceUrl, pinnedDispatcher, fetchOpts);

    if (!updateCheck.hasUpdate) {
      logger.info('Drug package auto-sync: no updates detected');
      await persistHeaders(sourceUrl, updateCheck, false);
      return;
    }

    logger.info('Drug package auto-sync: update detected, downloading file');
    const { buffer, contentType } = await downloadFile(sourceUrl, pinnedDispatcher, fetchOpts);
    const contentHash = sha256(buffer);

    if (
      updateCheck.compareByContentHash
      && updateCheck.previousContentHash
      && updateCheck.previousContentHash === contentHash
    ) {
      logger.info('Drug package auto-sync: no updates detected by content-hash fallback');
      await persistHeaders(sourceUrl, { ...updateCheck, contentHash }, false);
      return;
    }

    const syncLog = await createSyncLog('package_auto', `包装単位自動取得: ${summarizeSourceUrl(sourceUrl)}`, null);
    const emptyResult = { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 };

    try {
      const parsedRows = await parseDownloadedPackageRows(sourceUrl, contentType, buffer);

      if (parsedRows.length === 0) {
        await completeSyncLog(syncLog.id, 'failed', emptyResult, '有効な包装単位データが見つかりません');
        logger.warn('Drug package auto-sync: no valid package rows found');
        return;
      }

      const result = await syncPackageData(parsedRows);
      await completeSyncLog(syncLog.id, 'success', {
        itemsProcessed: parsedRows.length,
        itemsAdded: result.added,
        itemsUpdated: result.updated,
        itemsDeleted: 0,
      });

      await persistHeaders(sourceUrl, { ...updateCheck, contentHash }, true);

      logger.info('Drug package auto-sync: completed successfully', {
        processed: parsedRows.length,
        added: result.added,
        updated: result.updated,
      });
    } catch (syncErr) {
      const errorMsg = getErrorMessage(syncErr);
      await completeSyncLog(syncLog.id, 'failed', emptyResult, errorMsg);
      logger.error('Drug package auto-sync: sync failed', { error: errorMsg });
    }
  } catch (err) {
    logger.error('Drug package auto-sync: check/download failed', {
      error: getErrorMessage(err),
    });
  } finally {
    if (pinnedAgent) {
      await pinnedAgent.close().catch(() => undefined);
    }
    isRunning = false;
  }
}

function scheduleNextDrugPackageRun(delayMs: number, mode: 'initial' | 'scheduled'): void {
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
    void runPackageAutoSyncSafely(mode).finally(() => {
      if (!schedulerActive) {
        return;
      }
      scheduleNextDrugPackageRun(CHECK_INTERVAL_MS, 'scheduled');
    });
  }, delayMs);

  schedulerTimer.unref();
}

function startLegacyDrugPackageIntervalScheduler(): void {
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
    void runPackageAutoSyncSafely('initial');
  }, Math.min(60_000, CHECK_INTERVAL_MS));
  schedulerTimer.unref();

  schedulerInterval = setInterval(() => {
    if (!schedulerActive) {
      return;
    }
    void runPackageAutoSyncSafely('scheduled');
  }, CHECK_INTERVAL_MS);
  schedulerInterval.unref();
}

function clearDrugPackageSchedulerHandles(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

export function startDrugPackageScheduler(): void {
  if (!AUTO_SYNC_ENABLED) {
    logger.info('Drug package auto-sync: disabled (set DRUG_PACKAGE_AUTO_SYNC=true to enable)');
    return;
  }

  const sourceUrl = getConfiguredSourceUrl();
  if (!sourceUrl) {
    logger.warn('Drug package auto-sync: DRUG_PACKAGE_SOURCE_URL is not set, scheduler will not start');
    return;
  }

  if (schedulerActive) {
    logger.warn('Drug package auto-sync: scheduler already running');
    return;
  }

  const optimizedLoopEnabled = isOptimizedLoopEnabledForDrugPackageScheduler();
  logger.info('Drug package auto-sync: starting scheduler', {
    intervalHours: CHECK_INTERVAL_HOURS,
    source: summarizeSourceUrl(sourceUrl),
    loopMode: optimizedLoopEnabled ? 'timeout-chain' : 'legacy-interval',
  });

  schedulerActive = true;
  if (optimizedLoopEnabled) {
    scheduleNextDrugPackageRun(Math.min(60_000, CHECK_INTERVAL_MS), 'initial');
    return;
  }
  startLegacyDrugPackageIntervalScheduler();
}

export function stopDrugPackageScheduler(): void {
  const wasActive = schedulerActive || schedulerTimer !== null || schedulerInterval !== null;
  schedulerActive = false;
  clearDrugPackageSchedulerHandles();
  if (wasActive) {
    logger.info('Drug package auto-sync: scheduler stopped');
  }
}

export async function triggerManualPackageAutoSync(options?: { sourceUrl?: string | null }): Promise<{
  triggered: boolean;
  message: string;
}> {
  const sourceUrl = options?.sourceUrl?.trim() || getConfiguredSourceUrl();
  if (!sourceUrl) {
    return {
      triggered: false,
      message: 'DRUG_PACKAGE_SOURCE_URL が設定されていません。手動実行時は sourceUrl を指定してください',
    };
  }

  const validated = await validateExternalHttpsUrl(sourceUrl);
  if (!validated.ok) {
    return {
      triggered: false,
      message: validated.reason ?? 'sourceUrl が不正です',
    };
  }

  if (isRunning) {
    return { triggered: false, message: '包装単位同期が既に実行中です' };
  }

  void runPackageAutoSyncSafely('manual', sourceUrl);

  return { triggered: true, message: '包装単位データの自動取得を開始しました。同期ログで進捗を確認してください。' };
}
