import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { uploads, deadStockItems, usedMedicationItems, columnMappingTemplates } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest, ColumnMapping, DEAD_STOCK_FIELDS, USED_MEDICATION_FIELDS } from '../types';
import { parseExcelBuffer, getPreviewRows } from '../services/upload-service';
import { detectHeaderRow, suggestMapping, computeHeaderHash } from '../services/column-mapper';
import { extractDeadStockRows, extractUsedMedicationRows } from '../services/data-extractor';
import { enrichWithDrugMaster } from '../services/drug-master-enrichment';
import { logger } from '../services/logger';
import { writeLog, getClientIp } from '../services/log-service';

const router = Router();
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const MAX_MAPPING_KEYS = 30;
const MAX_MAPPING_COLUMN_INDEX = 199;
const INSERT_BATCH_SIZE = 500;
const ALLOWED_EXTENSIONS = new Set(['.xlsx']);
const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);
type UploadType = 'dead_stock' | 'used_medication';
const VALID_UPLOAD_TYPES = new Set<UploadType>(['dead_stock', 'used_medication']);
const DEAD_STOCK_FIELD_SET = new Set<string>(DEAD_STOCK_FIELDS);
const USED_MEDICATION_FIELD_SET = new Set<string>(USED_MEDICATION_FIELDS);

function getBaseContext(req: Request): Record<string, unknown> {
  const authReq = req as AuthRequest;
  const uploadTypeRaw = authReq.body?.uploadType;

  return {
    path: req.path,
    pharmacyId: authReq.user?.id ?? null,
    uploadType: typeof uploadTypeRaw === 'string' ? uploadTypeRaw : null,
    fileName: authReq.file?.originalname ?? null,
    fileType: authReq.file?.mimetype ?? null,
    fileSize: authReq.file?.size ?? null,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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

function logUploadFailure(
  req: Request,
  phase: string,
  reason: string,
  extra: Record<string, unknown> = {},
): void {
  const authReq = req as AuthRequest;

  const detailParts = [
    '失敗',
    `phase=${phase}`,
    `reason=${reason}`,
  ];

  const uploadType = sanitizeLogValue(authReq.body?.uploadType, 40);
  if (uploadType) detailParts.push(`uploadType=${uploadType}`);

  const fileName = sanitizeLogValue(authReq.file?.originalname, 120);
  if (fileName) detailParts.push(`file=${fileName}`);

  for (const [key, value] of Object.entries(extra)) {
    const sanitized = sanitizeLogValue(value);
    if (sanitized) {
      detailParts.push(`${key}=${sanitized}`);
    }
  }

  void writeLog('upload', {
    pharmacyId: authReq.user?.id ?? null,
    detail: detailParts.join('|'),
    ipAddress: getClientIp(authReq),
  });
}

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
      cb(new Error('xlsxファイルのみアップロードできます'));
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
        logUploadFailure(req, 'file_upload', 'file_too_large', { code: err.code });
        res.status(400).json({ error: `ファイルサイズは${MAX_UPLOAD_SIZE / (1024 * 1024)}MB以下にしてください` });
        return;
      }
      logUploadFailure(req, 'file_upload', 'multer_error', { code: err.code, error: err.message });
      res.status(400).json({ error: 'アップロードに失敗しました' });
      return;
    }

    if (err instanceof Error) {
      logUploadFailure(req, 'file_upload', 'file_filter_rejected', { error: err.message });
      res.status(400).json({ error: err.message });
      return;
    }

    logger.warn('Upload rejected by unknown error', () => getBaseContext(req));
    logUploadFailure(req, 'file_upload', 'unknown_upload_error');
    res.status(400).json({ error: 'アップロードに失敗しました' });
  });
}

function parseMapping(raw: unknown, uploadType: UploadType): ColumnMapping {
  if (typeof raw !== 'string') {
    throw new Error('mapping形式が不正です');
  }

  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('mapping形式が不正です');
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > MAX_MAPPING_KEYS) {
    throw new Error('mappingの項目数が多すぎます');
  }

  const allowedFields = uploadType === 'dead_stock' ? DEAD_STOCK_FIELD_SET : USED_MEDICATION_FIELD_SET;
  const sanitized = Object.create(null) as ColumnMapping;
  for (const field of allowedFields) {
    sanitized[field] = null;
  }

  for (const [key, value] of entries) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    if (key.length > 50 || !allowedFields.has(key)) {
      continue;
    }

    if (value === null) {
      sanitized[key] = null;
      continue;
    }

    if (typeof value === 'string') {
      const normalized = value.trim();
      if (/^\d{1,3}$/.test(normalized)) {
        const colIdx = Number(normalized);
        if (Number.isInteger(colIdx) && colIdx >= 0 && colIdx <= MAX_MAPPING_COLUMN_INDEX) {
          sanitized[key] = normalized;
        }
      }
    }
  }

  if (!sanitized.drug_name) {
    throw new Error('薬剤名カラムの割り当てが必要です');
  }
  if (uploadType === 'dead_stock' && !sanitized.quantity) {
    throw new Error('数量カラムの割り当てが必要です');
  }

  return sanitized;
}

function parseUploadType(raw: unknown): UploadType | null {
  if (typeof raw !== 'string') return null;
  return VALID_UPLOAD_TYPES.has(raw as UploadType) ? raw as UploadType : null;
}

function getUploadFileOrReject(req: AuthRequest, res: Response): Express.Multer.File | null {
  if (!req.file) {
    res.status(400).json({ error: 'ファイルが選択されていません' });
    return null;
  }
  return req.file;
}

function getUploadTypeOrReject(req: AuthRequest, res: Response): UploadType | null {
  const uploadType = parseUploadType(req.body.uploadType);
  if (!uploadType) {
    res.status(400).json({ error: 'アップロードタイプを指定してください' });
    return null;
  }
  return uploadType;
}

async function parseExcelRowsOrReject(
  req: AuthRequest,
  res: Response,
  phase: 'preview' | 'confirm',
  fileBuffer: Buffer,
): Promise<unknown[][] | null> {
  try {
    return await parseExcelBuffer(fileBuffer);
  } catch (err) {
    logUploadFailure(req, phase, 'parse_failed', { error: getErrorMessage(err) });
    res.status(400).json({ error: 'ファイルの解析に失敗しました。xlsx形式を確認してください' });
    return null;
  }
}

function parseHeaderRowIndexOrReject(req: AuthRequest, res: Response): number | null {
  const headerRowRaw = typeof req.body.headerRowIndex === 'string'
    ? req.body.headerRowIndex.trim()
    : '';
  if (!/^\d+$/.test(headerRowRaw)) {
    logUploadFailure(req, 'confirm', 'invalid_header_row_format', { headerRowIndex: headerRowRaw });
    res.status(400).json({ error: 'ヘッダー行指定が不正です' });
    return null;
  }

  const headerRowIndex = Number(headerRowRaw);
  if (!Number.isSafeInteger(headerRowIndex)) {
    logUploadFailure(req, 'confirm', 'invalid_header_row_value', { headerRowIndex });
    res.status(400).json({ error: 'ヘッダー行指定が不正です' });
    return null;
  }

  return headerRowIndex;
}

function resolveMappingFromTemplate(
  savedMappingRaw: string | null | undefined,
  headerRow: unknown[],
  uploadType: UploadType,
): ColumnMapping {
  if (savedMappingRaw) {
    try {
      return parseMapping(savedMappingRaw, uploadType);
    } catch {
      // fallback
    }
  }
  return suggestMapping(headerRow, uploadType);
}

router.use(requireLogin);

// Upload status - check if current month uploads exist
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const lastUploadRows = await db.select({
      uploadType: uploads.uploadType,
      createdAt: sql<string | null>`max(${uploads.createdAt})`,
    })
      .from(uploads)
      .where(and(
        eq(uploads.pharmacyId, pharmacyId),
        inArray(uploads.uploadType, ['dead_stock', 'used_medication']),
      ))
      .groupBy(uploads.uploadType);

    let lastDeadStockDate: string | null = null;
    let lastUsedMedDate: string | null = null;
    for (const row of lastUploadRows) {
      if (row.uploadType === 'dead_stock') lastDeadStockDate = row.createdAt;
      if (row.uploadType === 'used_medication') lastUsedMedDate = row.createdAt;
    }

    res.json({
      deadStockUploaded: lastDeadStockDate !== null,
      usedMedicationUploaded: lastUsedMedDate !== null && lastUsedMedDate >= firstOfMonth,
      lastDeadStockUpload: lastDeadStockDate,
      lastUsedMedicationUpload: lastUsedMedDate,
    });
  } catch (err) {
    logger.error('Upload status error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    res.status(500).json({ error: 'ステータスの取得に失敗しました' });
  }
});

// Preview: parse file and return headers + first 5 rows + suggested mapping
router.post('/preview', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  try {
    const uploadFile = getUploadFileOrReject(req, res);
    if (!uploadFile) return;

    const uploadType = getUploadTypeOrReject(req, res);
    if (!uploadType) return;

    const allRows = await parseExcelRowsOrReject(req, res, 'preview', uploadFile.buffer);
    if (!allRows) return;

    if (allRows.length === 0) {
      logUploadFailure(req, 'preview', 'empty_file');
      res.status(400).json({ error: 'ファイルにデータがありません' });
      return;
    }

    const headerRowIndex = detectHeaderRow(allRows);
    const headerRow = allRows[headerRowIndex];
    const previewRows = getPreviewRows(allRows, headerRowIndex);

    // Check for saved mapping template
    const headerHash = computeHeaderHash(headerRow);
    const savedTemplates = await db.select()
      .from(columnMappingTemplates)
      .where(and(
        eq(columnMappingTemplates.pharmacyId, req.user!.id),
        eq(columnMappingTemplates.uploadType, uploadType),
        eq(columnMappingTemplates.headerHash, headerHash),
      ))
      .limit(1);

    const mapping = resolveMappingFromTemplate(savedTemplates[0]?.mapping, headerRow, uploadType);

    res.json({
      headers: headerRow.map((h) => String(h || '')),
      rows: previewRows.map((row) => row.map((cell) => String(cell ?? ''))),
      suggestedMapping: mapping,
      headerRowIndex,
      hasSavedMapping: savedTemplates.length > 0,
    });
  } catch (err) {
    logger.error('Upload preview error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    logUploadFailure(req, 'preview', 'unexpected_error', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'ファイルの解析に失敗しました' });
  }
});

// Confirm: re-parse file with confirmed mapping, extract data, save to DB
router.post('/confirm', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  try {
    const uploadFile = getUploadFileOrReject(req, res);
    if (!uploadFile) return;

    const uploadType = getUploadTypeOrReject(req, res);
    if (!uploadType) return;

    let mapping: ColumnMapping;
    try {
      mapping = parseMapping(req.body.mapping, uploadType);
    } catch (err) {
      logUploadFailure(req, 'confirm', 'invalid_mapping', { error: getErrorMessage(err) });
      res.status(400).json({ error: err instanceof Error ? err.message : 'mapping形式が不正です' });
      return;
    }

    const headerRowIndex = parseHeaderRowIndexOrReject(req, res);
    if (headerRowIndex === null) return;

    const allRows = await parseExcelRowsOrReject(req, res, 'confirm', uploadFile.buffer);
    if (!allRows) return;

    if (headerRowIndex >= allRows.length) {
      logUploadFailure(req, 'confirm', 'header_row_out_of_range', {
        headerRowIndex,
        rowCount: allRows.length,
      });
      res.status(400).json({ error: 'ヘッダー行指定が不正です' });
      return;
    }

    const headerRow = allRows[headerRowIndex];
    const dataStartIndex = headerRowIndex + 1;

    const pharmacyId = req.user!.id;
    const headerHash = computeHeaderHash(headerRow);
    const deadStockExtracted = uploadType === 'dead_stock'
      ? extractDeadStockRows(allRows, mapping, dataStartIndex)
      : null;
    const usedMedicationExtracted = uploadType === 'used_medication'
      ? extractUsedMedicationRows(allRows, mapping, dataStartIndex)
      : null;
    const rowCount = deadStockExtracted?.length ?? usedMedicationExtracted?.length ?? 0;

    // 医薬品マスターから薬価・情報を自動補完
    const enrichedDeadStock = deadStockExtracted
      ? await enrichWithDrugMaster(deadStockExtracted, 'dead_stock')
      : null;
    const enrichedUsedMedication = usedMedicationExtracted
      ? await enrichWithDrugMaster(usedMedicationExtracted, 'used_medication')
      : null;

    const { uploadId } = await db.transaction(async (tx) => {
      const [uploadRecord] = await tx.insert(uploads).values({
        pharmacyId,
        uploadType,
        originalFilename: uploadFile.originalname,
        columnMapping: JSON.stringify(mapping),
        rowCount: 0,
      }).returning({ id: uploads.id });

      if (uploadType === 'dead_stock') {
        await tx.delete(deadStockItems).where(eq(deadStockItems.pharmacyId, pharmacyId));

        const sourceRows = enrichedDeadStock ?? deadStockExtracted;
        if (sourceRows && sourceRows.length > 0) {
          const insertRows = sourceRows.map((item) => ({
            pharmacyId,
            uploadId: uploadRecord.id,
            drugCode: item.drugCode,
            drugName: item.drugName,
            drugMasterId: ('drugMasterId' in item ? (item as { drugMasterId?: number }).drugMasterId : undefined) ?? null,
            drugMasterPackageId: ('drugMasterPackageId' in item ? (item as { drugMasterPackageId?: number }).drugMasterPackageId : undefined) ?? null,
            packageLabel: ('packageLabel' in item ? (item as { packageLabel?: string | null }).packageLabel : undefined) ?? null,
            quantity: item.quantity,
            unit: item.unit,
            yakkaUnitPrice: item.yakkaUnitPrice != null ? String(item.yakkaUnitPrice) : null,
            yakkaTotal: item.yakkaTotal != null ? String(item.yakkaTotal) : null,
            expirationDate: item.expirationDate,
            lotNumber: item.lotNumber,
          }));

          for (let i = 0; i < insertRows.length; i += INSERT_BATCH_SIZE) {
            await tx.insert(deadStockItems).values(insertRows.slice(i, i + INSERT_BATCH_SIZE));
          }
        }
      } else {
        await tx.delete(usedMedicationItems).where(eq(usedMedicationItems.pharmacyId, pharmacyId));

        const sourceRows = enrichedUsedMedication ?? usedMedicationExtracted;
        if (sourceRows && sourceRows.length > 0) {
          const insertRows = sourceRows.map((item) => ({
            pharmacyId,
            uploadId: uploadRecord.id,
            drugCode: item.drugCode,
            drugName: item.drugName,
            drugMasterId: ('drugMasterId' in item ? (item as { drugMasterId?: number }).drugMasterId : undefined) ?? null,
            drugMasterPackageId: ('drugMasterPackageId' in item ? (item as { drugMasterPackageId?: number }).drugMasterPackageId : undefined) ?? null,
            packageLabel: ('packageLabel' in item ? (item as { packageLabel?: string | null }).packageLabel : undefined) ?? null,
            monthlyUsage: item.monthlyUsage,
            unit: item.unit,
            yakkaUnitPrice: item.yakkaUnitPrice != null ? String(item.yakkaUnitPrice) : null,
          }));

          for (let i = 0; i < insertRows.length; i += INSERT_BATCH_SIZE) {
            await tx.insert(usedMedicationItems).values(insertRows.slice(i, i + INSERT_BATCH_SIZE));
          }
        }
      }

      await tx.update(uploads)
        .set({ rowCount })
        .where(eq(uploads.id, uploadRecord.id));

      await tx.insert(columnMappingTemplates).values({
        pharmacyId,
        uploadType,
        headerHash,
        mapping: JSON.stringify(mapping),
      }).onConflictDoUpdate({
        target: [
          columnMappingTemplates.pharmacyId,
          columnMappingTemplates.uploadType,
          columnMappingTemplates.headerHash,
        ],
        set: {
          mapping: JSON.stringify(mapping),
        },
      });

      return { uploadId: uploadRecord.id };
    });

    res.json({
      message: `${rowCount}件のデータを登録しました`,
      uploadId,
      rowCount,
    });
  } catch (err) {
    logger.error('Upload confirm error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    logUploadFailure(req, 'confirm', 'unexpected_error', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'データの登録に失敗しました' });
  }
});

export default router;
