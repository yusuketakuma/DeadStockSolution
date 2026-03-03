import { Router, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { columnMappingTemplates } from '../db/schema';
import { AuthRequest, ColumnMapping } from '../types';
import { detectHeaderRow, computeHeaderHash, detectUploadType } from '../services/column-mapper';
import { getPreviewRows } from '../services/upload-service';
import { extractDeadStockRows, extractUsedMedicationRows } from '../services/data-extractor';
import { enrichWithDrugMaster } from '../services/drug-master-enrichment';
import { logger } from '../services/logger';
import {
  previewDeadStockDiff,
  previewUsedMedicationDiff,
} from '../services/upload-diff-service';
import { type ApplyMode } from '../services/upload-confirm-service';
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

const router = Router();

function parseApplyMode(raw: unknown): ApplyMode | null {
  if (raw === undefined || raw === null || raw === '') return 'replace';
  if (raw === 'replace') return 'replace';
  if (raw === 'diff') return 'diff';
  if (raw === 'partial') return 'partial';
  return null;
}

function parseDeleteMissing(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw === 'true' || raw === '1';
  return false;
}

function isUploadConfirmEnqueueFallbackEnabled(): boolean {
  const raw = process.env.UPLOAD_CONFIRM_FALLBACK_SYNC_ON_ENQUEUE_ERROR;
  return raw === '1' || raw === 'true';
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
  if (/キャンセル/.test(rawMessage)) return 'JOB_CANCELED';
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
  if (code === 'JOB_CANCELED') {
    return { code, message: 'このジョブは管理者によりキャンセルされました。' };
  }
  return { code, message: 'アップロード処理に失敗しました。時間をおいて再実行してください。' };
}

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9:_.-]{8,120}$/;

function parseIdempotencyKey(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) return undefined;
  return normalized;
}

interface MappingTemplateSnapshot {
  uploadType: UploadType;
  mapping: string;
  createdAt: string | null;
}

async function loadMappingTemplatesByHeaderHash(
  pharmacyId: number,
  headerHash: string,
): Promise<MappingTemplateSnapshot[]> {
  return db.select({
    uploadType: columnMappingTemplates.uploadType,
    mapping: columnMappingTemplates.mapping,
    createdAt: columnMappingTemplates.createdAt,
  })
    .from(columnMappingTemplates)
    .where(and(
      eq(columnMappingTemplates.pharmacyId, pharmacyId),
      eq(columnMappingTemplates.headerHash, headerHash),
    ))
    .orderBy(desc(columnMappingTemplates.createdAt), desc(columnMappingTemplates.id));
}

function findTemplateByUploadType(
  templates: MappingTemplateSnapshot[],
  uploadType: UploadType,
): MappingTemplateSnapshot | undefined {
  return templates.find((template) => template.uploadType === uploadType);
}

function resolveMappingFromRequestOrAuto(
  rawMapping: unknown,
  uploadType: UploadType,
  headerRow: unknown[],
  savedMappingRaw: string | null | undefined,
): ReturnType<typeof parseMapping> {
  if (typeof rawMapping === 'string' && rawMapping.trim() !== '') {
    return parseMapping(rawMapping, uploadType);
  }

  const suggestedMapping = resolveMappingFromTemplate(savedMappingRaw, headerRow, uploadType);
  try {
    return parseMapping(JSON.stringify(suggestedMapping), uploadType);
  } catch {
    throw new Error('医薬品列の自動判定に失敗しました。ファイルの見出しを確認してください。');
  }
}

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
    const templateByType = {
      dead_stock: findTemplateByUploadType(templates, 'dead_stock'),
      used_medication: findTemplateByUploadType(templates, 'used_medication'),
    } as const;

    const suggestedByType = {
      dead_stock: resolveMappingFromTemplateWithSource(templateByType.dead_stock?.mapping, headerRow, 'dead_stock'),
      used_medication: resolveMappingFromTemplateWithSource(templateByType.used_medication?.mapping, headerRow, 'used_medication'),
    } as const;

    const validatedByType = {
      dead_stock: (() => {
        try {
          const parsed = parseMapping(JSON.stringify(suggestedByType.dead_stock.mapping), 'dead_stock');
          validateMappingAgainstHeader(parsed, headerRow);
          return parsed;
        } catch {
          return null;
        }
      })(),
      used_medication: (() => {
        try {
          const parsed = parseMapping(JSON.stringify(suggestedByType.used_medication.mapping), 'used_medication');
          validateMappingAgainstHeader(parsed, headerRow);
          return parsed;
        } catch {
          return null;
        }
      })(),
    } as const;

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
  let fallbackExecutionParams: Parameters<typeof runUploadConfirm>[0] | null = null;
  let fallbackUploadType: UploadType | null = null;
  let fallbackApplyMode: ApplyMode | null = null;
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
    const executionParams = {
      pharmacyId,
      uploadType,
      originalFilename: uploadFile.originalname,
      headerRowIndex,
      mapping,
      allRows,
      applyMode: applyMode as ApplyMode,
      deleteMissing,
      staleGuardCreatedAt: confirmRequestedAt,
    };
    fallbackExecutionParams = executionParams;
    fallbackUploadType = uploadType;
    fallbackApplyMode = applyMode;

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
        if (!fallbackExecutionParams || !fallbackUploadType || !fallbackApplyMode) {
          throw new Error('fallback context is unavailable');
        }
        const syncResult = await runUploadConfirm(fallbackExecutionParams);
        logger.warn('Upload confirm async enqueue failed, fell back to sync execution', () => ({
          ...getBaseContext(req),
          error: getErrorMessage(err),
          uploadType: fallbackUploadType,
          applyMode: fallbackApplyMode,
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
    const jobId = parsePositiveInt(req.params.jobId);
    if (jobId === null) {
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
    const jobId = parsePositiveInt(req.params.jobId);
    if (jobId === null) {
      res.status(400).json({ error: 'jobIdが不正です' });
      return;
    }

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
    const jobId = parsePositiveInt(req.params.jobId);
    if (jobId === null) {
      res.status(400).json({ error: 'jobIdが不正です' });
      return;
    }

    const row = await getUploadConfirmJobForPharmacy(jobId, req.user!.id);
    if (!row) {
      res.status(404).json({ error: 'ジョブが見つかりません' });
      return;
    }

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
