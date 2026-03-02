import {
  syncDrugMaster,
  createSyncLog,
  completeSyncLog,
} from './drug-master-service';
import { parseMhlwDrugFile } from './drug-master-parser-service';
import { logger } from './logger';
import { createPinnedDnsAgent, validateExternalHttpsUrl } from '../utils/network-utils';
import { parseBooleanFlag, parseBoundedInt } from '../utils/number-utils';
import { summarizeSourceUrl, MHLW_DEFAULT_FETCH_RETRIES, type FetchDispatcher } from '../utils/http-utils';
import { getErrorMessage } from '../middleware/error-handler';
import { sha256 } from '../utils/crypto-utils';
import { persistSourceHeaders, SOURCE_KEY_SINGLE } from './drug-master-source-state-service';
import { runMultiFileSync } from './mhlw-multi-file-fetcher';
import { checkForUpdates, downloadFile } from './mhlw-source-fetch';

export type SourceMode = 'index' | 'single';

// チェック間隔: デフォルト24時間（環境変数で変更可能）
const CHECK_INTERVAL_HOURS = parseBoundedInt(process.env.DRUG_MASTER_CHECK_INTERVAL_HOURS, 24, 1, 24 * 30);
const CHECK_INTERVAL_MS = CHECK_INTERVAL_HOURS * 60 * 60 * 1000;

// 自動同期の有効/無効
const AUTO_SYNC_ENABLED = process.env.DRUG_MASTER_AUTO_SYNC === 'true';
const SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'SCHEDULER_OPTIMIZED_LOOP_ENABLED';
const DRUG_MASTER_SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV = 'DRUG_MASTER_SCHEDULER_OPTIMIZED_LOOP_ENABLED';

// ソースモード: 'index'（MHLW ポータル自動探索）or 'single'（従来の単一URL）
function getConfiguredSourceMode(): SourceMode {
  const mode = process.env.DRUG_MASTER_SOURCE_MODE?.trim().toLowerCase();
  if (mode === 'single') return 'single';
  return 'index'; // デフォルト
}

// HTTP リトライ（環境変数でオーバーライド可能）
const FETCH_RETRIES = parseBoundedInt(process.env.DRUG_MASTER_FETCH_RETRIES, MHLW_DEFAULT_FETCH_RETRIES, 0, 5);

// ── 状態管理 ──────────────────────────────────────

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerActive = false;
let isRunning = false;

function getConfiguredSourceUrl(): string {
  return process.env.DRUG_MASTER_SOURCE_URL?.trim() || '';
}


function isOptimizedLoopEnabledForDrugMasterScheduler(): boolean {
  const localFlag = process.env[DRUG_MASTER_SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV];
  if (typeof localFlag === 'string' && localFlag.trim().length > 0) {
    return parseBooleanFlag(localFlag, true);
  }
  return parseBooleanFlag(process.env[SCHEDULER_OPTIMIZED_LOOP_ENABLED_ENV], true);
}

async function persistSingleSourceState(
  sourceUrl: string,
  data: {
    etag: string | null;
    lastModified: string | null;
    contentHash?: string | null;
  },
  changed: boolean,
): Promise<void> {
  await persistSourceHeaders(SOURCE_KEY_SINGLE, sourceUrl, data, changed);
}

function runAutoSyncSafely(mode: 'initial' | 'scheduled' | 'manual', sourceUrl?: string): Promise<void> {
  const sourceMode = getConfiguredSourceMode();
  const task = sourceMode === 'index' && !sourceUrl
    ? runAutoSyncIndex()
    : (sourceUrl ? runAutoSyncWithSource(sourceUrl) : runAutoSync());
  return task.catch((err) => {
    const suffix = mode === 'manual' ? 'manual trigger' : `${mode} run`;
    logger.error(`Drug master auto-sync: ${suffix} failed`, {
      error: getErrorMessage(err),
    });
  });
}

/**
 * インデックスモード: MHLW ポータルから自動探索 → 4ファイルマージ同期
 */
async function runAutoSyncIndex(): Promise<void> {
  if (isRunning) {
    logger.info('Drug master auto-sync (index): already running, skipping');
    return;
  }
  isRunning = true;
  try {
    logger.info('Drug master auto-sync (index): starting multi-file sync');
    await runMultiFileSync();
  } finally {
    isRunning = false;
  }
}

// ── サイト更新検知 ──────────────────────────────────

const DRUG_MASTER_HEADERS: Record<string, string> = {
  'User-Agent': 'DeadStockSolution-DrugMasterSync/1.0',
};

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

  isRunning = true;
  let pinnedAgent: { close: () => Promise<void> } | null = null;

  try {
    const validated = await validateExternalHttpsUrl(sourceUrl);
    if (!validated.ok) {
      logger.error('Drug master auto-sync: source URL is invalid', {
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

    logger.info('Drug master auto-sync: checking for updates', { source: summarizeSourceUrl(sourceUrl) });

    // 1. 更新チェック
    const fetchOpts = { sourceKey: SOURCE_KEY_SINGLE, retries: FETCH_RETRIES, headers: DRUG_MASTER_HEADERS };
    const updateCheck = await checkForUpdates(sourceUrl, pinnedDispatcher, fetchOpts);

    if (!updateCheck.hasUpdate) {
      logger.info('Drug master auto-sync: no updates detected');
      await persistSingleSourceState(sourceUrl, updateCheck, false);
      return;
    }

    logger.info('Drug master auto-sync: update detected, downloading file');

    // 2. ファイルダウンロード
    const { buffer, contentType } = await downloadFile(sourceUrl, pinnedDispatcher, fetchOpts);
    const contentHash = sha256(buffer);

    if (
      updateCheck.compareByContentHash
      && updateCheck.previousContentHash
      && updateCheck.previousContentHash === contentHash
    ) {
      logger.info('Drug master auto-sync: no updates detected by content-hash fallback');
      await persistSingleSourceState(sourceUrl, { ...updateCheck, contentHash }, false);
      return;
    }

    // 3. 同期ログ作成
    const syncLog = await createSyncLog('auto', `自動取得: ${summarizeSourceUrl(sourceUrl)}`, null);
    const revisionDate = new Date().toISOString().slice(0, 10);

    try {
      const parsedRows = await parseMhlwDrugFile(sourceUrl, contentType, buffer);

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

      // 6. ヘッダー情報を DB に永続化（成功時のみ）
      await persistSingleSourceState(sourceUrl, { ...updateCheck, contentHash }, true);

      logger.info('Drug master auto-sync: completed successfully', {
        processed: result.itemsProcessed,
        added: result.itemsAdded,
        updated: result.itemsUpdated,
        deleted: result.itemsDeleted,
      });
    } catch (syncErr) {
      const errorMsg = getErrorMessage(syncErr);
      await completeSyncLog(syncLog.id, 'failed',
        { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 },
        errorMsg);
      logger.error('Drug master auto-sync: sync failed', { error: errorMsg });
    }
  } catch (err) {
    logger.error('Drug master auto-sync: check/download failed', {
      error: getErrorMessage(err),
    });
  } finally {
    if (pinnedAgent) {
      await pinnedAgent.close().catch(() => undefined);
    }
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

  const sourceMode = getConfiguredSourceMode();
  const sourceUrl = getConfiguredSourceUrl();

  // index モードでは SOURCE_URL 不要（ポータルから自動探索）
  if (sourceMode === 'single' && !sourceUrl) {
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
    sourceMode,
    source: sourceMode === 'single' ? summarizeSourceUrl(sourceUrl) : 'MHLW portal auto-discovery',
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
export async function triggerManualAutoSync(options?: {
  sourceUrl?: string | null;
  sourceMode?: SourceMode;
}): Promise<{
  triggered: boolean;
  message: string;
}> {
  const requestedMode = options?.sourceMode ?? getConfiguredSourceMode();

  // index モード: ポータル自動探索（sourceUrl 不要）
  if (requestedMode === 'index' && !options?.sourceUrl?.trim()) {
    if (isRunning) {
      return { triggered: false, message: '同期が既に実行中です' };
    }
    void runAutoSyncIndex().catch((err) => {
      logger.error('Drug master auto-sync: manual index trigger failed', {
        error: getErrorMessage(err),
      });
    });
    return { triggered: true, message: 'MHLW ポータルから自動探索を開始しました。同期ログで進捗を確認してください。' };
  }

  // single モード or sourceUrl 指定
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

/** 現在設定されているソースモードを返す（API用） */
export { getConfiguredSourceMode };
