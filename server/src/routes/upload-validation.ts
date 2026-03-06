import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AuthRequest, ColumnMapping, DEAD_STOCK_FIELDS, USED_MEDICATION_FIELDS } from '../types';
import { suggestMapping } from '../services/column-mapper';
import { logger } from '../services/logger';
import { writeLog, getClientIp } from '../services/log-service';
import { parseExcelBuffer } from '../services/upload-service';
import { getErrorMessage } from '../middleware/error-handler';
import { createMemorySingleFileUpload } from '../middleware/upload-middleware';

export const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
export const MAX_MAPPING_KEYS = 30;
export const MAX_MAPPING_COLUMN_INDEX = 199;
export const INSERT_BATCH_SIZE = 500;
export const ALLOWED_EXTENSIONS = new Set(['.xlsx']);
export const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);
export type UploadType = 'dead_stock' | 'used_medication';
export const VALID_UPLOAD_TYPES = new Set<UploadType>(['dead_stock', 'used_medication']);
export const DEAD_STOCK_FIELD_SET = new Set<string>(DEAD_STOCK_FIELDS);
export const USED_MEDICATION_FIELD_SET = new Set<string>(USED_MEDICATION_FIELDS);
const MAPPING_FIELD_LABELS: Record<string, string> = {
  drug_code: '薬品コード',
  drug_name: '薬剤名',
  quantity: '数量',
  unit: '単位',
  yakka_unit_price: '薬価',
  expiration_date: '使用期限',
  lot_number: 'ロット番号',
  monthly_usage: '月間使用量',
};

export function getBaseContext(req: Request): Record<string, unknown> {
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

export { getErrorMessage } from '../middleware/error-handler';

export function sanitizeLogValue(value: unknown, maxLength: number = 160): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value)
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  if (!str) return null;
  return str.slice(0, maxLength);
}

export function logUploadFailure(
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

const upload = createMemorySingleFileUpload({
  maxUploadSize: MAX_UPLOAD_SIZE,
  allowedExtensions: ALLOWED_EXTENSIONS,
  allowedMimeTypes: ALLOWED_MIME_TYPES,
  invalidTypeErrorMessage: 'xlsxファイルのみアップロードできます',
});

export function uploadSingleFile(req: Request, res: Response, next: NextFunction): void {
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

export function parseMapping(raw: unknown, uploadType: UploadType): ColumnMapping {
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

export function parseUploadType(raw: unknown): UploadType | null {
  if (typeof raw !== 'string') return null;
  return VALID_UPLOAD_TYPES.has(raw as UploadType) ? raw as UploadType : null;
}

export function getUploadFileOrReject(req: AuthRequest, res: Response): Express.Multer.File | null {
  if (!req.file) {
    res.status(400).json({ error: 'ファイルが選択されていません' });
    return null;
  }
  return req.file;
}

export function getUploadTypeOrReject(req: AuthRequest, res: Response): UploadType | null {
  const uploadType = parseUploadType(req.body.uploadType);
  if (!uploadType) {
    res.status(400).json({ error: 'アップロードタイプを指定してください' });
    return null;
  }
  return uploadType;
}

export async function parseExcelRowsOrReject(
  req: AuthRequest,
  res: Response,
  phase: 'preview' | 'confirm',
  fileBuffer: Buffer,
): Promise<unknown[][] | null> {
  try {
    return await parseExcelBuffer(fileBuffer);
  } catch (err) {
    const reason = getErrorMessage(err);
    logUploadFailure(req, phase, 'parse_failed', { error: reason });
    if (reason.includes('上限')) {
      res.status(400).json({ error: reason });
      return null;
    }
    res.status(400).json({ error: 'ファイルの解析に失敗しました。xlsx形式を確認してください' });
    return null;
  }
}

export function parseHeaderRowIndexOrReject(req: AuthRequest, res: Response): number | null {
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

function resolveMappingFieldLabel(field: string): string {
  return MAPPING_FIELD_LABELS[field] ?? field;
}

function parseMappingColumnIndex(index: string | null | undefined): number | null {
  if (index === null || index === undefined) return null;
  const parsed = Number(index);
  return Number.isInteger(parsed) ? parsed : null;
}

export function validateMappingAgainstHeader(
  mapping: ColumnMapping,
  headerRow: unknown[],
): void {
  const headerLength = Array.isArray(headerRow) ? headerRow.length : 0;
  if (headerLength <= 0) {
    throw new Error('ヘッダー行が不正です');
  }

  for (const [field, value] of Object.entries(mapping) as Array<[string, string | null]>) {
    if (value === null) continue;
    const colIndex = parseMappingColumnIndex(value);
    if (colIndex === null || colIndex < 0 || colIndex >= headerLength) {
      throw new Error(`${resolveMappingFieldLabel(field)}カラムの割り当てが見出し範囲外です`);
    }
  }
}

export interface ResolvedTemplateMapping {
  mapping: ColumnMapping;
  fromSavedTemplate: boolean;
}

export function resolveMappingFromTemplateWithSource(
  savedMappingRaw: string | null | undefined,
  headerRow: unknown[],
  uploadType: UploadType,
): ResolvedTemplateMapping {
  if (savedMappingRaw) {
    try {
      return {
        mapping: parseMapping(savedMappingRaw, uploadType),
        fromSavedTemplate: true,
      };
    } catch {
      // fallback
    }
  }
  return {
    mapping: suggestMapping(headerRow, uploadType),
    fromSavedTemplate: false,
  };
}

export function resolveMappingFromTemplate(
  savedMappingRaw: string | null | undefined,
  headerRow: unknown[],
  uploadType: UploadType,
): ColumnMapping {
  return resolveMappingFromTemplateWithSource(savedMappingRaw, headerRow, uploadType).mapping;
}
