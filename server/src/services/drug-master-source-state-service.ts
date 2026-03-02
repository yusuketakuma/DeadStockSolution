import { eq, like } from 'drizzle-orm';
import { db } from '../config/database';
import { drugMasterSourceState } from '../db/schema';

export interface SourceState {
  id: number;
  sourceKey: string;
  url: string;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  metadataJson: string | null;
}

export interface UpsertSourceStateData {
  url: string;
  etag?: string | null;
  lastModified?: string | null;
  contentHash?: string | null;
  lastCheckedAt?: string | null;
  lastChangedAt?: string | null;
  metadataJson?: string | null;
}

export async function getSourceState(sourceKey: string): Promise<SourceState | null> {
  const [row] = await db
    .select()
    .from(drugMasterSourceState)
    .where(eq(drugMasterSourceState.sourceKey, sourceKey))
    .limit(1);

  return row ?? null;
}

export async function upsertSourceState(sourceKey: string, data: UpsertSourceStateData): Promise<void> {
  await db
    .insert(drugMasterSourceState)
    .values({
      sourceKey,
      url: data.url,
      etag: data.etag ?? null,
      lastModified: data.lastModified ?? null,
      contentHash: data.contentHash ?? null,
      lastCheckedAt: data.lastCheckedAt ?? null,
      lastChangedAt: data.lastChangedAt ?? null,
      metadataJson: data.metadataJson ?? null,
    })
    .onConflictDoUpdate({
      target: drugMasterSourceState.sourceKey,
      set: {
        url: data.url,
        ...(data.etag !== undefined ? { etag: data.etag } : {}),
        ...(data.lastModified !== undefined ? { lastModified: data.lastModified } : {}),
        ...(data.contentHash !== undefined ? { contentHash: data.contentHash } : {}),
        ...(data.lastCheckedAt !== undefined ? { lastCheckedAt: data.lastCheckedAt } : {}),
        ...(data.lastChangedAt !== undefined ? { lastChangedAt: data.lastChangedAt } : {}),
        ...(data.metadataJson !== undefined ? { metadataJson: data.metadataJson } : {}),
      },
    });
}

export async function getAllSourceStates(): Promise<SourceState[]> {
  return db.select().from(drugMasterSourceState);
}

// ── Source key 定数（全スケジューラ共通） ──────────────────

/** 薬価基準: 単一ファイルモード */
export const SOURCE_KEY_SINGLE = 'drug:single';
/** 薬価基準: インデックスページ */
export const SOURCE_KEY_INDEX = 'drug:index_page';
/** 包装単位 */
export const SOURCE_KEY_PACKAGE = 'package:main';
/** 薬価基準: カテゴリファイル別キー */
export function sourceKeyForFile(category: string): string {
  return `drug:file:${category}`;
}

/**
 * ソースのヘッダー情報（ETag/Last-Modified/contentHash）を永続化する共通ヘルパー。
 * drug-master-scheduler / drug-package-scheduler から呼び出される。
 */
export async function persistSourceHeaders(
  sourceKey: string,
  sourceUrl: string,
  data: {
    etag: string | null;
    lastModified: string | null;
    contentHash?: string | null;
  },
  changed: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  await upsertSourceState(sourceKey, {
    url: sourceUrl,
    etag: data.etag,
    lastModified: data.lastModified,
    ...(data.contentHash !== undefined ? { contentHash: data.contentHash } : {}),
    lastCheckedAt: now,
    ...(changed ? { lastChangedAt: now } : {}),
  });
}

export async function getSourceStatesByPrefix(prefix: string): Promise<SourceState[]> {
  return db
    .select()
    .from(drugMasterSourceState)
    .where(like(drugMasterSourceState.sourceKey, `${prefix}%`));
}
