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

// ── 設定 ──────────────────────────────────────────

// チェック間隔: デフォルト24時間（環境変数で変更可能）
const CHECK_INTERVAL_MS = Number(process.env.DRUG_MASTER_CHECK_INTERVAL_HOURS || 24) * 60 * 60 * 1000;

// 厚生労働省 薬価基準収載品目リスト のURL（環境変数で設定）
// 例: https://www.mhlw.go.jp/content/12404000/xxxxxxxx.xlsx
const MHLW_SOURCE_URL = process.env.DRUG_MASTER_SOURCE_URL || '';

// 自動同期の有効/無効
const AUTO_SYNC_ENABLED = process.env.DRUG_MASTER_AUTO_SYNC === 'true';

// HTTP タイムアウト
const FETCH_TIMEOUT_MS = 120_000; // 2分（大きなファイルのため）

// ダウンロードサイズ上限
const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100MB

// ── URL バリデーション ─────────────────────────────────

function validateSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // HTTPS のみ許可（SSRF 防止）
    if (parsed.protocol !== 'https:') return false;
    // ローカル/プライベートアドレスを拒否
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

// ── 状態管理 ──────────────────────────────────────

let lastKnownETag: string | null = null;
let lastKnownLastModified: string | null = null;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let initialDelayTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

// ── サイト更新検知 ──────────────────────────────────

/**
 * HEAD リクエストでサイトの更新を検知する
 * ETag または Last-Modified ヘッダーの変化で判定
 */
async function checkForUpdates(url: string): Promise<{
  hasUpdate: boolean;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'DeadStockSolution-DrugMasterSync/1.0',
      },
    });

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
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * ファイルをダウンロードしてバッファとして取得
 */
async function downloadFile(url: string): Promise<{ buffer: Buffer; contentType: string | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'DeadStockSolution-DrugMasterSync/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    // サイズチェック（Content-Length がある場合）
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

/**
 * 自動同期の実行
 */
async function runAutoSync(): Promise<void> {
  if (isRunning) {
    logger.info('Drug master auto-sync: already running, skipping');
    return;
  }

  if (!MHLW_SOURCE_URL) {
    logger.warn('Drug master auto-sync: DRUG_MASTER_SOURCE_URL is not configured');
    return;
  }

  if (!validateSourceUrl(MHLW_SOURCE_URL)) {
    logger.error('Drug master auto-sync: DRUG_MASTER_SOURCE_URL is invalid (must be HTTPS, non-private)', { url: MHLW_SOURCE_URL });
    return;
  }

  isRunning = true;

  try {
    logger.info('Drug master auto-sync: checking for updates', { url: MHLW_SOURCE_URL });

    // 1. 更新チェック
    const updateCheck = await checkForUpdates(MHLW_SOURCE_URL);

    if (!updateCheck.hasUpdate) {
      logger.info('Drug master auto-sync: no updates detected');
      // ヘッダー情報を更新
      if (updateCheck.etag) lastKnownETag = updateCheck.etag;
      if (updateCheck.lastModified) lastKnownLastModified = updateCheck.lastModified;
      return;
    }

    logger.info('Drug master auto-sync: update detected, downloading file');

    // 2. ファイルダウンロード
    const { buffer, contentType } = await downloadFile(MHLW_SOURCE_URL);

    // 3. 同期ログ作成
    const syncLog = await createSyncLog('auto', `自動取得: ${MHLW_SOURCE_URL}`, null);
    const revisionDate = new Date().toISOString().slice(0, 10);

    try {
      // 4. パース
      let parsedRows;
      const isCsv = contentType?.includes('csv') ||
        contentType?.includes('text/plain') ||
        MHLW_SOURCE_URL.endsWith('.csv');

      if (isCsv) {
        const csvContent = decodeCsvBuffer(buffer);
        parsedRows = parseMhlwCsvData(csvContent);
      } else {
        const excelRows = await parseExcelBuffer(buffer);
        parsedRows = parseMhlwExcelData(excelRows);
      }

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
      if (updateCheck.etag) lastKnownETag = updateCheck.etag;
      if (updateCheck.lastModified) lastKnownLastModified = updateCheck.lastModified;

      logger.info('Drug master auto-sync: completed successfully', {
        processed: result.itemsProcessed,
        added: result.itemsAdded,
        updated: result.itemsUpdated,
        deleted: result.itemsDeleted,
      });
    } catch (syncErr) {
      const errorMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
      await completeSyncLog(syncLog.id, 'failed',
        { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 },
        errorMsg);
      logger.error('Drug master auto-sync: sync failed', { error: errorMsg });
    }
  } catch (err) {
    logger.error('Drug master auto-sync: check/download failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isRunning = false;
  }
}

// ── スケジューラ制御 ─────────────────────────────────

/**
 * 自動同期スケジューラを開始する
 * サーバー起動時に呼び出す
 */
export function startDrugMasterScheduler(): void {
  if (!AUTO_SYNC_ENABLED) {
    logger.info('Drug master auto-sync: disabled (set DRUG_MASTER_AUTO_SYNC=true to enable)');
    return;
  }

  if (!MHLW_SOURCE_URL) {
    logger.warn('Drug master auto-sync: DRUG_MASTER_SOURCE_URL is not set, scheduler will not start');
    return;
  }

  if (schedulerTimer) {
    logger.warn('Drug master auto-sync: scheduler already running');
    return;
  }

  const intervalHours = CHECK_INTERVAL_MS / (60 * 60 * 1000);
  logger.info('Drug master auto-sync: starting scheduler', {
    intervalHours,
    sourceUrl: MHLW_SOURCE_URL,
  });

  // 起動後5分遅延で初回チェック（サーバー起動直後は避ける）
  const initialDelay = 5 * 60 * 1000;
  initialDelayTimer = setTimeout(() => {
    initialDelayTimer = null;
    runAutoSync().catch((err) => {
      logger.error('Drug master auto-sync: initial run failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, initialDelay);

  // 定期実行
  schedulerTimer = setInterval(() => {
    runAutoSync().catch((err) => {
      logger.error('Drug master auto-sync: scheduled run failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, CHECK_INTERVAL_MS);

  // graceful shutdown時にクリーンアップ
  schedulerTimer.unref();
}

/**
 * スケジューラを停止する
 */
export function stopDrugMasterScheduler(): void {
  if (initialDelayTimer) {
    clearTimeout(initialDelayTimer);
    initialDelayTimer = null;
  }
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    logger.info('Drug master auto-sync: scheduler stopped');
  }
}

/**
 * 手動で即時チェック＆同期をトリガーする（管理者API用）
 */
export async function triggerManualAutoSync(): Promise<{
  triggered: boolean;
  message: string;
}> {
  if (!MHLW_SOURCE_URL) {
    return { triggered: false, message: 'DRUG_MASTER_SOURCE_URL が設定されていません' };
  }

  if (isRunning) {
    return { triggered: false, message: '同期が既に実行中です' };
  }

  // バックグラウンドで実行（レスポンスは即時返す）
  runAutoSync().catch((err) => {
    logger.error('Drug master manual trigger: failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return { triggered: true, message: '自動取得を開始しました。同期ログで進捗を確認してください。' };
}
