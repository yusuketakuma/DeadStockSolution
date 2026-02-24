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

const CHECK_INTERVAL_MS = Number(process.env.DRUG_PACKAGE_CHECK_INTERVAL_HOURS || 24) * 60 * 60 * 1000;
const AUTO_SYNC_ENABLED = process.env.DRUG_PACKAGE_AUTO_SYNC === 'true';
const FETCH_TIMEOUT_MS = 120_000;
const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024;

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

function validateSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

let lastKnownETag: string | null = null;
let lastKnownLastModified: string | null = null;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let initialDelayTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

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

async function checkForUpdates(url: string): Promise<{
  hasUpdate: boolean;
  etag: string | null;
  lastModified: string | null;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: buildSourceRequestHeaders(),
    });

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
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadFile(url: string): Promise<{ buffer: Buffer; contentType: string | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: buildSourceRequestHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_DOWNLOAD_SIZE) {
      throw new Error(`File too large: ${contentLength} bytes (max ${MAX_DOWNLOAD_SIZE})`);
    }

    const contentType = response.headers.get('content-type');
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_SIZE) {
      throw new Error(`Downloaded file too large: ${arrayBuffer.byteLength} bytes (max ${MAX_DOWNLOAD_SIZE})`);
    }

    return { buffer: Buffer.from(arrayBuffer), contentType };
  } finally {
    clearTimeout(timeoutId);
  }
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

  if (!validateSourceUrl(sourceUrl)) {
    logger.error('Drug package auto-sync: source URL is invalid (must be HTTPS, non-private)', {
      source: summarizeSourceUrl(sourceUrl),
    });
    return;
  }

  isRunning = true;

  try {
    logger.info('Drug package auto-sync: checking for updates', { source: summarizeSourceUrl(sourceUrl) });
    const updateCheck = await checkForUpdates(sourceUrl);

    if (!updateCheck.hasUpdate) {
      logger.info('Drug package auto-sync: no updates detected');
      if (updateCheck.etag) lastKnownETag = updateCheck.etag;
      if (updateCheck.lastModified) lastKnownLastModified = updateCheck.lastModified;
      return;
    }

    logger.info('Drug package auto-sync: update detected, downloading file');
    const { buffer, contentType } = await downloadFile(sourceUrl);

    const syncLog = await createSyncLog('package_auto', `包装単位自動取得: ${summarizeSourceUrl(sourceUrl)}`, null);
    const emptyResult = { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 };

    try {
      let parsedRows;
      const isCsv = contentType?.includes('csv') ||
        contentType?.includes('text/plain') ||
        sourceUrl.endsWith('.csv');
      const isXml = contentType?.includes('xml') || sourceUrl.endsWith('.xml');
      const isZip = contentType?.includes('zip') || sourceUrl.endsWith('.zip');

      if (isCsv) {
        const csvContent = decodeCsvBuffer(buffer);
        parsedRows = parsePackageCsvData(csvContent);
      } else if (isXml) {
        const xmlContent = buffer.toString('utf-8');
        parsedRows = parsePackageXmlData(xmlContent);
      } else if (isZip) {
        parsedRows = await parsePackageZipData(buffer);
      } else {
        const excelRows = await parseExcelBuffer(buffer);
        parsedRows = parsePackageExcelData(excelRows);
      }

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

      if (updateCheck.etag) lastKnownETag = updateCheck.etag;
      if (updateCheck.lastModified) lastKnownLastModified = updateCheck.lastModified;

      logger.info('Drug package auto-sync: completed successfully', {
        processed: parsedRows.length,
        added: result.added,
        updated: result.updated,
      });
    } catch (syncErr) {
      const errorMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
      await completeSyncLog(syncLog.id, 'failed', emptyResult, errorMsg);
      logger.error('Drug package auto-sync: sync failed', { error: errorMsg });
    }
  } catch (err) {
    logger.error('Drug package auto-sync: check/download failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isRunning = false;
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

  if (schedulerTimer) {
    logger.warn('Drug package auto-sync: scheduler already running');
    return;
  }

  const intervalHours = CHECK_INTERVAL_MS / (60 * 60 * 1000);
  logger.info('Drug package auto-sync: starting scheduler', {
    intervalHours,
    source: summarizeSourceUrl(sourceUrl),
  });

  const initialDelay = 5 * 60 * 1000;
  initialDelayTimer = setTimeout(() => {
    initialDelayTimer = null;
    runPackageAutoSync().catch((err) => {
      logger.error('Drug package auto-sync: initial run failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, initialDelay);

  schedulerTimer = setInterval(() => {
    runPackageAutoSync().catch((err) => {
      logger.error('Drug package auto-sync: scheduled run failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, CHECK_INTERVAL_MS);

  schedulerTimer.unref();
}

export function stopDrugPackageScheduler(): void {
  if (initialDelayTimer) {
    clearTimeout(initialDelayTimer);
    initialDelayTimer = null;
  }
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
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

  if (!validateSourceUrl(sourceUrl)) {
    return {
      triggered: false,
      message: 'sourceUrl が不正です（HTTPS かつプライベートネットワーク以外を指定）',
    };
  }

  if (isRunning) {
    return { triggered: false, message: '包装単位同期が既に実行中です' };
  }

  runPackageAutoSyncWithSource(sourceUrl).catch((err) => {
    logger.error('Drug package manual trigger: failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return { triggered: true, message: '包装単位データの自動取得を開始しました。同期ログで進捗を確認してください。' };
}
