import { eq, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { drugMasterSyncLogs } from '../db/schema';
import {
  parseMhlwExcelData,
  parseMhlwCsvData,
  decodeCsvBuffer,
  syncDrugMaster,
  createSyncLog,
  completeSyncLog,
} from './drug-master-service';
import { parseExcelBuffer } from './upload-service';
import { logger } from './logger';
import { createPinnedDnsAgent, validateExternalHttpsUrl } from '../utils/network-utils';
import { parseBooleanFlag, parseBoundedInt } from '../utils/number-utils';
import { downloadResponseBuffer, fetchWithTimeout } from '../utils/http-utils';

type FetchDispatcher = NonNullable<RequestInit['dispatcher']>;

// チェック間隔: デフォルト24時間（環境変数で変更可能）
const CHECK_INTERVAL_HOURS = parseBoundedInt(process.env.DRUG_MASTER_CHECK_INTERVAL_HOURS, 24, 1, 24 * 30);
const CHECK_INTERVAL_MS = CHECK_INTERVAL_HOURS * 60 * 60 * 1000;

// 自動同期の有効/無効
const AUTO_SYNC_ENABLED = process.env.DRUG_MASTER_AUTO_SYNC === 'true';
const SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'SCHEDULER_OPTIMIZED_LOOP_ENABLED';
const DRUG_MASTER_SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'DRUG_MASTER_SCHEDULER_OPTIMIZED_LOOP_ENABLED';

// HTTP タイムアウト
const FETCH_TIMEOUT_MS = 120_000; // 2分（大きなファイルのため）
const FETCH_RETRIES = parseBoundedInt(process.env.DRUG_MASTER_FETCH_RETRIES, 2, 0, 5);

// ダウンロードサイズ上限
const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100MB

// ── 状態管理 ──────────────────────────────────────

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
  return process.env.DRUG_MASTER_SOURCE_URL?.trim() || '';
}

function summarizeSourceUrl(sourceUrl: string): string {
  try {
    const parsed = new URL(sourceUrl);
    return parsed.hostname;
  } catch {
    return sourceUrl.slice(0, 64);
  }
}

function updateKnownHeaders(headers: { etag: string | null; lastModified: string | null }): void {
  if (headers.etag) lastKnownETag = headers.etag;
  if (headers.lastModified) lastKnownLastModified = headers.lastModified;
}

function isOptimizedLoopEnabledForDrugMasterScheduler(): boolean {
  const localFlag = process.env[DRUG_MASTER_SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV];
  if (typeof localFlag === 'string' && localFlag.trim().length > 0) {
    return parseBooleanFlag(localFlag, true);
  }
  return parseBooleanFlag(process.env[SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV], true);
}

async function parseDownloadedRows(
  sourceUrl: string,
  contentType: string | null,
  buffer: Buffer,
) {
  const isCsv = contentType?.includes('csv')
    || contentType?.includes('text/plain')
    || sourceUrl.endsWith('.csv');
  if (isCsv) {
    const csvContent = decodeCsvBuffer(buffer);
    return parseMhlwCsvData(csvContent);
  }

  const excelRows = await parseExcelBuffer(buffer);
  return parseMhlwExcelData(excelRows);
}

function runAutoSyncSafely(mode: 'initial' | 'scheduled' | 'manual', sourceUrl?: string): Promise<void> {
  const task = sourceUrl ? runAutoSyncWithSource(sourceUrl) : runAutoSync();
  return task.catch((err) => {
    const suffix = mode === 'manual' ? 'manual trigger' : `${mode} run`;
    logger.error(`Drug master auto-sync: ${suffix} failed`, {
      error: formatError(err),
    });
  });
}

// ── サイト更新検知 ──────────────────────────────────

/**
 * HEAD リクエストでサイトの更新を検知する
 * ETag または Last-Modified ヘッダーの変化で判定
 */
async function checkForUpdates(url: string, dispatcher: FetchDispatcher): Promise<{
  hasUpdate: boolean;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
}> {
  const response = await fetchWithTimeout(url, {
      method: 'HEAD',
      timeoutMs: 30_000,
      retry: { retries: FETCH_RETRIES },
      redirect: 'manual',
      dispatcher,
      headers: {
        'User-Agent': 'DeadStockSolution-DrugMasterSync/1.0',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Redirect response is not allowed for source URL: ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`HEAD request failed: ${response.status} ${response.statusText}`);
    }

    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');
    const contentType = response.headers.get('content-type');

    // 初回: まだ前回値がない場合は「更新あり」とする
    if (lastKnownETag === null && lastKnownLastModified === null) {
      // DB から最後の成功同期を確認
      const [lastSync] = await db.select({ sourceDescription: drugMasterSyncLogs.sourceDescription })
        .from(drugMasterSyncLogs)
        .where(eq(drugMasterSyncLogs.status, 'success'))
        .orderBy(desc(drugMasterSyncLogs.startedAt))
        .limit(1);

      // 一度も同期したことがなければ「更新あり」
      if (!lastSync) {
        return { hasUpdate: true, etag, lastModified, contentType };
      }

      // 前回同期があるがヘッダー情報がない場合、判定不能なので更新なしとする
      if (!etag && !lastModified) {
        return { hasUpdate: false, etag, lastModified, contentType };
      }
    }

    // ETag で比較
    if (etag && lastKnownETag !== null) {
      const hasUpdate = etag !== lastKnownETag;
      return { hasUpdate, etag, lastModified, contentType };
    }

    // Last-Modified で比較
    if (lastModified && lastKnownLastModified !== null) {
      const hasUpdate = lastModified !== lastKnownLastModified;
      return { hasUpdate, etag, lastModified, contentType };
    }

    // ヘッダー情報がないか、初回で前回値があるケース
    // → 安全のため更新なしとする（手動同期を推奨）
    return { hasUpdate: etag !== lastKnownETag || lastModified !== lastKnownLastModified, etag, lastModified, contentType };
  
}

/**
 * ファイルをダウンロードしてバッファとして取得
 */
async function downloadFile(url: string, dispatcher: FetchDispatcher): Promise<{ buffer: Buffer; contentType: string | null }> {
  const response = await fetchWithTimeout(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      retry: { retries: FETCH_RETRIES },
      redirect: 'manual',
      dispatcher,
      headers: {
        'User-Agent': 'DeadStockSolution-DrugMasterSync/1.0',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Redirect response is not allowed for source URL: ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    // サイズチェック（Content-Length がある場合）
    const contentType = response.headers.get('content-type');
    const buffer = await downloadResponseBuffer(response, MAX_DOWNLOAD_SIZE);

    return { buffer, contentType };
}

/**
 * 自動同期の実行
 */
async function runAutoSync(): Promise<void> {
  await runAutoSyncWithSource(getConfiguredSourceUrl());
}

async function runAutoSyncWithSource(sourceUrl: string): Promise<void> {
  if (isRunning) {
    logger.info('Drug master auto-sync: already running, skipping');
    return;
  }

  if (!sourceUrl) {
    logger.warn('Drug master auto-sync: DRUG_MASTER_SOURCE_URL is not configured');
    return;
  }

  const validated = await validateExternalHttpsUrl(sourceUrl);
  if (!validated.ok) {
    logger.error('Drug master auto-sync: source URL is invalid', {
      source: summarizeSourceUrl(sourceUrl),
      reason: validated.reason,
    });
    return;
  }

  const pinnedAgent = createPinnedDnsAgent(validated.hostname ?? new URL(sourceUrl).hostname, validated.resolvedAddresses);
  const pinnedDispatcher = pinnedAgent as unknown as FetchDispatcher;

  isRunning = true;

  try {
    logger.info('Drug master auto-sync: checking for updates', { source: summarizeSourceUrl(sourceUrl) });

    // 1. 更新チェック
    const updateCheck = await checkForUpdates(sourceUrl, pinnedDispatcher);

    if (!updateCheck.hasUpdate) {
      logger.info('Drug master auto-sync: no updates detected');
      updateKnownHeaders(updateCheck);
      return;
    }

    logger.info('Drug master auto-sync: update detected, downloading file');

    // 2. ファイルダウンロード
    const { buffer, contentType } = await downloadFile(sourceUrl, pinnedDispatcher);

    // 3. 同期ログ作成
    const syncLog = await createSyncLog('auto', `自動取得: ${summarizeSourceUrl(sourceUrl)}`, null);
    const revisionDate = new Date().toISOString().slice(0, 10);

    try {
      const parsedRows = await parseDownloadedRows(sourceUrl, contentType, buffer);

      if (parsedRows.length === 0) {
        await completeSyncLog(syncLog.id, 'failed',
          { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 },
          'ダウンロードしたファイルから有効なデータが見つかりません');
        logger.warn('Drug master auto-sync: no valid data rows found in downloaded file');
        return;
      }

      logger.info('Drug master auto-sync: parsed rows', { count: parsedRows.length });

      // 5. 同期実行
      const result = await syncDrugMaster(parsedRows, syncLog.id, revisionDate);
      await completeSyncLog(syncLog.id, 'success', result);

      // 6. ヘッダー情報を更新（成功時のみ）
      updateKnownHeaders(updateCheck);

      logger.info('Drug master auto-sync: completed successfully', {
        processed: result.itemsProcessed,
        added: result.itemsAdded,
        updated: result.itemsUpdated,
        deleted: result.itemsDeleted,
      });
    } catch (syncErr) {
      const errorMsg = formatError(syncErr);
      await completeSyncLog(syncLog.id, 'failed',
        { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 },
        errorMsg);
      logger.error('Drug master auto-sync: sync failed', { error: errorMsg });
    }
  } catch (err) {
    logger.error('Drug master auto-sync: check/download failed', {
      error: formatError(err),
    });
  } finally {
    await pinnedAgent.close().catch(() => undefined);
    isRunning = false;
  }
}

// ── スケジューラ制御 ─────────────────────────────────

function scheduleNextDrugMasterRun(delayMs: number, mode: 'initial' | 'scheduled'): void {
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
    void runAutoSyncSafely(mode).finally(() => {
      if (!schedulerActive) {
        return;
      }
      scheduleNextDrugMasterRun(CHECK_INTERVAL_MS, 'scheduled');
    });
  }, delayMs);

  schedulerTimer.unref();
}

function startLegacyDrugMasterIntervalScheduler(): void {
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
    void runAutoSyncSafely('initial');
  }, Math.min(60_000, CHECK_INTERVAL_MS));
  schedulerTimer.unref();

  schedulerInterval = setInterval(() => {
    if (!schedulerActive) {
      return;
    }
    void runAutoSyncSafely('scheduled');
  }, CHECK_INTERVAL_MS);
  schedulerInterval.unref();
}

function clearDrugMasterSchedulerHandles(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/**
 * 自動同期スケジューラを開始する
 * サーバー起動時に呼び出す
 */
export function startDrugMasterScheduler(): void {
  if (!AUTO_SYNC_ENABLED) {
    logger.info('Drug master auto-sync: disabled (set DRUG_MASTER_AUTO_SYNC=true to enable)');
    return;
  }

  const sourceUrl = getConfiguredSourceUrl();
  if (!sourceUrl) {
    logger.warn('Drug master auto-sync: DRUG_MASTER_SOURCE_URL is not set, scheduler will not start');
    return;
  }

  if (schedulerActive) {
    logger.warn('Drug master auto-sync: scheduler already running');
    return;
  }

  const optimizedLoopEnabled = isOptimizedLoopEnabledForDrugMasterScheduler();
  logger.info('Drug master auto-sync: starting scheduler', {
    intervalHours: CHECK_INTERVAL_HOURS,
    source: summarizeSourceUrl(sourceUrl),
    loopMode: optimizedLoopEnabled ? 'timeout-chain' : 'legacy-interval',
  });

  schedulerActive = true;
  if (optimizedLoopEnabled) {
    scheduleNextDrugMasterRun(Math.min(60_000, CHECK_INTERVAL_MS), 'initial');
    return;
  }
  startLegacyDrugMasterIntervalScheduler();
}

/**
 * スケジューラを停止する
 */
export function stopDrugMasterScheduler(): void {
  const wasActive = schedulerActive || schedulerTimer !== null || schedulerInterval !== null;
  schedulerActive = false;
  clearDrugMasterSchedulerHandles();
  if (wasActive) {
    logger.info('Drug master auto-sync: scheduler stopped');
  }
}

/**
 * 手動で即時チェック＆同期をトリガーする（管理者API用）
 */
export async function triggerManualAutoSync(options?: { sourceUrl?: string | null }): Promise<{
  triggered: boolean;
  message: string;
}> {
  const sourceUrl = options?.sourceUrl?.trim() || getConfiguredSourceUrl();
  if (!sourceUrl) {
    return {
      triggered: false,
      message: 'DRUG_MASTER_SOURCE_URL が設定されていません。手動実行時は sourceUrl を指定してください',
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
    return { triggered: false, message: '同期が既に実行中です' };
  }

  // バックグラウンドで実行（レスポンスは即時返す）
  void runAutoSyncSafely('manual', sourceUrl);

  return { triggered: true, message: '自動取得を開始しました。同期ログで進捗を確認してください。' };
}
