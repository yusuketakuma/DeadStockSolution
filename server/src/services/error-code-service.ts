import { and, count, eq, ilike, type SQL } from 'drizzle-orm';
import { db } from '../config/database';
import {
  errorCodes,
  type ErrorCodeCategory,
  type ErrorCodeSeverity,
  errorCodeCategoryValues,
  errorCodeSeverityValues,
} from '../db/schema';
import { escapeLikeWildcards } from '../utils/request-utils';
import { logger } from './logger';

// ── 初期エラーコード定義 ──────────────────────────────────

export const INITIAL_ERROR_CODES: ReadonlyArray<{
  code: string;
  category: ErrorCodeCategory;
  severity: ErrorCodeSeverity;
  titleJa: string;
  descriptionJa: string;
  resolutionJa?: string;
}> = [
  { code: 'UPLOAD_PARSE_FAILED', category: 'upload', severity: 'error', titleJa: 'ファイル解析エラー', descriptionJa: 'アップロードされたファイルの解析に失敗しました', resolutionJa: 'ファイル形式を確認してください' },
  { code: 'UPLOAD_EMPTY_FILE', category: 'upload', severity: 'warning', titleJa: '空ファイル', descriptionJa: 'アップロードされたファイルにデータがありません' },
  { code: 'UPLOAD_EMPTY_ROWS', category: 'upload', severity: 'warning', titleJa: '有効行なし', descriptionJa: '有効なデータ行がありませんでした' },
  { code: 'UPLOAD_INVALID_MAPPING', category: 'upload', severity: 'error', titleJa: 'カラムマッピング不正', descriptionJa: 'カラムの対応付けが正しくありません', resolutionJa: 'マッピング設定を確認してください' },
  { code: 'UPLOAD_FILE_TOO_LARGE', category: 'upload', severity: 'error', titleJa: 'ファイルサイズ超過', descriptionJa: 'ファイルサイズが上限を超えています' },
  { code: 'UPLOAD_MULTER_ERROR', category: 'upload', severity: 'error', titleJa: 'アップロード処理エラー', descriptionJa: 'ファイルアップロードの処理中にエラーが発生しました' },
  { code: 'SYNC_MASTER_FAILED', category: 'sync', severity: 'error', titleJa: '薬価マスター同期失敗', descriptionJa: '薬価基準データの同期に失敗しました', resolutionJa: 'ネットワーク接続とMHLWサイトの状態を確認してください' },
  { code: 'AUTH_LOGIN_FAILED', category: 'auth', severity: 'warning', titleJa: 'ログイン失敗', descriptionJa: 'ログイン認証に失敗しました' },
  { code: 'AUTH_TOKEN_EXPIRED', category: 'auth', severity: 'info', titleJa: 'トークン期限切れ', descriptionJa: '認証トークンの有効期限が切れました' },
  { code: 'SYSTEM_INTERNAL_ERROR', category: 'system', severity: 'critical', titleJa: '内部エラー', descriptionJa: 'サーバー内部でエラーが発生しました', resolutionJa: 'ログの詳細を確認し、システム管理者に連絡してください' },
  { code: 'SYSTEM_UNHANDLED_REJECTION', category: 'system', severity: 'error', titleJa: '未処理Promise拒否', descriptionJa: '処理されなかったPromise拒否が発生しました' },
  { code: 'SYSTEM_UNCAUGHT_EXCEPTION', category: 'system', severity: 'critical', titleJa: '未捕捉例外', descriptionJa: '捕捉されなかった例外が発生しました' },
  { code: 'OPENCLAW_HANDOFF_FAILED', category: 'openclaw', severity: 'error', titleJa: 'ハンドオフ失敗', descriptionJa: 'OpenClawへのハンドオフに失敗しました' },
  { code: 'OPENCLAW_COMMAND_REJECTED', category: 'openclaw', severity: 'warning', titleJa: 'コマンド拒否', descriptionJa: 'OpenClawからのコマンドが拒否されました' },
];

// ── 型定義 ──────────────────────────────────

export interface ListErrorCodesOptions {
  category?: ErrorCodeCategory;
  severity?: ErrorCodeSeverity;
  search?: string;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListErrorCodesResult {
  items: (typeof errorCodes.$inferSelect)[];
  total: number;
}

export interface CreateErrorCodeInput {
  code: string;
  category: ErrorCodeCategory;
  severity: ErrorCodeSeverity;
  titleJa: string;
  descriptionJa?: string | null;
  resolutionJa?: string | null;
}

export interface UpdateErrorCodeInput {
  category?: ErrorCodeCategory;
  severity?: ErrorCodeSeverity;
  titleJa?: string;
  descriptionJa?: string | null;
  resolutionJa?: string | null;
  isActive?: boolean;
}

// ── サービス関数 ──────────────────────────────────

/**
 * エラーコード一覧を取得する（フィルタ・ページネーション対応）
 */
export async function listErrorCodes(options: ListErrorCodesOptions = {}): Promise<ListErrorCodesResult> {
  try {
    const conditions: SQL[] = [];

    if (options.category) {
      conditions.push(eq(errorCodes.category, options.category));
    }
    if (options.severity) {
      conditions.push(eq(errorCodes.severity, options.severity));
    }
    if (options.activeOnly) {
      conditions.push(eq(errorCodes.isActive, true));
    }
    if (options.search) {
      conditions.push(ilike(errorCodes.code, `%${escapeLikeWildcards(options.search)}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const [items, [totalRow]] = await Promise.all([
      db.select().from(errorCodes).where(where).limit(limit).offset(offset),
      db.select({ value: count() }).from(errorCodes).where(where),
    ]);

    return { items, total: totalRow?.value ?? 0 };
  } catch (err) {
    logger.error('Failed to list error codes', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { items: [], total: 0 };
  }
}

/**
 * エラーコード文字列で1件取得する
 */
export async function getErrorCodeByCode(code: string): Promise<(typeof errorCodes.$inferSelect) | null> {
  try {
    const [row] = await db.select().from(errorCodes).where(eq(errorCodes.code, code)).limit(1);
    return row ?? null;
  } catch (err) {
    logger.error('Failed to get error code', {
      code,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 新しいエラーコードを登録する
 */
export async function createErrorCode(entry: CreateErrorCodeInput): Promise<(typeof errorCodes.$inferSelect) | null> {
  try {
    const [row] = await db.insert(errorCodes).values({
      code: entry.code,
      category: entry.category,
      severity: entry.severity,
      titleJa: entry.titleJa,
      descriptionJa: entry.descriptionJa ?? null,
      resolutionJa: entry.resolutionJa ?? null,
    }).returning();
    return row ?? null;
  } catch (err) {
    logger.error('Failed to create error code', {
      code: entry.code,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 既存エラーコードを更新する
 */
export async function updateErrorCode(
  id: number,
  updates: UpdateErrorCodeInput,
): Promise<(typeof errorCodes.$inferSelect) | null> {
  try {
    const [row] = await db.update(errorCodes)
      .set({
        ...updates,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(errorCodes.id, id))
      .returning();
    return row ?? null;
  } catch (err) {
    logger.error('Failed to update error code', {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 初期エラーコードをシードする（既存レコードはスキップ）
 */
export async function seedInitialErrorCodes(): Promise<number> {
  try {
    const result = await db.insert(errorCodes)
      .values(
        INITIAL_ERROR_CODES.map((entry) => ({
          code: entry.code,
          category: entry.category,
          severity: entry.severity,
          titleJa: entry.titleJa,
          descriptionJa: entry.descriptionJa ?? null,
          resolutionJa: entry.resolutionJa ?? null,
        })),
      )
      .onConflictDoNothing({ target: errorCodes.code });

    const inserted = result.rowCount ?? 0;
    if (inserted > 0) {
      logger.info(`Seeded ${inserted} initial error codes`);
    }
    return inserted;
  } catch (err) {
    logger.error('Failed to seed initial error codes', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
