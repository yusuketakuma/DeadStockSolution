import { eq, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { drugMasterSyncLogs } from '../db/schema';
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
import { downloadResponseBuffer, fetchWithTimeout } from '../utils/http-utils';

type FetchDispatcher = NonNullable<RequestInit['dispatcher']>;

const CHECK_INTERVAL_HOURS = parseBoundedInt(process.env.DRUG_PACKAGE_CHECK_INTERVAL_HOURS, 24, 1, 24 * 30);
const CHECK_INTERVAL_MS = CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
const AUTO_SYNC_ENABLED = process.env.DRUG_PACKAGE_AUTO_SYNC === 'true';
const SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'SCHEDULER_OPTIMIZED_LOOP_ENABLED';
const DRUG_PACKAGE_SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'DRUG_PACKAGE_SCHEDULER_OPTIMIZED_LOOP_ENABLED';
const FETCH_TIMEOUT_MS = 120_000;
const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024;
const FETCH_RETRIES = parseBoundedInt(process.env.DRUG_PACKAGE_FETCH_RETRIES, 2, 0, 5);

function buildSourceRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'DeadStockSolution-DrugPackageSync/1.0',
  };
  const authorization = process.env.DRUG_PACKAGE_SOURCE_AUTHORIZATION?.trim();
  const cookie = process.env.DRUG_PACKAGE_SOURCE_COOKIE?.trim();
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

let lastKnownETag: string | null = null;
let lastKnownLastModified: string | null = null;
let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerActive = false;
let isRunning = false;

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getConfiguredSourceUrl(): string {
  return process.env.DRUG_PACKAGE_SOURCE_URL?.trim() || '';
}

function summarizeSourceUrl(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return sourceUrl.slice(0, 64);
  }
}

function updateKnownHeaders(headers: { etag: string | null; lastModified: string | null }): void {
  if (headers.etag) lastKnownETag = headers.etag;
  if (headers.lastModified) lastKnownLastModified = headers.lastModified;
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
      error: formatError(err),
    });
  });
}

async function checkForUpdates(url: string, dispatcher: FetchDispatcher): Promise<{
  hasUpdate: boolean;
  etag: string | null;
  lastModified: string | null;
}> {
  const response = await fetchWithTimeout(url, {
      method: 'HEAD',
      timeoutMs: 30_000,
      retry: { retries: FETCH_RETRIES },
      redirect: 'manual',
      dispatcher,
      headers: buildSourceRequestHeaders(),
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Redirect response is not allowed for source URL: ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`HEAD request failed: ${response.status} ${response.statusText}`);
    }

    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');

    if (lastKnownETag === null && lastKnownLastModified === null) {
      const [lastSync] = await db.select({ sourceDescription: drugMasterSyncLogs.sourceDescription })
        .from(drugMasterSyncLogs)
        .where(eq(drugMasterSyncLogs.status, 'success'))
        .orderBy(desc(drugMasterSyncLogs.startedAt))
        .limit(1);

      if (!lastSync) {
        return { hasUpdate: true, etag, lastModified };
      }

      if (!etag && !lastModified) {
        return { hasUpdate: false, etag, lastModified };
      }
    }

    if (etag && lastKnownETag !== null) {
      return { hasUpdate: etag !== lastKnownETag, etag, lastModified };
    }

    if (lastModified && lastKnownLastModified !== null) {
      return { hasUpdate: lastModified !== lastKnownLastModified, etag, lastModified };
    }

    return { hasUpdate: etag !== lastKnownETag || lastModified !== lastKnownLastModified, etag, lastModified };
}

async function downloadFile(url: string, dispatcher: FetchDispatcher): Promise<{ buffer: Buffer; contentType: string | null }> {
  const response = await fetchWithTimeout(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      retry: { retries: FETCH_RETRIES },
      redirect: 'manual',
      dispatcher,
      headers: buildSourceRequestHeaders(),
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Redirect response is not allowed for source URL: ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    const buffer = await downloadResponseBuffer(response, MAX_DOWNLOAD_SIZE);

    return { buffer, contentType };
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

  const validated = await validateExternalHttpsUrl(sourceUrl);
  if (!validated.ok) {
    logger.error('Drug package auto-sync: source URL is invalid', {
      source: summarizeSourceUrl(sourceUrl),
      reason: validated.reason,
    });
    return;
  }

  const pinnedAgent = createPinnedDnsAgent(validated.hostname ?? new URL(sourceUrl).hostname, validated.resolvedAddresses);
  const pinnedDispatcher = pinnedAgent as unknown as FetchDispatcher;

  isRunning = true;

  try {
    logger.info('Drug package auto-sync: checking for updates', { source: summarizeSourceUrl(sourceUrl) });
    const updateCheck = await checkForUpdates(sourceUrl, pinnedDispatcher);

    if (!updateCheck.hasUpdate) {
      logger.info('Drug package auto-sync: no updates detected');
      updateKnownHeaders(updateCheck);
      return;
    }

    logger.info('Drug package auto-sync: update detected, downloading file');
    const { buffer, contentType } = await downloadFile(sourceUrl, pinnedDispatcher);

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

      updateKnownHeaders(updateCheck);

      logger.info('Drug package auto-sync: completed successfully', {
        processed: parsedRows.length,
        added: result.added,
        updated: result.updated,
      });
    } catch (syncErr) {
      const errorMsg = formatError(syncErr);
      await completeSyncLog(syncLog.id, 'failed', emptyResult, errorMsg);
      logger.error('Drug package auto-sync: sync failed', { error: errorMsg });
    }
  } catch (err) {
    logger.error('Drug package auto-sync: check/download failed', {
      error: formatError(err),
    });
  } finally {
    await pinnedAgent.close().catch(() => undefined);
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
