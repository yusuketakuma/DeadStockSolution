import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { eq, and, like, or } from 'drizzle-orm';
import { db } from '../config/database';
import { drugMaster } from '../db/schema';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { parsePagination, normalizeSearchTerm } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { writeLog, getClientIp } from '../services/log-service';
import { katakanaToHiragana, hiraganaToKatakana, normalizeKana } from '../utils/kana-utils';
import {
  parseMhlwExcelData,
  parseMhlwCsvData,
  parsePackageExcelData,
  parsePackageCsvData,
  syncDrugMaster,
  syncPackageData,
  searchDrugMaster,
  lookupByCode,
  getDrugMasterStats,
  getDrugDetail,
  getSyncLogs,
  createSyncLog,
  completeSyncLog,
  updateDrugMasterItem,
} from '../services/drug-master-service';
import { parseExcelBuffer } from '../services/upload-service';

const router = Router();

router.use(requireLogin);
router.use(requireAdmin);

const MAX_UPLOAD_SIZE = 30 * 1024 * 1024; // 30MB（MHLWファイルは大きい場合がある）
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.csv']);
const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'text/csv',
  'text/plain',
  'application/csv',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE,
    files: 1,
    fields: 10,
    fieldSize: 100 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('xlsx または csv ファイルのみアップロードできます'));
      return;
    }
    cb(null, true);
  },
});

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

// ── 統計情報 ──────────────────────────────────────

router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const stats = await getDrugMasterStats();
    res.json(stats);
  } catch (err) {
    console.error('Drug master stats error:', err);
    res.status(500).json({ error: '統計情報の取得に失敗しました' });
  }
});

// ── 一覧取得（ページネーション・検索・フィルター対応）──

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, { defaultLimit: 30, maxLimit: 100 });
    const search = normalizeSearchTerm(req.query.search);
    const statusFilter = req.query.status as string | undefined; // listed / transition / delisted / all
    const categoryFilter = normalizeSearchTerm(req.query.category);

    const conditions = [];

    // ステータスフィルター
    if (statusFilter === 'listed') {
      conditions.push(eq(drugMaster.isListed, true));
    } else if (statusFilter === 'delisted') {
      conditions.push(eq(drugMaster.isListed, false));
    } else if (statusFilter === 'transition') {
      conditions.push(and(
        eq(drugMaster.isListed, true),
        like(drugMaster.transitionDeadline, '%'), // NOT NULL
      ));
    }

    // カテゴリフィルター
    if (categoryFilter) {
      conditions.push(eq(drugMaster.category, categoryFilter));
    }

    // 検索
    if (search) {
      const normalized = normalizeKana(search);
      const hiragana = katakanaToHiragana(normalized);
      const katakana = hiraganaToKatakana(normalized);
      const likeTerms = new Set([normalized, hiragana, katakana]);
      const nameConditions = [...likeTerms].map((term) => like(drugMaster.drugName, `%${term}%`));
      const genericConditions = [...likeTerms].map((term) => like(drugMaster.genericName, `%${term}%`));
      const allSearchConditions = [...nameConditions, ...genericConditions];

      // YJコード検索
      if (/^[A-Z0-9]+$/i.test(search.trim())) {
        allSearchConditions.push(like(drugMaster.yjCode, `%${search.trim()}%`));
      }

      conditions.push(or(...allSearchConditions));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db.select({ value: rowCount })
      .from(drugMaster)
      .where(whereClause);

    const items = await db.select({
      id: drugMaster.id,
      yjCode: drugMaster.yjCode,
      drugName: drugMaster.drugName,
      genericName: drugMaster.genericName,
      specification: drugMaster.specification,
      unit: drugMaster.unit,
      yakkaPrice: drugMaster.yakkaPrice,
      manufacturer: drugMaster.manufacturer,
      category: drugMaster.category,
      isListed: drugMaster.isListed,
      transitionDeadline: drugMaster.transitionDeadline,
      updatedAt: drugMaster.updatedAt,
    })
      .from(drugMaster)
      .where(whereClause)
      .orderBy(drugMaster.drugName)
      .limit(limit)
      .offset(offset);

    res.json({
      data: items,
      pagination: {
        page,
        limit,
        total: totalResult.value,
        totalPages: Math.ceil(totalResult.value / limit),
      },
    });
  } catch (err) {
    console.error('Drug master list error:', err);
    res.status(500).json({ error: '医薬品マスターの取得に失敗しました' });
  }
});

// ── 詳細取得 ─────────────────────────────────────

router.get('/detail/:yjCode', async (req: AuthRequest, res: Response) => {
  try {
    const yjCode = String(req.params.yjCode ?? '');
    if (!yjCode || yjCode.length > 20) {
      res.status(400).json({ error: '無効なYJコードです' });
      return;
    }

    const detail = await getDrugDetail(yjCode);
    if (!detail) {
      res.status(404).json({ error: '医薬品が見つかりません' });
      return;
    }

    res.json(detail);
  } catch (err) {
    console.error('Drug master detail error:', err);
    res.status(500).json({ error: '医薬品詳細の取得に失敗しました' });
  }
});

// ── 薬価基準収載品目リスト同期（ファイルアップロード）──

router.post('/sync', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: 'ファイルが必要です' });
      return;
    }

    const revisionDate = typeof req.body.revisionDate === 'string'
      ? req.body.revisionDate.trim()
      : new Date().toISOString().slice(0, 10);

    // バリデーション: 日付形式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(revisionDate)) {
      res.status(400).json({ error: '改定日は YYYY-MM-DD 形式で指定してください' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const userId = req.user!.id;

    // 同期ログ作成
    const syncLog = await createSyncLog('manual', file.originalname, userId);

    let parsedRows;
    try {
      if (ext === '.csv') {
        const csvContent = file.buffer.toString('utf-8');
        parsedRows = parseMhlwCsvData(csvContent);
      } else {
        const excelRows = await parseExcelBuffer(file.buffer);
        parsedRows = parseMhlwExcelData(excelRows);
      }
    } catch (parseErr) {
      await completeSyncLog(syncLog.id, 'failed', { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 },
        parseErr instanceof Error ? parseErr.message : 'パースエラー');
      res.status(400).json({ error: parseErr instanceof Error ? parseErr.message : 'ファイルのパースに失敗しました' });
      return;
    }

    if (parsedRows.length === 0) {
      await completeSyncLog(syncLog.id, 'failed', { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 },
        '有効なデータ行が見つかりません');
      res.status(400).json({ error: '有効なデータ行が見つかりませんでした。ファイル形式を確認してください。' });
      return;
    }

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
  } catch (err) {
    console.error('Drug master sync error:', err);
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
    let parsedRows;

    try {
      if (ext === '.csv') {
        const csvContent = file.buffer.toString('utf-8');
        parsedRows = parsePackageCsvData(csvContent);
      } else {
        const excelRows = await parseExcelBuffer(file.buffer);
        parsedRows = parsePackageExcelData(excelRows);
      }
    } catch (parseErr) {
      res.status(400).json({ error: parseErr instanceof Error ? parseErr.message : 'ファイルのパースに失敗しました' });
      return;
    }

    if (parsedRows.length === 0) {
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
    console.error('Package upload error:', err);
    res.status(500).json({ error: '包装単位データの登録中にエラーが発生しました' });
  }
});

// ── 同期ログ一覧 ─────────────────────────────────

router.get('/sync-logs', async (_req: AuthRequest, res: Response) => {
  try {
    const logs = await getSyncLogs(30);
    res.json({ data: logs });
  } catch (err) {
    console.error('Sync logs error:', err);
    res.status(500).json({ error: '同期ログの取得に失敗しました' });
  }
});

// ── 個別編集 ─────────────────────────────────────

router.put('/detail/:yjCode', async (req: AuthRequest, res: Response) => {
  try {
    const yjCode = String(req.params.yjCode ?? '');
    if (!yjCode || yjCode.length > 20) {
      res.status(400).json({ error: '無効なYJコードです' });
      return;
    }

    const body = req.body;
    const updates: Record<string, unknown> = {};

    if (typeof body.drugName === 'string' && body.drugName.trim()) {
      updates.drugName = body.drugName.trim().slice(0, 500);
    }
    if (body.genericName !== undefined) {
      updates.genericName = typeof body.genericName === 'string' ? body.genericName.trim().slice(0, 500) || null : null;
    }
    if (body.specification !== undefined) {
      updates.specification = typeof body.specification === 'string' ? body.specification.trim().slice(0, 200) || null : null;
    }
    if (body.unit !== undefined) {
      updates.unit = typeof body.unit === 'string' ? body.unit.trim().slice(0, 50) || null : null;
    }
    if (typeof body.yakkaPrice === 'number' && body.yakkaPrice >= 0) {
      updates.yakkaPrice = body.yakkaPrice;
    }
    if (body.manufacturer !== undefined) {
      updates.manufacturer = typeof body.manufacturer === 'string' ? body.manufacturer.trim().slice(0, 200) || null : null;
    }
    if (typeof body.isListed === 'boolean') {
      updates.isListed = body.isListed;
    }
    if (body.transitionDeadline !== undefined) {
      updates.transitionDeadline = typeof body.transitionDeadline === 'string' ? body.transitionDeadline.trim() || null : null;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: '更新するフィールドが指定されていません' });
      return;
    }

    const updated = await updateDrugMasterItem(yjCode, updates as Parameters<typeof updateDrugMasterItem>[1]);
    if (!updated) {
      res.status(404).json({ error: '医薬品が見つかりません' });
      return;
    }

    await writeLog('drug_master_edit', {
      pharmacyId: req.user!.id,
      detail: `医薬品マスター編集: ${yjCode} ${updated.drugName}`,
      ipAddress: getClientIp(req as Request),
    });

    res.json(updated);
  } catch (err) {
    console.error('Drug master update error:', err);
    res.status(500).json({ error: '医薬品の更新に失敗しました' });
  }
});

export default router;
