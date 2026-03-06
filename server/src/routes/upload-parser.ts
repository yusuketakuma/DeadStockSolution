import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { detectHeaderRow, computeHeaderHash, detectUploadType } from '../services/column-mapper';
import { getPreviewRows } from '../services/upload-service';
import { extractDeadStockRows, extractUsedMedicationRows } from '../services/data-extractor';
import { enrichWithDrugMaster } from '../services/drug-master-enrichment';
import { logger } from '../services/logger';
import {
  previewDeadStockDiff,
  previewUsedMedicationDiff,
} from '../services/upload-diff-service';
import {
  cancelUploadConfirmJobForPharmacy,
  enqueueUploadConfirmJob,
  getUploadConfirmJobForPharmacy,
  isUploadConfirmIdempotencyConflictError,
  isUploadConfirmQueueLimitError,
} from '../services/upload-confirm-job-service';
import { runUploadConfirm } from '../services/upload-confirm-service';
import {
  buildUploadRowIssueCsv,
  getUploadRowIssueSummary,
  getUploadRowIssuesForJob,
} from '../services/upload-row-issue-service';
import { parsePositiveInt } from '../utils/request-utils';
import {
  getBaseContext,
  getErrorMessage,
  logUploadFailure,
  uploadSingleFile,
  parseMapping,
  getUploadFileOrReject,
  getUploadTypeOrReject,
  parseUploadType,
  parseExcelRowsOrReject,
  parseHeaderRowIndexOrReject,
  resolveMappingFromTemplate,
  resolveMappingFromTemplateWithSource,
  validateMappingAgainstHeader,
  type UploadType,
} from './upload-validation';
import {
  parseApplyMode,
  parseDeleteMissing,
  isUploadConfirmEnqueueFallbackEnabled,
  toPublicUploadJobError,
  parseIdempotencyKey,
  mapUploadTypes,
  loadMappingTemplatesByHeaderHash,
  findTemplateByUploadType,
  validateSuggestedPreviewMapping,
  buildPreviewMappings,
  resolveMappingFromRequestOrAuto,
  type MappingTemplateSnapshot,
  type SuggestedPreviewMappings,
  type ValidatedPreviewMappings,
  type UploadConfirmExecutionParams,
  type UploadConfirmJob,
} from './upload-parser-helpers';

const router = Router();


async function resolveAndValidateMappingOrReject(
  req: AuthRequest,
  res: Response,
  allRows: unknown[][],
  headerRowIndex: number,
  uploadType: UploadType,
  failureContext?: string,
): Promise<ColumnMapping | null> {
  const headerRow = allRows[headerRowIndex];
  try {
    let mapping;
    const hasExplicitMapping = typeof req.body.mapping === 'string' && req.body.mapping.trim() !== '';
    if (hasExplicitMapping) {
      mapping = parseMapping(req.body.mapping, uploadType);
    } else {
      const headerHash = computeHeaderHash(headerRow);
      const templates = await loadMappingTemplatesByHeaderHash(req.user!.id, headerHash);
      const templateForUploadType = findTemplateByUploadType(templates, uploadType);
      mapping = resolveMappingFromRequestOrAuto(
        req.body.mapping,
        uploadType,
        headerRow,
        templateForUploadType?.mapping,
      );
    }
    validateMappingAgainstHeader(mapping, headerRow);
    return mapping;
  } catch (err) {
    if (failureContext) {
      logUploadFailure(req, failureContext, 'invalid_mapping', { error: getErrorMessage(err) });
    }
    res.status(400).json({ error: err instanceof Error ? err.message : 'mapping形式が不正です' });
    return null;
  }
}

function parseJobIdOrReject(req: AuthRequest, res: Response): number | null {
  const jobId = parsePositiveInt(req.params.jobId);
  if (jobId !== null) {
    return jobId;
  }
  res.status(400).json({ error: 'jobIdが不正です' });
  return null;
}

async function loadUploadJobOrReject(
  req: AuthRequest,
  res: Response,
): Promise<{ jobId: number; row: UploadConfirmJob } | null> {
  const jobId = parseJobIdOrReject(req, res);
  if (jobId === null) return null;

  const row = await getUploadConfirmJobForPharmacy(jobId, req.user!.id);
  if (row) {
    return { jobId, row };
  }

  res.status(404).json({ error: 'ジョブが見つかりません' });
  return null;
}

// Preview: parse file and return headers + first 5 rows + suggested mapping
router.post('/preview', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  try {
    const uploadFile = getUploadFileOrReject(req, res);
    if (!uploadFile) return;
    const requestedUploadTypeRaw = req.body.uploadType;
    const requestedUploadType = parseUploadType(requestedUploadTypeRaw);
    if (
      typeof requestedUploadTypeRaw === 'string'
      && requestedUploadTypeRaw.trim() !== ''
      && requestedUploadType === null
    ) {
      res.status(400).json({ error: 'アップロードタイプを指定してください' });
      return;
    }

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

    const headerHash = computeHeaderHash(headerRow);
    const templates = await loadMappingTemplatesByHeaderHash(req.user!.id, headerHash);
    const detected = detectUploadType(allRows, headerRowIndex);
    const rememberedUploadType = templates[0]?.uploadType ?? null;
    const { suggestedByType, validatedByType } = buildPreviewMappings(templates, headerRow);

    const preferRemembered = rememberedUploadType !== null
      && (detected.confidence === 'low' || rememberedUploadType === detected.detectedType);
    const autoPrimaryType = preferRemembered ? rememberedUploadType : detected.detectedType;
    const autoFallbackType: UploadType = autoPrimaryType === 'dead_stock' ? 'used_medication' : 'dead_stock';
    const resolvedUploadType = requestedUploadType
      ?? (validatedByType[autoPrimaryType] ? autoPrimaryType : autoFallbackType);
    const mapping = validatedByType[resolvedUploadType];
    if (!mapping) {
      logUploadFailure(req, 'preview', 'auto_mapping_failed', {
        resolvedUploadType,
        detectedUploadType: detected.detectedType,
        rememberedUploadType,
      });
      res.status(400).json({ error: '医薬品列の自動判定に失敗しました。ファイルの見出しを確認してください。' });
      return;
    }
    const templateUsedForResolvedType = suggestedByType[resolvedUploadType].fromSavedTemplate;

    res.json({
      headers: headerRow.map((h) => String(h || '')),
      rows: previewRows.map((row) => row.map((cell) => String(cell ?? ''))),
      suggestedMapping: mapping,
      suggestedMappingByType: validatedByType,
      headerRowIndex,
      hasSavedMapping: templateUsedForResolvedType,
      detectedUploadType: detected.detectedType,
      resolvedUploadType,
      rememberedUploadType,
      uploadTypeConfidence: detected.confidence,
      uploadTypeScores: detected.scores,
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
      res.status(400).json({ error: 'applyMode は replace / diff / partial を指定してください' });
      return;
    }

    if (applyMode !== 'diff') {
      res.status(400).json({ error: '差分プレビューは applyMode=diff のときのみ利用できます' });
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

    const mapping = await resolveAndValidateMappingOrReject(req, res, allRows, headerRowIndex, uploadType);
    if (!mapping) return;

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

async function handleConfirmAsyncEnqueue(
  req: AuthRequest,
  res: Response,
  routeKind: 'confirm' | 'confirm_async',
): Promise<void> {
  const confirmRequestedAt = new Date().toISOString();
  const failureContext = routeKind === 'confirm' ? 'confirm_legacy' : 'confirm_async';
  let fallbackExecutionParams: UploadConfirmExecutionParams | null = null;
  try {
    const uploadFile = getUploadFileOrReject(req, res);
    if (!uploadFile) return;

    const uploadType = getUploadTypeOrReject(req, res);
    if (!uploadType) return;

    const applyMode = parseApplyMode(req.body.applyMode);
    if (!applyMode) {
      logUploadFailure(req, failureContext, 'invalid_apply_mode', {
        applyMode: String(req.body.applyMode ?? ''),
      });
      res.status(400).json({ error: 'applyMode は replace / diff / partial を指定してください' });
      return;
    }

    const idempotencyKey = parseIdempotencyKey(req.body.idempotencyKey);
    if (idempotencyKey === undefined) {
      res.status(400).json({ error: 'idempotencyKey は 8-120文字の英数字記号（: _ - .）で指定してください' });
      return;
    }

    const headerRowIndex = parseHeaderRowIndexOrReject(req, res);
    if (headerRowIndex === null) return;

    const allRows = await parseExcelRowsOrReject(req, res, 'confirm', uploadFile.buffer);
    if (!allRows) return;

    if (headerRowIndex >= allRows.length) {
      logUploadFailure(req, failureContext, 'header_row_out_of_range', {
        headerRowIndex,
        rowCount: allRows.length,
      });
      res.status(400).json({ error: 'ヘッダー行指定が不正です' });
      return;
    }

    const mapping = await resolveAndValidateMappingOrReject(req, res, allRows, headerRowIndex, uploadType, failureContext);
    if (!mapping) return;

    const deleteMissing = parseDeleteMissing(req.body.deleteMissing);
    const pharmacyId = req.user!.id;
    const executionParams: UploadConfirmExecutionParams = {
      pharmacyId,
      uploadType,
      originalFilename: uploadFile.originalname,
      headerRowIndex,
      mapping,
      allRows,
      applyMode,
      deleteMissing,
      staleGuardCreatedAt: confirmRequestedAt,
    };
    fallbackExecutionParams = executionParams;

    const enqueueResult = await enqueueUploadConfirmJob({
      ...executionParams,
      idempotencyKey,
      fileBuffer: uploadFile.buffer,
      requestedAtIso: confirmRequestedAt,
    });

    res.status(202).json({
      message: 'アップロード処理を受け付けました',
      jobId: enqueueResult.jobId,
      status: enqueueResult.status,
      deduplicated: enqueueResult.deduplicated,
      cancelable: enqueueResult.cancelable,
      canceledAt: enqueueResult.canceledAt,
      partialSummary: null,
      errorReportAvailable: false,
      ...(routeKind === 'confirm'
        ? {
          deprecatedEndpoint: true,
          deprecationNotice: 'このエンドポイントは将来廃止予定です。/api/upload/confirm-async をご利用ください。',
        }
        : {}),
    });
  } catch (err) {
    if (isUploadConfirmIdempotencyConflictError(err)) {
      res.status(409).json({
        error: err.message,
        code: err.code,
      });
      return;
    }

    if (isUploadConfirmQueueLimitError(err)) {
      logUploadFailure(req, failureContext, 'queue_limit', {
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

    if (isUploadConfirmEnqueueFallbackEnabled()) {
      try {
        if (!fallbackExecutionParams) {
          throw new Error('fallback context is unavailable');
        }
        const executionParams = fallbackExecutionParams;
        const syncResult = await runUploadConfirm(executionParams);
        logger.warn('Upload confirm async enqueue failed, fell back to sync execution', () => ({
          ...getBaseContext(req),
          error: getErrorMessage(err),
          uploadType: executionParams.uploadType,
          applyMode: executionParams.applyMode,
        }));
        res.status(200).json({
          message: 'キュー登録に失敗したため同期処理で適用しました',
          status: 'completed_sync_fallback',
          deduplicated: false,
          cancelable: false,
          canceledAt: null,
          jobId: null,
          uploadId: syncResult.uploadId,
          rowCount: syncResult.rowCount,
          partialSummary: syncResult.partialSummary,
          errorReportAvailable: false,
        });
        return;
      } catch (fallbackErr) {
        logger.error('Upload confirm sync fallback failed', () => ({
          ...getBaseContext(req),
          enqueueError: getErrorMessage(err),
          fallbackError: getErrorMessage(fallbackErr),
          stack: fallbackErr instanceof Error ? fallbackErr.stack : undefined,
        }));
      }
    }

    logger.error('Upload confirm async enqueue error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    logUploadFailure(req, failureContext, 'unexpected_error', { error: getErrorMessage(err) });
    res.status(500).json({ error: '非同期アップロード処理の受付に失敗しました' });
  }
}

// Confirm (legacy compatibility): now delegates to async queue processing.
router.post('/confirm', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  res.set('Deprecation', 'true');
  res.set('Link', '</api/upload/confirm-async>; rel="successor-version"');
  await handleConfirmAsyncEnqueue(req, res, 'confirm');
});

// Confirm (async): enqueue background upload processing job.
router.post('/confirm-async', uploadSingleFile, async (req: AuthRequest, res: Response) => {
  await handleConfirmAsyncEnqueue(req, res, 'confirm_async');
});

router.get('/jobs/:jobId', async (req: AuthRequest, res: Response) => {
  try {
    const jobContext = await loadUploadJobOrReject(req, res);
    if (!jobContext) return;
    const { row } = jobContext;

    let result: unknown = null;
    if (row.resultJson) {
      try {
        result = JSON.parse(row.resultJson);
      } catch {
        result = null;
      }
    }

    const publicError = toPublicUploadJobError(row.lastError);

    const parsedResult = result && typeof result === 'object' ? result as Record<string, unknown> : null;
    const partialSummary = parsedResult?.partialSummary ?? null;
    const errorReportAvailable = row.issueCount > 0
      || parsedResult?.errorReportAvailable === true
      || (partialSummary !== null
        && typeof partialSummary === 'object'
        && Number((partialSummary as Record<string, unknown>).rejectedRows ?? 0) > 0);

    res.json({
      id: row.id,
      status: (row.canceledAt || row.cancelRequestedAt) ? 'canceled' : row.status,
      attempts: row.attempts,
      lastError: publicError.message,
      lastErrorCode: publicError.code,
      result,
      deduplicated: row.deduplicated,
      cancelable: row.cancelable,
      canceledAt: row.canceledAt,
      partialSummary,
      errorReportAvailable,
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

router.post('/jobs/:jobId/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const jobId = parseJobIdOrReject(req, res);
    if (jobId === null) return;

    const result = await cancelUploadConfirmJobForPharmacy(jobId, req.user!.id);
    if (!result) {
      res.status(404).json({ error: 'ジョブが見つかりません' });
      return;
    }

    if (!result.canceledAt && !result.cancelRequestedAt) {
      res.status(409).json({
        error: result.cancelable
          ? 'キャンセル要求の反映で競合しました。再度お試しください'
          : 'このジョブはキャンセルできません',
      });
      return;
    }

    res.json({
      message: result.canceledAt ? 'ジョブをキャンセルしました' : 'ジョブのキャンセルを受け付けました',
      status: result.canceledAt ? 'canceled' : result.status,
      canceledAt: result.canceledAt,
      cancelRequestedAt: result.cancelRequestedAt,
      cancelable: result.cancelable,
    });
  } catch (err) {
    logger.error('Upload confirm job cancel error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    res.status(500).json({ error: 'ジョブのキャンセルに失敗しました' });
  }
});

router.get('/jobs/:jobId/error-report', async (req: AuthRequest, res: Response) => {
  try {
    const jobContext = await loadUploadJobOrReject(req, res);
    if (!jobContext) return;
    const { jobId } = jobContext;

    const issues = await getUploadRowIssuesForJob(jobId);
    if (issues.length === 0) {
      res.status(404).json({ error: 'エラーレポートがありません' });
      return;
    }

    const format = req.query.format === 'json' ? 'json' : 'csv';
    if (format === 'json') {
      const summary = await getUploadRowIssueSummary(jobId);
      res.json({
        data: issues,
        summary,
      });
      return;
    }

    const body = buildUploadRowIssueCsv(issues);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="upload-job-${jobId}-error-report.csv"`);
    res.status(200).send(body);
  } catch (err) {
    logger.error('Upload confirm job error report error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    res.status(500).json({ error: 'エラーレポートの取得に失敗しました' });
  }
});

export default router;
