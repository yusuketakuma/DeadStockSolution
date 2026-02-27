import { Router, Response } from 'express';
import { eq, and, type InferInsertModel } from 'drizzle-orm';
import { db } from '../config/database';
import { uploads, deadStockItems, usedMedicationItems, columnMappingTemplates } from '../db/schema';
import { AuthRequest } from '../types';
import { detectHeaderRow, computeHeaderHash } from '../services/column-mapper';
import { getPreviewRows } from '../services/upload-service';
import { extractDeadStockRows, extractUsedMedicationRows } from '../services/data-extractor';
import { enrichWithDrugMaster } from '../services/drug-master-enrichment';
import { logger } from '../services/logger';
import { triggerMatchingRefreshOnUpload } from '../services/matching-refresh-service';
import {
  applyDeadStockDiff,
  applyUsedMedicationDiff,
  previewDeadStockDiff,
  previewUsedMedicationDiff,
} from '../services/upload-diff-service';
import {
  getBaseContext,
  getErrorMessage,
  logUploadFailure,
  uploadSingleFile,
  parseMapping,
  getUploadFileOrReject,
  getUploadTypeOrReject,
  parseExcelRowsOrReject,
  parseHeaderRowIndexOrReject,
  resolveMappingFromTemplate,
  INSERT_BATCH_SIZE,
} from './upload-validation';

const router = Router();

type ApplyMode = 'replace' | 'diff';

type DeadStockInsertRow = InferInsertModel<typeof deadStockItems>;
type UsedMedicationInsertRow = InferInsertModel<typeof usedMedicationItems>;
type DrugMasterLinkFields = Pick<DeadStockInsertRow, 'drugMasterId' | 'drugMasterPackageId' | 'packageLabel'>;

interface DeadStockInsertSource extends DrugMasterLinkFields {
  drugCode: string | null;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number | null;
  yakkaTotal: number | null;
  expirationDate: string | null;
  lotNumber: string | null;
}

interface UsedMedicationInsertSource extends DrugMasterLinkFields {
  drugCode: string | null;
  drugName: string;
  monthlyUsage: number | null;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

function parseApplyMode(raw: unknown): ApplyMode | null {
  if (raw === undefined || raw === null || raw === '') return 'replace';
  if (raw === 'replace') return 'replace';
  if (raw === 'diff') return 'diff';
  return null;
}

function parseDeleteMissing(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw === 'true' || raw === '1';
  return false;
}

function toNumericText(value: number | null): string | null {
  return value !== null ? String(value) : null;
}

function normalizeExpirationDateIso(expirationDate: string | null): string | null {
  if (typeof expirationDate !== 'string') return null;
  const normalized = expirationDate.replace(/\//g, '-').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function extractDrugMasterLinkFields(item: DrugMasterLinkFields): DrugMasterLinkFields {
  return {
    drugMasterId: item.drugMasterId ?? null,
    drugMasterPackageId: item.drugMasterPackageId ?? null,
    packageLabel: item.packageLabel ?? null,
  };
}

function toDeadStockInsertRow(
  pharmacyId: number,
  uploadId: number,
  item: DeadStockInsertSource,
): DeadStockInsertRow {
  return {
    pharmacyId,
    uploadId,
    drugCode: item.drugCode,
    drugName: item.drugName,
    ...extractDrugMasterLinkFields(item),
    quantity: item.quantity,
    unit: item.unit,
    yakkaUnitPrice: toNumericText(item.yakkaUnitPrice),
    yakkaTotal: toNumericText(item.yakkaTotal),
    expirationDate: item.expirationDate,
    expirationDateIso: normalizeExpirationDateIso(item.expirationDate),
    lotNumber: item.lotNumber,
  };
}

function toUsedMedicationInsertRow(
  pharmacyId: number,
  uploadId: number,
  item: UsedMedicationInsertSource,
): UsedMedicationInsertRow {
  return {
    pharmacyId,
    uploadId,
    drugCode: item.drugCode,
    drugName: item.drugName,
    ...extractDrugMasterLinkFields(item),
    monthlyUsage: item.monthlyUsage,
    unit: item.unit,
    yakkaUnitPrice: toNumericText(item.yakkaUnitPrice),
  };
}

async function insertInBatches(
  totalCount: number,
  insertBatch: (start: number, end: number) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < totalCount; i += INSERT_BATCH_SIZE) {
    await insertBatch(i, i + INSERT_BATCH_SIZE);
  }
}

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

// Diff preview: compare incoming rows with current rows without writing DB.
router.post('/diff-preview', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  try {
    const uploadFile = getUploadFileOrReject(req, res);
    if (!uploadFile) return;

    const uploadType = getUploadTypeOrReject(req, res);
    if (!uploadType) return;

    const applyMode = parseApplyMode(req.body.applyMode);
    if (!applyMode) {
      res.status(400).json({ error: 'applyMode は replace か diff を指定してください' });
      return;
    }

    if (applyMode !== 'diff') {
      res.status(400).json({ error: '差分プレビューは applyMode=diff のときのみ利用できます' });
      return;
    }

    let mapping;
    try {
      mapping = parseMapping(req.body.mapping, uploadType);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'mapping形式が不正です' });
      return;
    }

    const headerRowIndex = parseHeaderRowIndexOrReject(req, res);
    if (headerRowIndex === null) return;

    const allRows = await parseExcelRowsOrReject(req, res, 'preview', uploadFile.buffer);
    if (!allRows) return;
    if (headerRowIndex >= allRows.length) {
      res.status(400).json({ error: 'ヘッダー行指定が不正です' });
      return;
    }

    const dataStartIndex = headerRowIndex + 1;
    const deleteMissing = parseDeleteMissing(req.body.deleteMissing);
    const pharmacyId = req.user!.id;

    const deadStockExtracted = uploadType === 'dead_stock'
      ? extractDeadStockRows(allRows, mapping, dataStartIndex)
      : null;
    const usedMedicationExtracted = uploadType === 'used_medication'
      ? extractUsedMedicationRows(allRows, mapping, dataStartIndex)
      : null;

    const enrichedDeadStock = deadStockExtracted
      ? await enrichWithDrugMaster(deadStockExtracted, 'dead_stock')
      : null;
    const enrichedUsedMedication = usedMedicationExtracted
      ? await enrichWithDrugMaster(usedMedicationExtracted, 'used_medication')
      : null;

    const summary = uploadType === 'dead_stock'
      ? await previewDeadStockDiff(pharmacyId, (enrichedDeadStock ?? deadStockExtracted) ?? [], { deleteMissing })
      : await previewUsedMedicationDiff(pharmacyId, (enrichedUsedMedication ?? usedMedicationExtracted) ?? [], { deleteMissing });

    res.json({
      applyMode: 'diff',
      uploadType,
      deleteMissing,
      summary,
    });
  } catch (err) {
    logger.error('Upload diff preview error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    res.status(500).json({ error: '差分プレビューの生成に失敗しました' });
  }
});

// Confirm: re-parse file with confirmed mapping, extract data, save to DB
router.post('/confirm', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  try {
    const uploadFile = getUploadFileOrReject(req, res);
    if (!uploadFile) return;

    const uploadType = getUploadTypeOrReject(req, res);
    if (!uploadType) return;

    const applyMode = parseApplyMode(req.body.applyMode);
    if (!applyMode) {
      logUploadFailure(req, 'confirm', 'invalid_apply_mode', {
        applyMode: String(req.body.applyMode ?? ''),
      });
      res.status(400).json({ error: 'applyMode は replace か diff を指定してください' });
      return;
    }

    let mapping;
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
    const deleteMissing = parseDeleteMissing(req.body.deleteMissing);
    const headerHash = computeHeaderHash(headerRow);
    const deadStockExtracted = uploadType === 'dead_stock'
      ? extractDeadStockRows(allRows, mapping, dataStartIndex)
      : null;
    const usedMedicationExtracted = uploadType === 'used_medication'
      ? extractUsedMedicationRows(allRows, mapping, dataStartIndex)
      : null;
    const parsedRowCount = deadStockExtracted?.length ?? usedMedicationExtracted?.length ?? 0;

    // 医薬品マスターから薬価・情報を自動補完
    const enrichedDeadStock = deadStockExtracted
      ? await enrichWithDrugMaster(deadStockExtracted, 'dead_stock')
      : null;
    const enrichedUsedMedication = usedMedicationExtracted
      ? await enrichWithDrugMaster(usedMedicationExtracted, 'used_medication')
      : null;

    const { uploadId, diffSummary, rowCount } = await db.transaction(async (tx) => {
      const [uploadRecord] = await tx.insert(uploads).values({
        pharmacyId,
        uploadType,
        originalFilename: uploadFile.originalname,
        columnMapping: JSON.stringify(mapping),
        rowCount: 0,
      }).returning({ id: uploads.id });

      let diffSummary: {
        inserted: number;
        updated: number;
        deactivated: number;
        unchanged: number;
        totalIncoming: number;
      } | null = null;

      if (uploadType === 'dead_stock') {
        const sourceRows = (enrichedDeadStock ?? deadStockExtracted) ?? [];
        if (applyMode === 'replace') {
          await tx.delete(deadStockItems).where(eq(deadStockItems.pharmacyId, pharmacyId));
          if (sourceRows.length > 0) {
            const insertRows = sourceRows.map((item) =>
              toDeadStockInsertRow(pharmacyId, uploadRecord.id, item)
            );

            await insertInBatches(insertRows.length, async (start, end) =>
              tx.insert(deadStockItems).values(insertRows.slice(start, end))
            );
          }
        } else {
          diffSummary = await applyDeadStockDiff(tx, pharmacyId, uploadRecord.id, sourceRows, { deleteMissing });
        }
      } else {
        const sourceRows = (enrichedUsedMedication ?? usedMedicationExtracted) ?? [];
        if (applyMode === 'replace') {
          await tx.delete(usedMedicationItems).where(eq(usedMedicationItems.pharmacyId, pharmacyId));
          if (sourceRows.length > 0) {
            const insertRows = sourceRows.map((item) =>
              toUsedMedicationInsertRow(pharmacyId, uploadRecord.id, item)
            );

            await insertInBatches(insertRows.length, async (start, end) =>
              tx.insert(usedMedicationItems).values(insertRows.slice(start, end))
            );
          }
        } else {
          diffSummary = await applyUsedMedicationDiff(tx, pharmacyId, uploadRecord.id, sourceRows, { deleteMissing });
        }
      }

      const persistedRowCount = applyMode === 'diff'
        ? diffSummary?.totalIncoming ?? parsedRowCount
        : parsedRowCount;

      await tx.update(uploads)
        .set({ rowCount: persistedRowCount })
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

      await triggerMatchingRefreshOnUpload({
        triggerPharmacyId: pharmacyId,
        uploadType,
      }, tx);

      return { uploadId: uploadRecord.id, diffSummary, rowCount: persistedRowCount };
    });

    res.json({
      message: `${rowCount}件のデータを登録しました`,
      uploadId,
      rowCount,
      applyMode,
      deleteMissing: applyMode === 'diff' ? deleteMissing : undefined,
      diffSummary: applyMode === 'diff' ? diffSummary : undefined,
    });
  } catch (err) {
    logger.error('Upload confirm error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    logUploadFailure(req, 'confirm', 'unexpected_error', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'データ登録またはマッチング更新に失敗しました' });
  }
});

export default router;
