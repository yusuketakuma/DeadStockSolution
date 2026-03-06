import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AuthRequest } from '../types';
import { writeLog, getClientIp } from '../services/log-service';
import {
  parseMhlwExcelData,
  parseMhlwCsvData,
  parsePackageExcelData,
  parsePackageCsvData,
  parsePackageXmlData,
  parsePackageZipData,
  decodeCsvBuffer,
  syncDrugMaster,
  syncPackageData,
  getSyncLogs,
  createSyncLog,
  completeSyncLog,
} from '../services/drug-master-service';
import { triggerManualAutoSync, getConfiguredSourceMode } from '../services/drug-master-scheduler';
import type { SourceMode } from '../services/drug-master-scheduler';
import { triggerManualPackageAutoSync } from '../services/drug-package-scheduler';
import { getSourceStatesByPrefix } from '../services/drug-master-source-state-service';
import { parseExcelBuffer } from '../services/upload-service';
import { logger } from '../services/logger';
import { getErrorMessage } from './admin-utils';
import { createMemorySingleFileUpload } from '../middleware/upload-middleware';

const router = Router();
type ParsedDrugMasterRows = ReturnType<typeof parseMhlwExcelData>;
type ParsedPackageRows = ReturnType<typeof parsePackageExcelData>;
type DrugMasterSyncSummary = {
  itemsProcessed: number;
  itemsAdded: number;
  itemsUpdated: number;
  itemsDeleted: number;
};

const EMPTY_SYNC_RESULT: DrugMasterSyncSummary = {
  itemsProcessed: 0,
  itemsAdded: 0,
  itemsUpdated: 0,
  itemsDeleted: 0,
};


function getUploadContext(req: AuthRequest): Record<string, unknown> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  const revisionDateRaw = req.body?.revisionDate;

  return {
    path: req.path,
    pharmacyId: req.user?.id ?? null,
    fileName: file?.originalname ?? null,
    fileType: file?.mimetype ?? null,
    fileSize: file?.size ?? null,
    revisionDate: typeof revisionDateRaw === 'string' ? revisionDateRaw : null,
  };
}

function sanitizeLogValue(value: unknown, maxLength: number = 160): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value)
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  if (!str) return null;
  return str.slice(0, maxLength);
}

function logImportFailure(
  action: 'drug_master_sync' | 'drug_master_package_upload',
  req: AuthRequest,
  phase: string,
  reason: string,
  extra: Record<string, unknown> = {},
): void {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  const detailParts = [
    '失敗',
    `phase=${phase}`,
    `reason=${reason}`,
  ];

  const fileName = sanitizeLogValue(file?.originalname, 120);
  if (fileName) detailParts.push(`file=${fileName}`);

  const revisionDate = sanitizeLogValue(req.body?.revisionDate, 40);
  if (revisionDate) detailParts.push(`revisionDate=${revisionDate}`);

  for (const [key, value] of Object.entries(extra)) {
    const sanitized = sanitizeLogValue(value);
    if (sanitized) {
      detailParts.push(`${key}=${sanitized}`);
    }
  }

  void writeLog(action, {
    pharmacyId: req.user?.id ?? null,
    detail: detailParts.join('|'),
    ipAddress: getClientIp(req as Request),
  });
}

const MAX_UPLOAD_SIZE = 30 * 1024 * 1024; // 30MB（MHLWファイルは大きい場合がある）
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.csv', '.xml', '.zip']);
const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'text/csv',
  'text/plain',
  'application/csv',
  'application/xml',
  'text/xml',
  'application/zip',
  'application/x-zip-compressed',
]);

const upload = createMemorySingleFileUpload({
  maxUploadSize: MAX_UPLOAD_SIZE,
  allowedExtensions: ALLOWED_EXTENSIONS,
  allowedMimeTypes: ALLOWED_MIME_TYPES,
  invalidTypeErrorMessage: 'xlsx / csv / xml / zip ファイルのみアップロードできます',
});

function resolveIntervalHours(raw: string | undefined, fallback: number = 24): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 24 * 30) {
    return fallback;
  }
  return parsed;
}

function normalizeRevisionDate(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw.trim();
  }
  return new Date().toISOString().slice(0, 10);
}

function isRevisionDateFormat(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function resolveSourceHost(sourceUrl: string): string {
  if (!sourceUrl) return '';
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return 'invalid-url';
  }
}

function buildAutoSyncStatus(
  sourceUrl: string,
  autoSyncEnabled: boolean,
  checkIntervalHours: number,
): {
  enabled: boolean;
  sourceHost: string;
  hasSourceUrl: boolean;
  checkIntervalHours: number;
  supportsManualUrlOverride: boolean;
} {
  return {
    enabled: autoSyncEnabled,
    sourceHost: resolveSourceHost(sourceUrl),
    hasSourceUrl: !!sourceUrl,
    checkIntervalHours,
    supportsManualUrlOverride: true,
  };
}

async function parseDrugMasterRows(file: Express.Multer.File, ext: string): Promise<ParsedDrugMasterRows> {
  if (ext === '.csv') {
    const csvContent = decodeCsvBuffer(file.buffer);
    return parseMhlwCsvData(csvContent);
  }
  const excelRows = await parseExcelBuffer(file.buffer);
  return parseMhlwExcelData(excelRows);
}

async function parsePackageRows(file: Express.Multer.File, ext: string): Promise<ParsedPackageRows> {
  if (ext === '.csv') {
    const csvContent = decodeCsvBuffer(file.buffer);
    return parsePackageCsvData(csvContent);
  }
  if (ext === '.xml') {
    const xmlContent = file.buffer.toString('utf-8');
    return parsePackageXmlData(xmlContent);
  }
  if (ext === '.zip') {
    return parsePackageZipData(file.buffer);
  }
  const excelRows = await parseExcelBuffer(file.buffer);
  return parsePackageExcelData(excelRows);
}

async function completeSyncLogAsFailed(syncLogId: number, errorMessage: string): Promise<void> {
  await completeSyncLog(syncLogId, 'failed', EMPTY_SYNC_RESULT, errorMessage);
}

function uploadSingleFile(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'ファイルサイズが上限(30MB)を超えています' });
        return;
      }
      res.status(400).json({ error: `アップロードエラー: ${err.message}` });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'ファイルアップロード中にエラーが発生しました' });
  });
}

// ── 薬価基準収載品目リスト同期（ファイルアップロード）──

router.post('/sync', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  let syncFailureLogged = false;
  try {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: 'ファイルが必要です' });
      return;
    }

    const revisionDate = normalizeRevisionDate(req.body.revisionDate);

    // バリデーション: 日付形式
    if (!isRevisionDateFormat(revisionDate)) {
      logImportFailure('drug_master_sync', req, 'sync', 'invalid_revision_date', { revisionDate });
      res.status(400).json({ error: '改定日は YYYY-MM-DD 形式で指定してください' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const userId = req.user!.id;

    // 同期ログ作成
    const syncLog = await createSyncLog('manual', file.originalname, userId);

    let parsedRows: ParsedDrugMasterRows;
    try {
      parsedRows = await parseDrugMasterRows(file, ext);
    } catch (parseErr) {
      logImportFailure('drug_master_sync', req, 'sync', 'parse_failed', {
        extension: ext,
        syncLogId: syncLog.id,
        error: getErrorMessage(parseErr),
      });
      await completeSyncLogAsFailed(syncLog.id, getErrorMessage(parseErr));
      res.status(400).json({ error: getErrorMessage(parseErr) });
      return;
    }

    if (parsedRows.length === 0) {
      logImportFailure('drug_master_sync', req, 'sync', 'empty_rows', {
        extension: ext,
        syncLogId: syncLog.id,
      });
      await completeSyncLogAsFailed(syncLog.id, '有効なデータ行が見つかりません');
      res.status(400).json({ error: '有効なデータ行が見つかりませんでした。ファイル形式を確認してください。' });
      return;
    }

    try {
      // 同期実行
      const result = await syncDrugMaster(parsedRows, syncLog.id, revisionDate);
      await completeSyncLog(syncLog.id, 'success', result);

      await writeLog('drug_master_sync', {
        pharmacyId: userId,
        detail: `同期完了: 処理${result.itemsProcessed}件, 追加${result.itemsAdded}件, 更新${result.itemsUpdated}件, 削除${result.itemsDeleted}件`,
        ipAddress: getClientIp(req as Request),
      });

      res.json({
        message: '同期が完了しました',
        result,
        syncLogId: syncLog.id,
      });
    } catch (syncErr) {
      syncFailureLogged = true;
      logger.error('Drug master sync failed', () => ({
        ...getUploadContext(req),
        extension: ext,
        syncLogId: syncLog.id,
        error: getErrorMessage(syncErr),
        stack: syncErr instanceof Error ? syncErr.stack : undefined,
      }));
      logImportFailure('drug_master_sync', req, 'sync', 'sync_failed', {
        extension: ext,
        syncLogId: syncLog.id,
        error: getErrorMessage(syncErr),
      });
      // 同期失敗時もログを確実に閉じる
      try {
        await completeSyncLogAsFailed(syncLog.id, getErrorMessage(syncErr));
      } catch { /* ログ更新失敗は無視 */ }
      throw syncErr;
    }
  } catch (err) {
    if (!syncFailureLogged) {
      logger.error('Drug master sync route error', () => ({
        ...getUploadContext(req),
        error: getErrorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      }));
      logImportFailure('drug_master_sync', req, 'sync', 'unexpected_error', {
        error: getErrorMessage(err),
      });
    }
    res.status(500).json({ error: '同期処理中にエラーが発生しました' });
  }
});

// ── 包装単位データ登録 ────────────────────────────────

router.post('/upload-packages', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: 'ファイルが必要です' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    let parsedRows: ParsedPackageRows;

    try {
      parsedRows = await parsePackageRows(file, ext);
    } catch (parseErr) {
      logImportFailure('drug_master_package_upload', req, 'upload_packages', 'parse_failed', {
        extension: ext,
        error: getErrorMessage(parseErr),
      });
      res.status(400).json({ error: parseErr instanceof Error ? parseErr.message : 'ファイルのパースに失敗しました' });
      return;
    }

    if (parsedRows.length === 0) {
      logImportFailure('drug_master_package_upload', req, 'upload_packages', 'empty_rows', {
        extension: ext,
      });
      res.status(400).json({ error: '有効なデータ行が見つかりませんでした。' });
      return;
    }

    const result = await syncPackageData(parsedRows);

    await writeLog('drug_master_package_upload', {
      pharmacyId: req.user!.id,
      detail: `包装単位データ登録: 追加${result.added}件, 更新${result.updated}件`,
      ipAddress: getClientIp(req as Request),
    });

    res.json({
      message: '包装単位データの登録が完了しました',
      result,
    });
  } catch (err) {
    logger.error('Drug package upload error', () => ({
      ...getUploadContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    logImportFailure('drug_master_package_upload', req, 'upload_packages', 'unexpected_error', {
      error: getErrorMessage(err),
    });
    res.status(500).json({ error: '包装単位データの登録中にエラーが発生しました' });
  }
});

// ── 同期ログ一覧 ─────────────────────────────────

router.get('/sync-logs', async (_req: AuthRequest, res: Response) => {
  try {
    const logs = await getSyncLogs(30);
    res.json({ data: logs });
  } catch (err) {
    logger.error('Sync logs error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '同期ログの取得に失敗しました' });
  }
});

// ── 自動取得トリガー（URL設定済みの場合のサイト更新検知＆同期）──

router.post('/auto-sync', async (req: AuthRequest, res: Response) => {
  try {
    const sourceUrl = typeof req.body?.sourceUrl === 'string'
      ? req.body.sourceUrl.trim()
      : '';
    const sourceMode: SourceMode | undefined = req.body?.sourceMode === 'single' ? 'single' : undefined;
    const result = await triggerManualAutoSync({ sourceUrl: sourceUrl || null, sourceMode });

    if (result.triggered) {
      await writeLog('drug_master_sync', {
        pharmacyId: req.user!.id,
        detail: sourceUrl ? '自動取得を手動トリガー（sourceUrl指定）' : '自動取得を手動トリガー',
        ipAddress: getClientIp(req as Request),
      });
    }

    res.json(result);
  } catch (err) {
    logger.error('Auto-sync trigger error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '自動取得の開始に失敗しました' });
  }
});

// ── 自動取得設定状況 ──

router.get('/auto-sync/status', async (_req: AuthRequest, res: Response) => {
  try {
    const sourceUrl = process.env.DRUG_MASTER_SOURCE_URL || '';
    const autoSyncEnabled = process.env.DRUG_MASTER_AUTO_SYNC === 'true';
    const checkIntervalHours = resolveIntervalHours(process.env.DRUG_MASTER_CHECK_INTERVAL_HOURS, 24);
    const sourceMode = getConfiguredSourceMode();

    const baseStatus = buildAutoSyncStatus(sourceUrl, autoSyncEnabled, checkIntervalHours);

    // index モードの場合、発見済みファイル情報を追加
    let discoveredFiles: { category: string; url: string; lastChanged: string | null }[] | undefined;
    let lastIndexCheck: string | undefined;

    if (sourceMode === 'index') {
      const states = await getSourceStatesByPrefix('drug:');
      const indexState = states.find((s) => s.sourceKey === 'drug:index_page');
      lastIndexCheck = indexState?.lastCheckedAt ?? undefined;

      discoveredFiles = states
        .filter((s) => s.sourceKey.startsWith('drug:file:'))
        .map((s) => ({
          category: s.sourceKey.replace('drug:file:', ''),
          url: s.url,
          lastChanged: s.lastChangedAt,
        }));
    }

    res.json({
      ...baseStatus,
      sourceMode,
      discoveredFiles,
      lastIndexCheck,
    });
  } catch (err) {
    logger.error('Auto-sync status error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '設定状況の取得に失敗しました' });
  }
});

// ── 包装単位データの自動取得トリガー ──

router.post('/auto-sync/packages', async (req: AuthRequest, res: Response) => {
  try {
    const sourceUrl = typeof req.body?.sourceUrl === 'string'
      ? req.body.sourceUrl.trim()
      : '';
    const result = await triggerManualPackageAutoSync({ sourceUrl: sourceUrl || null });

    if (result.triggered) {
      await writeLog('drug_master_package_upload', {
        pharmacyId: req.user!.id,
        detail: sourceUrl
          ? '包装単位データ自動取得を手動トリガー（sourceUrl指定）'
          : '包装単位データ自動取得を手動トリガー',
        ipAddress: getClientIp(req as Request),
      });
    }

    res.json(result);
  } catch (err) {
    logger.error('Package auto-sync trigger error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '包装単位データ自動取得の開始に失敗しました' });
  }
});

router.get('/auto-sync/packages/status', async (_req: AuthRequest, res: Response) => {
  try {
    const sourceUrl = process.env.DRUG_PACKAGE_SOURCE_URL || '';
    const autoSyncEnabled = process.env.DRUG_PACKAGE_AUTO_SYNC === 'true';
    const checkIntervalHours = resolveIntervalHours(process.env.DRUG_PACKAGE_CHECK_INTERVAL_HOURS, 24);

    res.json(buildAutoSyncStatus(sourceUrl, autoSyncEnabled, checkIntervalHours));
  } catch (err) {
    logger.error('Package auto-sync status error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '包装単位データ自動取得設定の取得に失敗しました' });
  }
});

export default router;
