import { Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { columnMappingTemplates } from '../db/schema';
import { AuthRequest, ColumnMapping } from '../types';
import {
  parseMapping,
  validateMappingAgainstHeader,
  resolveMappingFromTemplate,
  resolveMappingFromTemplateWithSource,
  type UploadType,
} from '../routes/upload-validation';
import { type ApplyMode, runUploadConfirm } from '../services/upload-confirm-service';
import { getUploadConfirmJobForPharmacy, enqueueUploadConfirmJob, isUploadConfirmIdempotencyConflictError, isUploadConfirmQueueLimitError } from '../services/upload-confirm-job-service';
import { computeHeaderHash } from '../services/column-mapper';
import { getErrorMessage, logUploadFailure, getUploadFileOrReject, getUploadTypeOrReject, parseHeaderRowIndexOrReject, parseExcelRowsOrReject, getBaseContext } from '../routes/upload-validation';
import { parsePositiveInt } from '../utils/request-utils';
import { logger } from '../services/logger';

// ============================================================================
// Parse & Validation Helpers
// ============================================================================

export function parseApplyMode(raw: unknown): ApplyMode | null {
  if (raw === undefined || raw === null || raw === '') return 'replace';
  if (raw === 'replace') return 'replace';
  if (raw === 'diff') return 'diff';
  if (raw === 'partial') return 'partial';
  return null;
}

export function parseDeleteMissing(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw === 'true' || raw === '1';
  return false;
}

export function isUploadConfirmEnqueueFallbackEnabled(): boolean {
  const raw = process.env.UPLOAD_CONFIRM_FALLBACK_SYNC_ON_ENQUEUE_ERROR;
  return raw === '1' || raw === 'true';
}

// ============================================================================
// Error Code Mapping
// ============================================================================

export function resolvePrefixedJobErrorCode(rawMessage: string | null): string | null {
  if (!rawMessage) return null;
  const matched = rawMessage.match(/^\[([A-Z0-9_]+)]/);
  if (!matched?.[1]) return null;
  return matched[1];
}

export function mapUploadJobErrorCode(rawMessage: string | null): string | null {
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

export function toPublicUploadJobError(rawMessage: string | null): { code: string | null; message: string | null } {
  const code = mapUploadJobErrorCode(rawMessage);
  if (!code) {
    return { code: null, message: null };
  }
  const messageByCode: Partial<Record<NonNullable<typeof code>, string>> = {
    MAPPING_INVALID: 'カラム割り当ての設定が不正です。設定を見直して再実行してください。',
    HEADER_ROW_INVALID: 'ヘッダー行の指定が不正です。設定を見直して再実行してください。',
    FILE_LIMIT_EXCEEDED: 'アップロードファイルを解析できませんでした。ファイル形式と内容を確認してください。',
    FILE_PARSE_FAILED: 'アップロードファイルを解析できませんでした。ファイル形式と内容を確認してください。',
    STALE_JOB_SKIPPED: 'より新しいアップロードが既に反映されているため、この処理はスキップされました。',
    JOB_CANCELED: 'このジョブは管理者によりキャンセルされました。',
    UPLOAD_CONFIRM_FAILED: 'アップロード処理に失敗しました。時間をおいて再実行してください。',
  };
  return { code, message: messageByCode[code] ?? 'アップロード処理に失敗しました。時間をおいて再実行してください。' };
}

// ============================================================================
// Idempotency Key Parsing
// ============================================================================

export const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9:_.-]{8,120}$/;

export function parseIdempotencyKey(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) return undefined;
  return normalized;
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface MappingTemplateSnapshot {
  uploadType: UploadType;
  mapping: string;
  createdAt: string | null;
}

export type UploadTypeRecord<T> = Record<UploadType, T>;
export type SuggestedPreviewMapping = ReturnType<typeof resolveMappingFromTemplateWithSource>;
export type SuggestedPreviewMappings = UploadTypeRecord<SuggestedPreviewMapping>;
export type ValidatedPreviewMappings = UploadTypeRecord<ColumnMapping | null>;
export type UploadConfirmExecutionParams = Parameters<typeof runUploadConfirm>[0];
export type UploadConfirmJob = NonNullable<Awaited<ReturnType<typeof getUploadConfirmJobForPharmacy>>>;


// ============================================================================
// Upload Type Mapping
// ============================================================================

export function mapUploadTypes<T>(resolver: (uploadType: UploadType) => T): UploadTypeRecord<T> {
  return {
    dead_stock: resolver('dead_stock'),
    used_medication: resolver('used_medication'),
  };
}

// ============================================================================
// Database Queries
// ============================================================================

export async function loadMappingTemplatesByHeaderHash(
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

// ============================================================================
// Mapping Resolution & Validation
// ============================================================================

export function findTemplateByUploadType(
  templates: MappingTemplateSnapshot[],
  uploadType: UploadType,
): MappingTemplateSnapshot | undefined {
  return templates.find((template) => template.uploadType === uploadType);
}

export function validateSuggestedPreviewMapping(
  headerRow: unknown[],
  uploadType: UploadType,
  mapping: unknown,
): ColumnMapping | null {
  try {
    const parsed = parseMapping(JSON.stringify(mapping), uploadType);
    validateMappingAgainstHeader(parsed, headerRow);
    return parsed;
  } catch {
    return null;
  }
}

export function buildPreviewMappings(
  templates: MappingTemplateSnapshot[],
  headerRow: unknown[],
): {
  suggestedByType: SuggestedPreviewMappings;
  validatedByType: ValidatedPreviewMappings;
} {
  const suggestedByType = mapUploadTypes((uploadType) => resolveMappingFromTemplateWithSource(
    findTemplateByUploadType(templates, uploadType)?.mapping,
    headerRow,
    uploadType,
  ));

  return {
    suggestedByType,
    validatedByType: mapUploadTypes((uploadType) => validateSuggestedPreviewMapping(
      headerRow,
      uploadType,
      suggestedByType[uploadType].mapping,
    )),
  };
}

export function resolveMappingFromRequestOrAuto(
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

// ============================================================================
// Request Rejection Helpers (with response handling)
// ============================================================================

export async function resolveAndValidateMappingOrReject(
  req: AuthRequest,
  res: Response,
  allRows: unknown[][],
  headerRowIndex: number,
  uploadType: UploadType,
  failureContext?: string,
): Promise<ColumnMapping | null> {
  const headerRow = allRows[headerRowIndex];
  try {
    const hasExplicitMapping = typeof req.body.mapping === 'string' && req.body.mapping.trim() !== '';
    const mapping = hasExplicitMapping
      ? parseMapping(req.body.mapping, uploadType)
      : resolveMappingFromRequestOrAuto(
        req.body.mapping,
        uploadType,
        headerRow,
        findTemplateByUploadType(
          await loadMappingTemplatesByHeaderHash(req.user!.id, computeHeaderHash(headerRow)),
          uploadType,
        )?.mapping,
      );
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

export function parseJobIdOrReject(req: AuthRequest, res: Response): number | null {
  const jobId = parsePositiveInt(req.params.jobId);
  if (jobId !== null) {
    return jobId;
  }
  res.status(400).json({ error: 'jobIdが不正です' });
  return null;
}

export async function loadUploadJobOrReject(
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

// ============================================================================
// Confirm Async Enqueue Handler
// ============================================================================

export async function handleConfirmAsyncEnqueue(
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
          throw new Error('fallback context is unavailable', { cause: err });
        }
        const executionParams = fallbackExecutionParams;
        const syncResult = await runUploadConfirm(executionParams);
        logger.warn('Upload confirm async enqueue failed, fell back to sync execution', () => ({
          ...getBaseContext(req),
          error: getErrorMessage(err),
          uploadType: executionParams.uploadType,
          applyMode: executionParams.applyMode,
        }));
        const fallbackRejectedRows = syncResult.partialSummary?.rejectedRows ?? 0;
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
          errorReportAvailable: fallbackRejectedRows > 0,
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
