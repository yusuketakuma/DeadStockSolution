import { Router, Response } from 'express';
import { eq, and } from 'drizzle-orm';
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

      await triggerMatchingRefreshOnUpload({
        triggerPharmacyId: pharmacyId,
        uploadType,
      }, tx);

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
    res.status(500).json({ error: 'データ登録またはマッチング更新に失敗しました' });
  }
});

export default router;
