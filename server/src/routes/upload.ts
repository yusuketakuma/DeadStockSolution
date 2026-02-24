import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { eq, and, gte, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { uploads, deadStockItems, usedMedicationItems, columnMappingTemplates } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest, ColumnMapping, DEAD_STOCK_FIELDS, USED_MEDICATION_FIELDS } from '../types';
import { parseExcelBuffer, getPreviewRows } from '../services/upload-service';
import { detectHeaderRow, suggestMapping, computeHeaderHash } from '../services/column-mapper';
import { extractDeadStockRows, extractUsedMedicationRows } from '../services/data-extractor';
import { enrichWithDrugMaster } from '../services/drug-master-enrichment';

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
const DEAD_STOCK_FIELD_SET = new Set<string>(DEAD_STOCK_FIELDS);
const USED_MEDICATION_FIELD_SET = new Set<string>(USED_MEDICATION_FIELDS);

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
        res.status(400).json({ error: `ファイルサイズは${MAX_UPLOAD_SIZE / (1024 * 1024)}MB以下にしてください` });
        return;
      }
      res.status(400).json({ error: 'アップロードに失敗しました' });
      return;
    }

    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }

    res.status(400).json({ error: 'アップロードに失敗しました' });
  });
}

function parseMapping(raw: unknown, uploadType: 'dead_stock' | 'used_medication'): ColumnMapping {
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

router.use(requireLogin);

// Upload status - check if current month uploads exist
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [deadStockUploads, usedMedUploads, lastDeadStock, lastUsedMed] = await Promise.all([
      db.select({ id: uploads.id, createdAt: uploads.createdAt })
        .from(uploads)
        .where(and(
          eq(uploads.pharmacyId, pharmacyId),
          eq(uploads.uploadType, 'dead_stock'),
        ))
        .orderBy(desc(uploads.createdAt))
        .limit(1),
      db.select({ id: uploads.id, createdAt: uploads.createdAt })
        .from(uploads)
        .where(and(
          eq(uploads.pharmacyId, pharmacyId),
          eq(uploads.uploadType, 'used_medication'),
          gte(uploads.createdAt, firstOfMonth),
        ))
        .orderBy(desc(uploads.createdAt))
        .limit(1),
      db.select({ createdAt: uploads.createdAt })
        .from(uploads)
        .where(and(
          eq(uploads.pharmacyId, pharmacyId),
          eq(uploads.uploadType, 'dead_stock'),
        ))
        .orderBy(desc(uploads.createdAt))
        .limit(1),
      db.select({ createdAt: uploads.createdAt })
        .from(uploads)
        .where(and(
          eq(uploads.pharmacyId, pharmacyId),
          eq(uploads.uploadType, 'used_medication'),
        ))
        .orderBy(desc(uploads.createdAt))
        .limit(1),
    ]);

    res.json({
      deadStockUploaded: deadStockUploads.length > 0,
      usedMedicationUploaded: usedMedUploads.length > 0,
      lastDeadStockUpload: lastDeadStock[0]?.createdAt ?? null,
      lastUsedMedicationUpload: lastUsedMed[0]?.createdAt ?? null,
    });
  } catch (err) {
    console.error('Upload status error:', err);
    res.status(500).json({ error: 'ステータスの取得に失敗しました' });
  }
});

// Preview: parse file and return headers + first 5 rows + suggested mapping
router.post('/preview', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'ファイルが選択されていません' });
      return;
    }

    const uploadType = req.body.uploadType as 'dead_stock' | 'used_medication';
    if (!uploadType || !['dead_stock', 'used_medication'].includes(uploadType)) {
      res.status(400).json({ error: 'アップロードタイプを指定してください' });
      return;
    }

    let allRows: unknown[][];
    try {
      allRows = await parseExcelBuffer(req.file.buffer);
    } catch {
      res.status(400).json({ error: 'ファイルの解析に失敗しました。xlsx形式を確認してください' });
      return;
    }

    if (allRows.length === 0) {
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

    let mapping;
    if (savedTemplates.length > 0) {
      try {
        mapping = parseMapping(savedTemplates[0].mapping, uploadType);
      } catch {
        mapping = suggestMapping(headerRow, uploadType);
      }
    } else {
      mapping = suggestMapping(headerRow, uploadType);
    }

    res.json({
      headers: headerRow.map((h) => String(h || '')),
      rows: previewRows.map((row) => row.map((cell) => String(cell ?? ''))),
      suggestedMapping: mapping,
      headerRowIndex,
      hasSavedMapping: savedTemplates.length > 0,
    });
  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).json({ error: 'ファイルの解析に失敗しました' });
  }
});

// Confirm: re-parse file with confirmed mapping, extract data, save to DB
router.post('/confirm', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'ファイルが選択されていません' });
      return;
    }
    const uploadFile = req.file;

    const uploadType = req.body.uploadType as 'dead_stock' | 'used_medication';
    if (!uploadType || !['dead_stock', 'used_medication'].includes(uploadType)) {
      res.status(400).json({ error: 'アップロードタイプを指定してください' });
      return;
    }

    let mapping: ColumnMapping;
    try {
      mapping = parseMapping(req.body.mapping, uploadType);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'mapping形式が不正です' });
      return;
    }

    const headerRowRaw = typeof req.body.headerRowIndex === 'string'
      ? req.body.headerRowIndex.trim()
      : '';
    if (!/^\d+$/.test(headerRowRaw)) {
      res.status(400).json({ error: 'ヘッダー行指定が不正です' });
      return;
    }
    const headerRowIndex = Number(headerRowRaw);
    if (!Number.isSafeInteger(headerRowIndex)) {
      res.status(400).json({ error: 'ヘッダー行指定が不正です' });
      return;
    }

    let allRows: unknown[][];
    try {
      allRows = await parseExcelBuffer(uploadFile.buffer);
    } catch {
      res.status(400).json({ error: 'ファイルの解析に失敗しました。xlsx形式を確認してください' });
      return;
    }

    if (headerRowIndex >= allRows.length) {
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
            quantity: item.quantity,
            unit: item.unit,
            yakkaUnitPrice: item.yakkaUnitPrice,
            yakkaTotal: item.yakkaTotal,
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
            monthlyUsage: item.monthlyUsage,
            unit: item.unit,
            yakkaUnitPrice: item.yakkaUnitPrice,
          }));

          for (let i = 0; i < insertRows.length; i += INSERT_BATCH_SIZE) {
            await tx.insert(usedMedicationItems).values(insertRows.slice(i, i + INSERT_BATCH_SIZE));
          }
        }
      }

      await tx.update(uploads)
        .set({ rowCount })
        .where(eq(uploads.id, uploadRecord.id));

      const existingTemplate = await tx.select({ id: columnMappingTemplates.id })
        .from(columnMappingTemplates)
        .where(and(
          eq(columnMappingTemplates.pharmacyId, pharmacyId),
          eq(columnMappingTemplates.uploadType, uploadType),
          eq(columnMappingTemplates.headerHash, headerHash),
        ))
        .limit(1);

      if (existingTemplate.length > 0) {
        await tx.update(columnMappingTemplates)
          .set({ mapping: JSON.stringify(mapping) })
          .where(eq(columnMappingTemplates.id, existingTemplate[0].id));
      } else {
        await tx.insert(columnMappingTemplates).values({
          pharmacyId,
          uploadType,
          headerHash,
          mapping: JSON.stringify(mapping),
        });
      }

      return { uploadId: uploadRecord.id };
    });

    res.json({
      message: `${rowCount}件のデータを登録しました`,
      uploadId,
      rowCount,
    });
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: 'データの登録に失敗しました' });
  }
});

export default router;
