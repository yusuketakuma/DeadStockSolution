import { Router, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../config/database';
import { columnMappingTemplates } from '../db/schema';
import { AuthRequest } from '../types';
import { detectHeaderRow, computeHeaderHash } from '../services/column-mapper';
import { getPreviewRows } from '../services/upload-service';
import { extractDeadStockRows, extractUsedMedicationRows } from '../services/data-extractor';
import { enrichWithDrugMaster } from '../services/drug-master-enrichment';
import { logger } from '../services/logger';
import {
  previewDeadStockDiff,
  previewUsedMedicationDiff,
} from '../services/upload-diff-service';
import { runUploadConfirm, type ApplyMode } from '../services/upload-confirm-service';
import {
  enqueueUploadConfirmJob,
  getUploadConfirmJobForPharmacy,
  isUploadConfirmQueueLimitError,
  processUploadConfirmJobById,
} from '../services/upload-confirm-job-service';
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
} from './upload-validation';

const router = Router();

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

function shouldProcessUploadJobImmediately(): boolean {
  const raw = process.env.UPLOAD_CONFIRM_PROCESS_ON_ENQUEUE?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

function isStaleUploadSkippedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /^\[STALE_JOB_SKIPPED]/.test(err.message);
}

function resolvePrefixedJobErrorCode(rawMessage: string | null): string | null {
  if (!rawMessage) return null;
  const matched = rawMessage.match(/^\[([A-Z0-9_]+)]/);
  if (!matched?.[1]) return null;
  return matched[1];
}

function mapUploadJobErrorCode(rawMessage: string | null): string | null {
  if (!rawMessage) return null;
  const prefixedCode = resolvePrefixedJobErrorCode(rawMessage);
  if (prefixedCode) return prefixedCode;
  if (/mapping/i.test(rawMessage)) return 'MAPPING_INVALID';
  if (/ヘッダー行指定が不正/.test(rawMessage)) return 'HEADER_ROW_INVALID';
  if (/上限\(/.test(rawMessage)) return 'FILE_LIMIT_EXCEEDED';
  if (/ファイルの解析/.test(rawMessage)) return 'FILE_PARSE_FAILED';
  return 'UPLOAD_CONFIRM_FAILED';
}

function toPublicUploadJobError(rawMessage: string | null): { code: string | null; message: string | null } {
  const code = mapUploadJobErrorCode(rawMessage);
  if (!code) {
    return { code: null, message: null };
  }
  if (code === 'MAPPING_INVALID') {
    return { code, message: 'カラム割り当ての設定が不正です。設定を見直して再実行してください。' };
  }
  if (code === 'HEADER_ROW_INVALID') {
    return { code, message: 'ヘッダー行の指定が不正です。設定を見直して再実行してください。' };
  }
  if (code === 'FILE_LIMIT_EXCEEDED' || code === 'FILE_PARSE_FAILED') {
    return { code, message: 'アップロードファイルを解析できませんでした。ファイル形式と内容を確認してください。' };
  }
  if (code === 'STALE_JOB_SKIPPED') {
    return { code, message: 'より新しいアップロードが既に反映されているため、この処理はスキップされました。' };
  }
  return { code, message: 'アップロード処理に失敗しました。時間をおいて再実行してください。' };
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
  const confirmRequestedAt = new Date().toISOString();
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

    const pharmacyId = req.user!.id;
    const deleteMissing = parseDeleteMissing(req.body.deleteMissing);
    const { uploadId, diffSummary, rowCount } = await runUploadConfirm({
      pharmacyId,
      uploadType,
      originalFilename: uploadFile.originalname,
      headerRowIndex,
      mapping,
      allRows,
      applyMode,
      deleteMissing,
      staleGuardCreatedAt: confirmRequestedAt,
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
    if (isStaleUploadSkippedError(err)) {
      logUploadFailure(req, 'confirm', 'stale_upload_skipped');
      res.status(409).json({
        error: 'より新しいアップロードが既に反映されています。最新データで再度実行してください。',
        code: 'STALE_JOB_SKIPPED',
      });
      return;
    }

    logger.error('Upload confirm error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    logUploadFailure(req, 'confirm', 'unexpected_error', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'データ登録またはマッチング更新に失敗しました' });
  }
});

// Confirm (async): enqueue background upload processing job.
router.post('/confirm-async', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  try {
    const uploadFile = getUploadFileOrReject(req, res);
    if (!uploadFile) return;

    const uploadType = getUploadTypeOrReject(req, res);
    if (!uploadType) return;

    const applyMode = parseApplyMode(req.body.applyMode);
    if (!applyMode) {
      logUploadFailure(req, 'confirm_async', 'invalid_apply_mode', {
        applyMode: String(req.body.applyMode ?? ''),
      });
      res.status(400).json({ error: 'applyMode は replace か diff を指定してください' });
      return;
    }

    let mapping;
    try {
      mapping = parseMapping(req.body.mapping, uploadType);
    } catch (err) {
      logUploadFailure(req, 'confirm_async', 'invalid_mapping', { error: getErrorMessage(err) });
      res.status(400).json({ error: err instanceof Error ? err.message : 'mapping形式が不正です' });
      return;
    }

    const headerRowIndex = parseHeaderRowIndexOrReject(req, res);
    if (headerRowIndex === null) return;

    const deleteMissing = parseDeleteMissing(req.body.deleteMissing);
    const pharmacyId = req.user!.id;
    const jobId = await enqueueUploadConfirmJob({
      pharmacyId,
      uploadType,
      originalFilename: uploadFile.originalname,
      headerRowIndex,
      mapping,
      applyMode,
      deleteMissing,
      fileBuffer: uploadFile.buffer,
    });

    if (shouldProcessUploadJobImmediately()) {
      void processUploadConfirmJobById(jobId).catch((err) => {
        logger.warn('Immediate upload confirm async processing failed', {
          jobId,
          pharmacyId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    res.status(202).json({
      message: 'アップロード処理を受け付けました',
      jobId,
      status: 'pending',
    });
  } catch (err) {
    if (isUploadConfirmQueueLimitError(err)) {
      logUploadFailure(req, 'confirm_async', 'queue_limit', {
        code: err.code,
        limit: err.limit,
        activeJobs: err.activeJobs,
      });
      res.status(429).json({
        error: err.message,
        code: err.code,
        limit: err.limit,
        activeJobs: err.activeJobs,
      });
      return;
    }

    logger.error('Upload confirm async enqueue error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    logUploadFailure(req, 'confirm_async', 'unexpected_error', { error: getErrorMessage(err) });
    res.status(500).json({ error: '非同期アップロード処理の受付に失敗しました' });
  }
});

router.get('/jobs/:jobId', async (req: AuthRequest, res: Response) => {
  try {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      res.status(400).json({ error: 'jobIdが不正です' });
      return;
    }

    const row = await getUploadConfirmJobForPharmacy(jobId, req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'ジョブが見つかりません' });
      return;
    }

    let result: unknown = null;
    if (row.resultJson) {
      try {
        result = JSON.parse(row.resultJson);
      } catch {
        result = null;
      }
    }

    const publicError = toPublicUploadJobError(row.lastError);

    res.json({
      id: row.id,
      status: row.status,
      attempts: row.attempts,
      lastError: publicError.message,
      lastErrorCode: publicError.code,
      result,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
    });
  } catch (err) {
    logger.error('Upload confirm job status error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    res.status(500).json({ error: 'ジョブ状態の取得に失敗しました' });
  }
});

export default router;
