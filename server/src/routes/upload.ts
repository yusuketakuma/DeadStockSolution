import { Router, Response } from 'express';
import multer from 'multer';
import { eq, and, gte } from 'drizzle-orm';
import { db } from '../config/database';
import { uploads, deadStockItems, usedMedicationItems, columnMappingTemplates } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { parseExcelBuffer, getPreviewRows } from '../services/upload-service';
import { detectHeaderRow, suggestMapping, computeHeaderHash } from '../services/column-mapper';
import { extractDeadStockRows, extractUsedMedicationRows } from '../services/data-extractor';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireLogin);

// Upload status - check if current month uploads exist
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const deadStockUploads = await db.select({ id: uploads.id })
      .from(uploads)
      .where(and(
        eq(uploads.pharmacyId, pharmacyId),
        eq(uploads.uploadType, 'dead_stock'),
      ))
      .limit(1);

    const usedMedUploads = await db.select({ id: uploads.id })
      .from(uploads)
      .where(and(
        eq(uploads.pharmacyId, pharmacyId),
        eq(uploads.uploadType, 'used_medication'),
        gte(uploads.createdAt, firstOfMonth),
      ))
      .limit(1);

    res.json({
      deadStockUploaded: deadStockUploads.length > 0,
      usedMedicationUploaded: usedMedUploads.length > 0,
      lastDeadStockUpload: null,
      lastUsedMedicationUpload: null,
    });
  } catch (err) {
    console.error('Upload status error:', err);
    res.status(500).json({ error: 'ステータスの取得に失敗しました' });
  }
});

// Preview: parse file and return headers + first 5 rows + suggested mapping
router.post('/preview', upload.single('file'), async (req: AuthRequest, res: Response) => {
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

    const allRows = parseExcelBuffer(req.file.buffer);
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
      mapping = JSON.parse(savedTemplates[0].mapping);
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
router.post('/confirm', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'ファイルが選択されていません' });
      return;
    }

    const uploadType = req.body.uploadType as 'dead_stock' | 'used_medication';
    const mapping = JSON.parse(req.body.mapping || '{}');
    const headerRowIndex = parseInt(req.body.headerRowIndex || '0');

    if (!uploadType || !['dead_stock', 'used_medication'].includes(uploadType)) {
      res.status(400).json({ error: 'アップロードタイプを指定してください' });
      return;
    }

    const allRows = parseExcelBuffer(req.file.buffer);
    const headerRow = allRows[headerRowIndex];
    const dataRows = allRows.slice(headerRowIndex + 1);

    const pharmacyId = req.user!.id;

    // Create upload record
    const [uploadRecord] = await db.insert(uploads).values({
      pharmacyId,
      uploadType,
      originalFilename: req.file.originalname,
      columnMapping: JSON.stringify(mapping),
      rowCount: 0,
    }).returning({ id: uploads.id });

    let rowCount = 0;

    if (uploadType === 'dead_stock') {
      // Delete existing dead stock items for this pharmacy
      await db.delete(deadStockItems).where(eq(deadStockItems.pharmacyId, pharmacyId));

      const items = extractDeadStockRows(dataRows, mapping);
      rowCount = items.length;

      if (items.length > 0) {
        await db.insert(deadStockItems).values(
          items.map((item) => ({
            pharmacyId,
            uploadId: uploadRecord.id,
            drugCode: item.drugCode,
            drugName: item.drugName,
            quantity: item.quantity,
            unit: item.unit,
            yakkaUnitPrice: item.yakkaUnitPrice,
            yakkaTotal: item.yakkaTotal,
            expirationDate: item.expirationDate,
            lotNumber: item.lotNumber,
          }))
        );
      }
    } else {
      // Delete existing used medication items for this pharmacy
      await db.delete(usedMedicationItems).where(eq(usedMedicationItems.pharmacyId, pharmacyId));

      const items = extractUsedMedicationRows(dataRows, mapping);
      rowCount = items.length;

      if (items.length > 0) {
        await db.insert(usedMedicationItems).values(
          items.map((item) => ({
            pharmacyId,
            uploadId: uploadRecord.id,
            drugCode: item.drugCode,
            drugName: item.drugName,
            monthlyUsage: item.monthlyUsage,
            unit: item.unit,
            yakkaUnitPrice: item.yakkaUnitPrice,
          }))
        );
      }
    }

    // Update row count
    await db.update(uploads)
      .set({ rowCount })
      .where(eq(uploads.id, uploadRecord.id));

    // Save mapping template
    const headerHash = computeHeaderHash(headerRow);
    const existingTemplate = await db.select({ id: columnMappingTemplates.id })
      .from(columnMappingTemplates)
      .where(and(
        eq(columnMappingTemplates.pharmacyId, pharmacyId),
        eq(columnMappingTemplates.uploadType, uploadType),
        eq(columnMappingTemplates.headerHash, headerHash),
      ))
      .limit(1);

    if (existingTemplate.length > 0) {
      await db.update(columnMappingTemplates)
        .set({ mapping: JSON.stringify(mapping) })
        .where(eq(columnMappingTemplates.id, existingTemplate[0].id));
    } else {
      await db.insert(columnMappingTemplates).values({
        pharmacyId,
        uploadType,
        headerHash,
        mapping: JSON.stringify(mapping),
      });
    }

    res.json({
      message: `${rowCount}件のデータを登録しました`,
      uploadId: uploadRecord.id,
      rowCount,
    });
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: 'データの登録に失敗しました' });
  }
});

export default router;
