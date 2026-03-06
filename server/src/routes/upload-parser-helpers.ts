import { eq, and, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { columnMappingTemplates } from '../db/schema';
import { ColumnMapping } from '../types';
import { parseMapping, validateMappingAgainstHeader, resolveMappingFromTemplate, type UploadType } from './upload-validation';
import { type ApplyMode, runUploadConfirm } from '../services/upload-confirm-service';
import { getUploadConfirmJobForPharmacy } from '../services/upload-confirm-job-service';

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
export type SuggestedPreviewMapping = ReturnType<typeof resolveMappingFromTemplate>;
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
  const suggestedByType = mapUploadTypes((uploadType) => resolveMappingFromTemplate(
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
