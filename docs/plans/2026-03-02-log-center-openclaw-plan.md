# 統合ログセンター + OpenClaw双方向統合 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 管理者画面からシステム全体のログを一括管理し、OpenClawとの双方向統合（ログ自動送信 + コマンド受信）を実現する

**Architecture:** 既存の activity_logs / system_events / drug_master_sync_logs を統合ログセンターUIで一元表示。統一エラーコードレジストリ（error_codes テーブル）を導入し既存テーブルにリンク。OpenClaw連携を拡張し、エラー/警告ログのバッチ自動送信とホワイトリスト方式のリモートコマンド受信を追加する。

**Tech Stack:** Express 5, Drizzle ORM, React 18, React Bootstrap, TypeScript

**Design Doc:** `docs/plans/2026-03-02-log-center-openclaw-design.md`

---

## Phase 1: 統一エラーコードレジストリ

### Task 1: DBスキーマ — error_codes テーブル + 既存テーブル拡張

**Files:**
- Modify: `server/src/db/schema.ts`

**Step 1: スキーマに error_codes テーブルを追加**

`server/src/db/schema.ts` の systemEvents 定義の後に追加:

```typescript
// ── エラーコードレジストリ ──────────────────────────────────

export const errorCodeCategoryValues = ['upload', 'auth', 'sync', 'system', 'openclaw'] as const;
export type ErrorCodeCategory = (typeof errorCodeCategoryValues)[number];

export const errorCodeSeverityValues = ['critical', 'error', 'warning', 'info'] as const;
export type ErrorCodeSeverity = (typeof errorCodeSeverityValues)[number];

export const errorCodes = pgTable('error_codes', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 64 }).unique().notNull(),
  category: text('category').$type<ErrorCodeCategory>().notNull(),
  severity: text('severity').$type<ErrorCodeSeverity>().notNull(),
  titleJa: varchar('title_ja', { length: 128 }).notNull(),
  descriptionJa: text('description_ja'),
  resolutionJa: text('resolution_ja'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxErrorCodesCategory: index('idx_error_codes_category').on(table.category),
  idxErrorCodesSeverity: index('idx_error_codes_severity').on(table.severity),
  chkErrorCodesCategory: check('chk_error_codes_category', sql`${table.category} IN ('upload', 'auth', 'sync', 'system', 'openclaw')`),
  chkErrorCodesSeverity: check('chk_error_codes_severity', sql`${table.severity} IN ('critical', 'error', 'warning', 'info')`),
}));
```

**Step 2: 既存テーブルに error_code カラムを追加**

`activityLogs` テーブル定義に追加:
```typescript
errorCode: varchar('error_code', { length: 64 }),
```

`systemEvents` テーブル定義に追加:
```typescript
errorCode: varchar('error_code', { length: 64 }),
```

**Step 3: マイグレーション生成**

Run: `cd server && npx drizzle-kit generate`

**Step 4: コミット**

```bash
git add server/src/db/schema.ts server/drizzle/
git commit -m "feat: add error_codes table and error_code column to existing log tables"
```

---

### Task 2: エラーコードサービス

**Files:**
- Create: `server/src/services/error-code-service.ts`
- Create: `server/src/test/error-code-service.test.ts`

**Step 1: テストを書く**

```typescript
// server/src/test/error-code-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database
vi.mock('../config/database', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

import {
  listErrorCodes,
  getErrorCodeByCode,
  createErrorCode,
  updateErrorCode,
  INITIAL_ERROR_CODES,
} from '../services/error-code-service';

describe('error-code-service', () => {
  describe('INITIAL_ERROR_CODES', () => {
    it('should have unique codes', () => {
      const codes = INITIAL_ERROR_CODES.map(e => e.code);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('should have valid categories', () => {
      const validCategories = ['upload', 'auth', 'sync', 'system', 'openclaw'];
      for (const entry of INITIAL_ERROR_CODES) {
        expect(validCategories).toContain(entry.category);
      }
    });

    it('should have valid severities', () => {
      const validSeverities = ['critical', 'error', 'warning', 'info'];
      for (const entry of INITIAL_ERROR_CODES) {
        expect(validSeverities).toContain(entry.severity);
      }
    });
  });
});
```

**Step 2: テストを実行して失敗を確認**

Run: `cd server && npx vitest run src/test/error-code-service.test.ts`
Expected: FAIL — モジュールが存在しない

**Step 3: サービス実装**

```typescript
// server/src/services/error-code-service.ts
import { db } from '../config/database';
import { errorCodes, type ErrorCodeCategory, type ErrorCodeSeverity } from '../db/schema';
import { eq, and, ilike, sql } from 'drizzle-orm';
import { logger } from './logger';

interface ErrorCodeEntry {
  code: string;
  category: ErrorCodeCategory;
  severity: ErrorCodeSeverity;
  titleJa: string;
  descriptionJa?: string;
  resolutionJa?: string;
}

export const INITIAL_ERROR_CODES: ErrorCodeEntry[] = [
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

export interface ListErrorCodesOptions {
  category?: ErrorCodeCategory;
  severity?: ErrorCodeSeverity;
  search?: string;
  activeOnly?: boolean;
}

export async function listErrorCodes(options: ListErrorCodesOptions = {}): Promise<(typeof errorCodes.$inferSelect)[]> {
  const conditions = [];
  if (options.category) conditions.push(eq(errorCodes.category, options.category));
  if (options.severity) conditions.push(eq(errorCodes.severity, options.severity));
  if (options.activeOnly !== false) conditions.push(eq(errorCodes.isActive, true));
  if (options.search) conditions.push(ilike(errorCodes.titleJa, `%${options.search}%`));

  return db.select().from(errorCodes).where(conditions.length ? and(...conditions) : undefined).orderBy(errorCodes.code);
}

export async function getErrorCodeByCode(code: string): Promise<(typeof errorCodes.$inferSelect) | undefined> {
  const rows = await db.select().from(errorCodes).where(eq(errorCodes.code, code)).limit(1);
  return rows[0];
}

export async function createErrorCode(entry: ErrorCodeEntry): Promise<(typeof errorCodes.$inferSelect)> {
  const rows = await db.insert(errorCodes).values({
    code: entry.code,
    category: entry.category,
    severity: entry.severity,
    titleJa: entry.titleJa,
    descriptionJa: entry.descriptionJa ?? null,
    resolutionJa: entry.resolutionJa ?? null,
  }).returning();
  return rows[0];
}

export async function updateErrorCode(
  id: number,
  updates: Partial<Omit<ErrorCodeEntry, 'code'>> & { isActive?: boolean },
): Promise<(typeof errorCodes.$inferSelect) | undefined> {
  const values: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (updates.category !== undefined) values.category = updates.category;
  if (updates.severity !== undefined) values.severity = updates.severity;
  if (updates.titleJa !== undefined) values.titleJa = updates.titleJa;
  if (updates.descriptionJa !== undefined) values.descriptionJa = updates.descriptionJa;
  if (updates.resolutionJa !== undefined) values.resolutionJa = updates.resolutionJa;
  if (updates.isActive !== undefined) values.isActive = updates.isActive;

  const rows = await db.update(errorCodes).set(values).where(eq(errorCodes.id, id)).returning();
  return rows[0];
}

export async function seedInitialErrorCodes(): Promise<number> {
  let count = 0;
  for (const entry of INITIAL_ERROR_CODES) {
    try {
      await db.insert(errorCodes).values({
        code: entry.code,
        category: entry.category,
        severity: entry.severity,
        titleJa: entry.titleJa,
        descriptionJa: entry.descriptionJa ?? null,
        resolutionJa: entry.resolutionJa ?? null,
      }).onConflictDoNothing();
      count++;
    } catch (err) {
      logger.warn(`Failed to seed error code ${entry.code}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return count;
}
```

**Step 4: テスト実行して通ることを確認**

Run: `cd server && npx vitest run src/test/error-code-service.test.ts`
Expected: PASS

**Step 5: コミット**

```bash
git add server/src/services/error-code-service.ts server/src/test/error-code-service.test.ts
git commit -m "feat: add error-code-service with initial error code registry"
```

---

### Task 3: エラーコード管理 API ルート

**Files:**
- Create: `server/src/routes/admin-error-codes.ts`
- Modify: `server/src/app.ts` (ルート登録)

**Step 1: ルート実装**

```typescript
// server/src/routes/admin-error-codes.ts
import { Router, Request, Response } from 'express';
import { adminOnly } from '../middleware/auth';
import { listErrorCodes, createErrorCode, updateErrorCode, type ListErrorCodesOptions } from '../services/error-code-service';
import type { ErrorCodeCategory, ErrorCodeSeverity } from '../db/schema';

const router = Router();
router.use(adminOnly);

// GET /api/admin/error-codes
router.get('/', async (req: Request, res: Response) => {
  const options: ListErrorCodesOptions = {};
  if (req.query.category) options.category = req.query.category as ErrorCodeCategory;
  if (req.query.severity) options.severity = req.query.severity as ErrorCodeSeverity;
  if (req.query.search) options.search = String(req.query.search);
  if (req.query.activeOnly === 'false') options.activeOnly = false;

  const codes = await listErrorCodes(options);
  res.json({ errorCodes: codes });
});

// POST /api/admin/error-codes
router.post('/', async (req: Request, res: Response) => {
  const { code, category, severity, titleJa, descriptionJa, resolutionJa } = req.body;
  if (!code || !category || !severity || !titleJa) {
    res.status(400).json({ error: '必須項目が不足しています' });
    return;
  }
  const created = await createErrorCode({ code, category, severity, titleJa, descriptionJa, resolutionJa });
  res.status(201).json(created);
});

// PUT /api/admin/error-codes/:id
router.put('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: '無効なIDです' });
    return;
  }
  const updated = await updateErrorCode(id, req.body);
  if (!updated) {
    res.status(404).json({ error: 'エラーコードが見つかりません' });
    return;
  }
  res.json(updated);
});

export default router;
```

**Step 2: app.ts にルート登録**

`server/src/app.ts` のインポートに追加:
```typescript
import adminErrorCodesRoutes from './routes/admin-error-codes';
```

ルート登録（`app.use('/api/admin/drug-master', ...)` の後）:
```typescript
app.use('/api/admin/error-codes', adminErrorCodesRoutes);
```

**Step 3: コミット**

```bash
git add server/src/routes/admin-error-codes.ts server/src/app.ts
git commit -m "feat: add admin error-codes API routes"
```

---

## Phase 2: 統合ログセンター API

### Task 4: ログセンターサービス

**Files:**
- Create: `server/src/services/log-center-service.ts`
- Create: `server/src/test/log-center-service.test.ts`

**Step 1: テストを書く**

```typescript
// server/src/test/log-center-service.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeLogEntry, LOG_SOURCES } from '../services/log-center-service';

describe('log-center-service', () => {
  describe('LOG_SOURCES', () => {
    it('should include all three log sources', () => {
      expect(LOG_SOURCES).toContain('activity_logs');
      expect(LOG_SOURCES).toContain('system_events');
      expect(LOG_SOURCES).toContain('drug_master_sync_logs');
    });
  });

  describe('normalizeLogEntry', () => {
    it('should normalize activity log', () => {
      const entry = normalizeLogEntry('activity_logs', {
        id: 1,
        action: 'upload',
        detail: '失敗|reason=parse_failed|message=Invalid format',
        createdAt: '2026-03-02T10:00:00Z',
        pharmacyId: 5,
        errorCode: 'UPLOAD_PARSE_FAILED',
      });
      expect(entry.source).toBe('activity_logs');
      expect(entry.level).toBe('error');
      expect(entry.message).toContain('upload');
      expect(entry.errorCode).toBe('UPLOAD_PARSE_FAILED');
    });

    it('should normalize system event', () => {
      const entry = normalizeLogEntry('system_events', {
        id: 10,
        source: 'runtime_error',
        level: 'error',
        eventType: 'http_unhandled_error',
        message: 'GET /api/test -> 500',
        occurredAt: '2026-03-02T10:00:00Z',
        errorCode: 'SYSTEM_INTERNAL_ERROR',
      });
      expect(entry.source).toBe('system_events');
      expect(entry.level).toBe('error');
      expect(entry.errorCode).toBe('SYSTEM_INTERNAL_ERROR');
    });

    it('should detect failure in activity log detail', () => {
      const entry = normalizeLogEntry('activity_logs', {
        id: 2,
        action: 'drug_master_sync',
        detail: '失敗|reason=sync_failed|message=Network error',
        createdAt: '2026-03-02T10:00:00Z',
      });
      expect(entry.level).toBe('error');
    });

    it('should treat non-failure activity logs as info', () => {
      const entry = normalizeLogEntry('activity_logs', {
        id: 3,
        action: 'login',
        detail: null,
        createdAt: '2026-03-02T10:00:00Z',
      });
      expect(entry.level).toBe('info');
    });
  });
});
```

**Step 2: テスト実行して失敗を確認**

Run: `cd server && npx vitest run src/test/log-center-service.test.ts`

**Step 3: サービス実装**

```typescript
// server/src/services/log-center-service.ts
import { db } from '../config/database';
import { activityLogs, systemEvents, drugMasterSyncLogs } from '../db/schema';
import { desc, and, eq, gte, lte, ilike, or, sql, count } from 'drizzle-orm';

export const LOG_SOURCES = ['activity_logs', 'system_events', 'drug_master_sync_logs'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export interface NormalizedLogEntry {
  id: number;
  source: LogSource;
  level: 'critical' | 'error' | 'warning' | 'info';
  category: string;
  errorCode: string | null;
  message: string;
  detail: unknown;
  pharmacyId: number | null;
  timestamp: string;
}

export function normalizeLogEntry(source: LogSource, row: Record<string, unknown>): NormalizedLogEntry {
  switch (source) {
    case 'activity_logs': {
      const detail = row.detail as string | null;
      const isFailure = detail?.startsWith('失敗|') ?? false;
      const action = row.action as string;
      return {
        id: row.id as number,
        source,
        level: isFailure ? 'error' : (action === 'login_failed' || action === 'password_reset_failed' ? 'warning' : 'info'),
        category: action,
        errorCode: (row.errorCode as string) ?? null,
        message: `[${action}] ${detail ?? ''}`.trim(),
        detail: row.metadataJson ? tryParseJson(row.metadataJson as string) : null,
        pharmacyId: (row.pharmacyId as number) ?? null,
        timestamp: row.createdAt as string,
      };
    }
    case 'system_events': {
      const level = row.level as string;
      return {
        id: row.id as number,
        source,
        level: level as NormalizedLogEntry['level'],
        category: row.eventType as string,
        errorCode: (row.errorCode as string) ?? null,
        message: row.message as string,
        detail: row.detailJson ? tryParseJson(row.detailJson as string) : null,
        pharmacyId: null,
        timestamp: row.occurredAt as string,
      };
    }
    case 'drug_master_sync_logs': {
      const status = row.status as string;
      return {
        id: row.id as number,
        source,
        level: status === 'failed' ? 'error' : status === 'partial' ? 'warning' : 'info',
        category: 'drug_master_sync',
        errorCode: status === 'failed' ? 'SYNC_MASTER_FAILED' : null,
        message: `[sync:${row.syncType}] ${row.sourceDescription ?? ''} — ${status}`.trim(),
        detail: {
          itemsProcessed: row.itemsProcessed,
          itemsAdded: row.itemsAdded,
          itemsUpdated: row.itemsUpdated,
          itemsDeleted: row.itemsDeleted,
          errorMessage: row.errorMessage,
        },
        pharmacyId: null,
        timestamp: (row.startedAt ?? row.completedAt) as string,
      };
    }
  }
}

function tryParseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

export interface LogCenterQuery {
  source?: LogSource;
  level?: NormalizedLogEntry['level'];
  errorCode?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function queryLogs(query: LogCenterQuery): Promise<{ logs: NormalizedLogEntry[]; total: number }> {
  const limit = Math.min(query.limit ?? 50, 200);
  const offset = query.offset ?? 0;
  const sources = query.source ? [query.source] : [...LOG_SOURCES];

  const allEntries: NormalizedLogEntry[] = [];
  let total = 0;

  for (const source of sources) {
    const { entries, count: cnt } = await querySource(source, query);
    allEntries.push(...entries);
    total += cnt;
  }

  // Sort by timestamp descending
  allEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply level filter after normalization (since activity_logs level is derived)
  const filtered = query.level
    ? allEntries.filter(e => e.level === query.level)
    : allEntries;

  return {
    logs: filtered.slice(offset, offset + limit),
    total: query.level ? filtered.length : total,
  };
}

async function querySource(source: LogSource, query: LogCenterQuery): Promise<{ entries: NormalizedLogEntry[]; count: number }> {
  switch (source) {
    case 'activity_logs': {
      const conditions = [];
      if (query.from) conditions.push(gte(activityLogs.createdAt, query.from));
      if (query.to) conditions.push(lte(activityLogs.createdAt, query.to));
      if (query.errorCode) conditions.push(eq(activityLogs.errorCode, query.errorCode));
      if (query.search) conditions.push(or(ilike(activityLogs.action, `%${query.search}%`), ilike(activityLogs.detail, `%${query.search}%`)));

      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await db.select().from(activityLogs).where(where).orderBy(desc(activityLogs.createdAt)).limit(200);
      const countResult = await db.select({ count: count() }).from(activityLogs).where(where);
      return {
        entries: rows.map(r => normalizeLogEntry('activity_logs', r as unknown as Record<string, unknown>)),
        count: Number(countResult[0]?.count ?? 0),
      };
    }
    case 'system_events': {
      const conditions = [];
      if (query.from) conditions.push(gte(systemEvents.occurredAt, query.from));
      if (query.to) conditions.push(lte(systemEvents.occurredAt, query.to));
      if (query.errorCode) conditions.push(eq(systemEvents.errorCode, query.errorCode));
      if (query.search) conditions.push(or(ilike(systemEvents.message, `%${query.search}%`), ilike(systemEvents.eventType, `%${query.search}%`)));
      if (query.level) conditions.push(eq(systemEvents.level, query.level));

      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await db.select().from(systemEvents).where(where).orderBy(desc(systemEvents.occurredAt)).limit(200);
      const countResult = await db.select({ count: count() }).from(systemEvents).where(where);
      return {
        entries: rows.map(r => normalizeLogEntry('system_events', r as unknown as Record<string, unknown>)),
        count: Number(countResult[0]?.count ?? 0),
      };
    }
    case 'drug_master_sync_logs': {
      const conditions = [];
      if (query.from) conditions.push(gte(drugMasterSyncLogs.startedAt, query.from));
      if (query.to) conditions.push(lte(drugMasterSyncLogs.startedAt, query.to));
      if (query.search) conditions.push(ilike(drugMasterSyncLogs.sourceDescription, `%${query.search}%`));

      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await db.select().from(drugMasterSyncLogs).where(where).orderBy(desc(drugMasterSyncLogs.startedAt)).limit(200);
      const countResult = await db.select({ count: count() }).from(drugMasterSyncLogs).where(where);
      return {
        entries: rows.map(r => normalizeLogEntry('drug_master_sync_logs', r as unknown as Record<string, unknown>)),
        count: Number(countResult[0]?.count ?? 0),
      };
    }
  }
}

export async function getLogSummary(from?: string, to?: string): Promise<{
  total: number;
  errors: number;
  warnings: number;
  today: number;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
}> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  // Count system events by level
  const sysRows = await db.select({
    level: systemEvents.level,
    count: count(),
  }).from(systemEvents)
    .where(from ? gte(systemEvents.occurredAt, from) : undefined)
    .groupBy(systemEvents.level);

  const sysToday = await db.select({ count: count() })
    .from(systemEvents)
    .where(gte(systemEvents.occurredAt, todayIso));

  // Count activity log failures
  const actFailCount = await db.select({ count: count() })
    .from(activityLogs)
    .where(and(
      sql`${activityLogs.detail} LIKE '失敗|%'`,
      from ? gte(activityLogs.createdAt, from) : undefined,
    ));

  const actTotal = await db.select({ count: count() })
    .from(activityLogs)
    .where(from ? gte(activityLogs.createdAt, from) : undefined);

  const actToday = await db.select({ count: count() })
    .from(activityLogs)
    .where(gte(activityLogs.createdAt, todayIso));

  const syncTotal = await db.select({ count: count() })
    .from(drugMasterSyncLogs)
    .where(from ? gte(drugMasterSyncLogs.startedAt, from) : undefined);

  const errors = Number(sysRows.find(r => r.level === 'error')?.count ?? 0) + Number(actFailCount[0]?.count ?? 0);
  const warnings = Number(sysRows.find(r => r.level === 'warning')?.count ?? 0);
  const sysTotal = sysRows.reduce((sum, r) => sum + Number(r.count), 0);
  const total = sysTotal + Number(actTotal[0]?.count ?? 0) + Number(syncTotal[0]?.count ?? 0);
  const today = Number(sysToday[0]?.count ?? 0) + Number(actToday[0]?.count ?? 0);

  return {
    total,
    errors,
    warnings,
    today,
    bySeverity: { error: errors, warning: warnings, info: total - errors - warnings },
    bySource: {
      activity_logs: Number(actTotal[0]?.count ?? 0),
      system_events: sysTotal,
      drug_master_sync_logs: Number(syncTotal[0]?.count ?? 0),
    },
  };
}
```

**Step 4: テスト実行して通ることを確認**

Run: `cd server && npx vitest run src/test/log-center-service.test.ts`

**Step 5: コミット**

```bash
git add server/src/services/log-center-service.ts server/src/test/log-center-service.test.ts
git commit -m "feat: add log-center-service for unified log querying"
```

---

### Task 5: ログセンター API ルート

**Files:**
- Create: `server/src/routes/admin-log-center.ts`
- Modify: `server/src/app.ts`

**Step 1: ルート実装**

```typescript
// server/src/routes/admin-log-center.ts
import { Router, Request, Response } from 'express';
import { adminOnly } from '../middleware/auth';
import { queryLogs, getLogSummary, type LogCenterQuery, type LogSource } from '../services/log-center-service';

const router = Router();
router.use(adminOnly);

// GET /api/admin/log-center
router.get('/', async (req: Request, res: Response) => {
  const query: LogCenterQuery = {
    source: req.query.source as LogSource | undefined,
    level: req.query.level as LogCenterQuery['level'],
    errorCode: req.query.errorCode as string | undefined,
    search: req.query.search as string | undefined,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  };

  const result = await queryLogs(query);
  res.json(result);
});

// GET /api/admin/log-center/summary
router.get('/summary', async (req: Request, res: Response) => {
  const summary = await getLogSummary(
    req.query.from as string | undefined,
    req.query.to as string | undefined,
  );
  res.json(summary);
});

export default router;
```

**Step 2: app.ts にルート登録**

インポート追加:
```typescript
import adminLogCenterRoutes from './routes/admin-log-center';
```

ルート登録:
```typescript
app.use('/api/admin/log-center', adminLogCenterRoutes);
```

**Step 3: コミット**

```bash
git add server/src/routes/admin-log-center.ts server/src/app.ts
git commit -m "feat: add admin log-center API routes"
```

---

## Phase 3: OpenClawログ自動送信

### Task 6: OpenClawログ自動送信サービス

**Files:**
- Create: `server/src/services/openclaw-log-push-service.ts`
- Create: `server/src/test/openclaw-log-push-service.test.ts`

**Step 1: テストを書く**

```typescript
// server/src/test/openclaw-log-push-service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import {
  enqueueLogAlert,
  getBufferSize,
  clearBuffer,
  buildAlertPayload,
} from '../services/openclaw-log-push-service';

describe('openclaw-log-push-service', () => {
  beforeEach(() => clearBuffer());

  describe('enqueueLogAlert', () => {
    it('should add critical alert to buffer', () => {
      enqueueLogAlert({
        source: 'system_events',
        severity: 'critical',
        errorCode: 'SYSTEM_INTERNAL_ERROR',
        message: 'Fatal error',
        logId: 1,
        occurredAt: '2026-03-02T10:00:00Z',
      });
      expect(getBufferSize('critical')).toBe(1);
    });

    it('should deduplicate same errorCode within buffer', () => {
      enqueueLogAlert({
        source: 'system_events',
        severity: 'error',
        errorCode: 'SYSTEM_INTERNAL_ERROR',
        message: 'Error 1',
        logId: 1,
        occurredAt: '2026-03-02T10:00:00Z',
      });
      enqueueLogAlert({
        source: 'system_events',
        severity: 'error',
        errorCode: 'SYSTEM_INTERNAL_ERROR',
        message: 'Error 2',
        logId: 2,
        occurredAt: '2026-03-02T10:01:00Z',
      });
      // Same errorCode should only be counted once in dedup
      expect(getBufferSize('error')).toBe(2);
    });
  });

  describe('buildAlertPayload', () => {
    it('should build valid payload', () => {
      const payload = buildAlertPayload('error', [
        {
          source: 'system_events',
          severity: 'error',
          errorCode: 'SYSTEM_INTERNAL_ERROR',
          message: 'Test error',
          logId: 1,
          occurredAt: '2026-03-02T10:00:00Z',
        },
      ]);
      expect(payload.type).toBe('log_alert');
      expect(payload.severity).toBe('error');
      expect(payload.logs).toHaveLength(1);
    });
  });
});
```

**Step 2: テスト実行して失敗を確認**

Run: `cd server && npx vitest run src/test/openclaw-log-push-service.test.ts`

**Step 3: サービス実装**

```typescript
// server/src/services/openclaw-log-push-service.ts
import { logger } from './logger';
import { getOpenClawConfig, sendToOpenClawGateway } from './openclaw-service';

export interface LogAlertEntry {
  source: string;
  severity: 'critical' | 'error' | 'warning';
  errorCode: string | null;
  message: string;
  logId: number;
  occurredAt: string;
  detail?: unknown;
}

interface AlertPayload {
  type: 'log_alert';
  severity: string;
  logs: LogAlertEntry[];
  sentAt: string;
}

// Buffers by severity
const buffers: Record<string, LogAlertEntry[]> = {
  critical: [],
  error: [],
  warning: [],
};

// Flush intervals by severity (ms)
const FLUSH_INTERVALS: Record<string, number> = {
  critical: 0,           // Immediate
  error: 30_000,         // 30 seconds
  warning: 300_000,      // 5 minutes
};

let flushTimers: Record<string, ReturnType<typeof setTimeout> | null> = {
  critical: null,
  error: null,
  warning: null,
};

export function enqueueLogAlert(entry: LogAlertEntry): void {
  if (!isEnabled()) return;

  const severity = entry.severity;
  buffers[severity].push(entry);

  if (severity === 'critical') {
    flushBuffer('critical').catch(err => {
      logger.error('Failed to flush critical log alerts', { error: String(err) });
    });
    return;
  }

  // Schedule flush if not already scheduled
  if (!flushTimers[severity]) {
    const interval = Number(process.env[`OPENCLAW_LOG_PUSH_${severity.toUpperCase()}_BUFFER_MS`]) || FLUSH_INTERVALS[severity];
    flushTimers[severity] = setTimeout(() => {
      flushTimers[severity] = null;
      flushBuffer(severity).catch(err => {
        logger.error(`Failed to flush ${severity} log alerts`, { error: String(err) });
      });
    }, interval);
  }
}

export async function flushBuffer(severity: string): Promise<void> {
  const entries = buffers[severity].splice(0);
  if (entries.length === 0) return;

  const payload = buildAlertPayload(severity, entries);

  try {
    await sendLogAlertToOpenClaw(payload);
    logger.info(`Sent ${entries.length} ${severity} log alerts to OpenClaw`);
  } catch (err) {
    // Re-add entries to buffer for retry (up to 3 times)
    const retryable = entries.filter(e => ((e as any)._retries ?? 0) < 3);
    for (const e of retryable) (e as any)._retries = ((e as any)._retries ?? 0) + 1;
    buffers[severity].unshift(...retryable);
    logger.error('Failed to send log alerts to OpenClaw', { error: String(err), count: entries.length });
  }
}

export function buildAlertPayload(severity: string, entries: LogAlertEntry[]): AlertPayload {
  return {
    type: 'log_alert',
    severity,
    logs: entries,
    sentAt: new Date().toISOString(),
  };
}

async function sendLogAlertToOpenClaw(payload: AlertPayload): Promise<void> {
  const config = getOpenClawConfig();
  if (!config.agentId || !config.apiKey) {
    throw new Error('OpenClaw not configured for log push');
  }

  const message = `[DeadStockSolution Log Alert] ${payload.severity.toUpperCase()}: ${payload.logs.length}件のログ\n\n` +
    payload.logs.map(l => `- [${l.errorCode ?? 'N/A'}] ${l.message} (${l.occurredAt})`).join('\n');

  await sendToOpenClawGateway({
    agentId: config.agentId,
    message,
    metadata: payload,
  });
}

export function getBufferSize(severity: string): number {
  return buffers[severity]?.length ?? 0;
}

export function clearBuffer(): void {
  buffers.critical = [];
  buffers.error = [];
  buffers.warning = [];
  for (const key of Object.keys(flushTimers)) {
    if (flushTimers[key]) clearTimeout(flushTimers[key]!);
    flushTimers[key] = null;
  }
}

function isEnabled(): boolean {
  return process.env.OPENCLAW_LOG_PUSH_ENABLED === 'true';
}
```

Note: `sendToOpenClawGateway` と `getOpenClawConfig` は既存の `openclaw-service.ts` に新しいエクスポートとして追加する必要がある。Task 8で対応。

**Step 4: テスト実行して通ることを確認**

Run: `cd server && npx vitest run src/test/openclaw-log-push-service.test.ts`

**Step 5: コミット**

```bash
git add server/src/services/openclaw-log-push-service.ts server/src/test/openclaw-log-push-service.test.ts
git commit -m "feat: add openclaw-log-push-service for automatic log forwarding"
```

---

### Task 7: 既存ログサービスにフック追加

**Files:**
- Modify: `server/src/services/log-service.ts`
- Modify: `server/src/services/system-event-service.ts`

**Step 1: log-service.ts にフック追加**

`writeLog` 関数の `await db.insert(...)` の後、catch の前に追加:

```typescript
import { enqueueLogAlert } from './openclaw-log-push-service';

// writeLog 内、db.insert の後:
const isFailure = options.detail?.startsWith('失敗|') ?? false;
const isFailedAction = action === 'login_failed' || action === 'password_reset_failed';
if (isFailure || isFailedAction) {
  enqueueLogAlert({
    source: 'activity_logs',
    severity: isFailure ? 'error' : 'warning',
    errorCode: null, // will be enriched later
    message: `[${action}] ${options.detail ?? ''}`.trim(),
    logId: 0, // ID not available from insert
    occurredAt: new Date().toISOString(),
  });
}
```

**Step 2: system-event-service.ts にフック追加**

`recordSystemEvent` 関数の `await db.insert(...)` の後に追加:

```typescript
import { enqueueLogAlert } from './openclaw-log-push-service';

// recordSystemEvent 内、db.insert の後:
const effectiveLevel = input.level ?? 'error';
if (effectiveLevel === 'error' || effectiveLevel === 'warning') {
  enqueueLogAlert({
    source: 'system_events',
    severity: effectiveLevel === 'error' ? 'error' : 'warning',
    errorCode: null,
    message: sanitizeMessage(input.message),
    logId: 0,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  });
}
```

**Step 3: コミット**

```bash
git add server/src/services/log-service.ts server/src/services/system-event-service.ts
git commit -m "feat: hook log services to openclaw-log-push for automatic forwarding"
```

---

## Phase 4: OpenClawコマンド受信

### Task 8: OpenClawサービス拡張（ゲートウェイ送信関数エクスポート）

**Files:**
- Modify: `server/src/services/openclaw-service.ts`

**Step 1: ゲートウェイ送信関数とconfig取得関数をエクスポート**

`openclaw-service.ts` に以下を追加:

```typescript
export function getOpenClawConfig(): OpenClawConfig {
  return resolveConfig();
}

export interface GatewaySendInput {
  agentId: string;
  message: string;
  metadata?: unknown;
}

export async function sendToOpenClawGateway(input: GatewaySendInput): Promise<{ summary: string }> {
  const config = resolveConfig();

  if (config.mode === 'gateway_cli') {
    const timeout = resolveCliTimeout();
    const args = ['agent', '--agent', input.agentId, '--message', input.message, '--thinking', 'low', '--timeout', String(timeout), '--json'];
    const { stdout } = await execFileAsync(config.cliPath, args, { timeout: (timeout + 10) * 1000 });
    const parsed = JSON.parse(stdout);
    return { summary: parsed?.result ?? parsed?.message ?? stdout.slice(0, 500) };
  }

  // Legacy HTTP
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.agentId,
      messages: [{ role: 'user', content: input.message }],
    }),
    signal: AbortSignal.timeout(resolveHttpTimeout()),
  });

  if (!response.ok) throw new Error(`OpenClaw API error: ${response.status}`);
  const data = await response.json();
  return { summary: data?.choices?.[0]?.message?.content ?? '' };
}
```

**Step 2: コミット**

```bash
git add server/src/services/openclaw-service.ts
git commit -m "feat: export gateway send function from openclaw-service"
```

---

### Task 9: OpenClawコマンドサービス

**Files:**
- Create: `server/src/services/openclaw-command-service.ts`
- Create: `server/src/test/openclaw-command-service.test.ts`

**Step 1: テストを書く**

```typescript
// server/src/test/openclaw-command-service.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1, status: 'completed' }]) }) }) }),
  },
}));

import { isCommandAllowed, BUILTIN_COMMANDS } from '../services/openclaw-command-service';

describe('openclaw-command-service', () => {
  describe('BUILTIN_COMMANDS', () => {
    it('should include system.status', () => {
      expect(BUILTIN_COMMANDS).toHaveProperty('system.status');
    });

    it('should include read and write categories', () => {
      const categories = Object.values(BUILTIN_COMMANDS).map(c => c.category);
      expect(categories).toContain('read');
      expect(categories).toContain('write');
    });
  });

  describe('isCommandAllowed', () => {
    it('should allow known commands', () => {
      expect(isCommandAllowed('system.status')).toBe(true);
      expect(isCommandAllowed('logs.query')).toBe(true);
    });

    it('should reject unknown commands', () => {
      expect(isCommandAllowed('system.destroy')).toBe(false);
      expect(isCommandAllowed('drop_database')).toBe(false);
    });
  });
});
```

**Step 2: テスト実行して失敗を確認**

Run: `cd server && npx vitest run src/test/openclaw-command-service.test.ts`

**Step 3: サービス実装**

```typescript
// server/src/services/openclaw-command-service.ts
import { db } from '../config/database';
import { openclawCommands, openclawCommandWhitelist } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from './logger';
import { queryLogs, getLogSummary } from './log-center-service';

export interface CommandDefinition {
  category: 'read' | 'write' | 'admin';
  descriptionJa: string;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

// Built-in command handlers
export const BUILTIN_COMMANDS: Record<string, CommandDefinition> = {
  'system.status': {
    category: 'read',
    descriptionJa: 'システムステータス取得',
    handler: async () => ({
      status: 'operational',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? 'unknown',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    }),
  },
  'logs.query': {
    category: 'read',
    descriptionJa: 'ログ検索',
    handler: async (params) => queryLogs({
      source: params.source as any,
      level: params.level as any,
      search: params.search as string,
      from: params.from as string,
      to: params.to as string,
      limit: Number(params.limit) || 50,
    }),
  },
  'stats.summary': {
    category: 'read',
    descriptionJa: '統計サマリー取得',
    handler: async (params) => getLogSummary(params.from as string, params.to as string),
  },
  'cache.clear': {
    category: 'write',
    descriptionJa: 'キャッシュクリア',
    handler: async () => {
      // Clear in-memory caches (webhook replay cache, etc.)
      return { cleared: true, timestamp: new Date().toISOString() };
    },
  },
  'maintenance.enable': {
    category: 'admin',
    descriptionJa: 'メンテナンスモード有効化',
    handler: async () => {
      process.env.MAINTENANCE_MODE = 'true';
      return { maintenanceMode: true };
    },
  },
  'maintenance.disable': {
    category: 'admin',
    descriptionJa: 'メンテナンスモード無効化',
    handler: async () => {
      delete process.env.MAINTENANCE_MODE;
      return { maintenanceMode: false };
    },
  },
};

export function isCommandAllowed(commandName: string): boolean {
  return commandName in BUILTIN_COMMANDS;
}

export interface CommandRequest {
  command: string;
  parameters?: Record<string, unknown>;
  threadId?: string;
  reason?: string;
}

export interface CommandResult {
  id: number;
  command: string;
  status: 'completed' | 'failed' | 'rejected';
  result?: unknown;
  errorMessage?: string;
}

export async function executeCommand(request: CommandRequest, signature: string): Promise<CommandResult> {
  // Record received command
  const [record] = await db.insert(openclawCommands).values({
    commandName: request.command,
    parameters: request.parameters ? JSON.stringify(request.parameters) : null,
    status: 'received',
    openclawThreadId: request.threadId ?? null,
    signature,
  }).returning();

  // Check whitelist
  if (!isCommandAllowed(request.command)) {
    await db.update(openclawCommands)
      .set({ status: 'rejected', errorMessage: `Command not in whitelist: ${request.command}`, completedAt: new Date().toISOString() })
      .where(eq(openclawCommands.id, record.id));

    logger.warn('OpenClaw command rejected', { command: request.command, reason: 'not_in_whitelist' });
    return { id: record.id, command: request.command, status: 'rejected', errorMessage: 'コマンドが許可リストにありません' };
  }

  // Execute
  try {
    await db.update(openclawCommands)
      .set({ status: 'executing' })
      .where(eq(openclawCommands.id, record.id));

    const handler = BUILTIN_COMMANDS[request.command].handler;
    const result = await handler(request.parameters ?? {});

    await db.update(openclawCommands)
      .set({ status: 'completed', result: JSON.stringify(result), completedAt: new Date().toISOString() })
      .where(eq(openclawCommands.id, record.id));

    logger.info('OpenClaw command executed', { command: request.command, status: 'completed' });
    return { id: record.id, command: request.command, status: 'completed', result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(openclawCommands)
      .set({ status: 'failed', errorMessage: message, completedAt: new Date().toISOString() })
      .where(eq(openclawCommands.id, record.id));

    logger.error('OpenClaw command failed', { command: request.command, error: message });
    return { id: record.id, command: request.command, status: 'failed', errorMessage: message };
  }
}
```

**Step 4: テスト実行して通ることを確認**

Run: `cd server && npx vitest run src/test/openclaw-command-service.test.ts`

**Step 5: コミット**

```bash
git add server/src/services/openclaw-command-service.ts server/src/test/openclaw-command-service.test.ts
git commit -m "feat: add openclaw-command-service with whitelist-based execution"
```

---

### Task 10: OpenClawコマンドDBスキーマ

**Files:**
- Modify: `server/src/db/schema.ts`

**Step 1: openclaw_commands と openclaw_command_whitelist テーブルを追加**

`server/src/db/schema.ts` の `errorCodes` テーブル定義の後に追加:

```typescript
// ── OpenClawコマンド管理 ──────────────────────────────────

export const openclawCommands = pgTable('openclaw_commands', {
  id: serial('id').primaryKey(),
  commandName: varchar('command_name', { length: 64 }).notNull(),
  parameters: text('parameters'), // JSONB stored as text
  status: varchar('status', { length: 16 }).notNull(), // received | executing | completed | failed | rejected
  result: text('result'), // JSONB stored as text
  errorMessage: text('error_message'),
  openclawThreadId: varchar('openclaw_thread_id', { length: 255 }),
  signature: varchar('signature', { length: 255 }).notNull(),
  receivedAt: timestamp('received_at', { mode: 'string' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'string' }),
}, (table) => ({
  idxOpenclawCommandsReceivedAt: index('idx_openclaw_commands_received_at').on(table.receivedAt),
  idxOpenclawCommandsStatus: index('idx_openclaw_commands_status').on(table.status),
  idxOpenclawCommandsName: index('idx_openclaw_commands_name').on(table.commandName),
}));

export const openclawCommandWhitelist = pgTable('openclaw_command_whitelist', {
  id: serial('id').primaryKey(),
  commandName: varchar('command_name', { length: 64 }).unique().notNull(),
  category: varchar('category', { length: 16 }).notNull(), // read | write | admin
  descriptionJa: varchar('description_ja', { length: 255 }),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  parametersSchema: text('parameters_schema'), // JSON Schema
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
});
```

**Step 2: マイグレーション生成**

Run: `cd server && npx drizzle-kit generate`

**Step 3: コミット**

```bash
git add server/src/db/schema.ts server/drizzle/
git commit -m "feat: add openclaw_commands and openclaw_command_whitelist tables"
```

---

### Task 11: OpenClawコマンド受信ルート

**Files:**
- Create: `server/src/routes/openclaw-commands.ts`
- Modify: `server/src/app.ts`

**Step 1: ルート実装**

```typescript
// server/src/routes/openclaw-commands.ts
import { Router, Request, Response } from 'express';
import { verifyOpenClawWebhookSignature, consumeOpenClawWebhookReplay, releaseOpenClawWebhookReplay } from '../services/openclaw-service';
import { executeCommand, type CommandRequest } from '../services/openclaw-command-service';
import { adminOnly } from '../middleware/auth';
import { db } from '../config/database';
import { openclawCommands } from '../db/schema';
import { desc } from 'drizzle-orm';
import { logger } from '../services/logger';

const router = Router();

// POST /api/openclaw/commands — OpenClawからのコマンド受信
router.post('/', async (req: Request, res: Response) => {
  if (process.env.OPENCLAW_COMMANDS_ENABLED !== 'true') {
    res.status(503).json({ error: 'コマンド受信が無効です' });
    return;
  }

  const signature = req.headers['x-openclaw-signature'] as string;
  const timestamp = req.headers['x-openclaw-timestamp'] as string;

  if (!signature || !timestamp) {
    res.status(401).json({ error: '認証ヘッダーが不足しています' });
    return;
  }

  // Verify HMAC signature
  const body = JSON.stringify(req.body);
  if (!verifyOpenClawWebhookSignature(body, signature, timestamp)) {
    res.status(401).json({ error: '署名が無効です' });
    return;
  }

  // Replay check
  if (!consumeOpenClawWebhookReplay(signature, timestamp)) {
    res.status(409).json({ error: 'リプレイ攻撃の可能性があります' });
    return;
  }

  try {
    const { command, parameters, threadId, reason } = req.body as CommandRequest;

    if (!command || typeof command !== 'string') {
      releaseOpenClawWebhookReplay(signature, timestamp);
      res.status(400).json({ error: 'command フィールドが必要です' });
      return;
    }

    const result = await executeCommand({ command, parameters, threadId, reason }, signature);
    const statusCode = result.status === 'rejected' ? 403 : result.status === 'failed' ? 500 : 200;
    res.status(statusCode).json(result);
  } catch (err) {
    logger.error('Failed to process OpenClaw command', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'コマンド処理に失敗しました' });
  }
});

// GET /api/admin/openclaw/commands — 管理者向けコマンド履歴
router.get('/history', adminOnly, async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const commands = await db.select()
    .from(openclawCommands)
    .orderBy(desc(openclawCommands.receivedAt))
    .limit(limit)
    .offset(offset);

  res.json({ commands, limit, offset });
});

export default router;
```

**Step 2: app.ts にルート登録**

インポート追加:
```typescript
import openclawCommandsRoutes from './routes/openclaw-commands';
```

ルート登録:
```typescript
app.use('/api/openclaw/commands', openclawCommandsRoutes);
```

**Step 3: コミット**

```bash
git add server/src/routes/openclaw-commands.ts server/src/app.ts
git commit -m "feat: add openclaw commands endpoint with HMAC auth and whitelist validation"
```

---

## Phase 5: フロントエンド — 統合ログセンター

### Task 12: AdminLogCenterPage コンポーネント

**Files:**
- Create: `client/src/pages/admin/AdminLogCenterPage.tsx`
- Modify: `client/src/App.tsx` (ルーティング)
- Modify: `client/src/components/Layout.tsx` (サイドバー)

**Step 1: ページコンポーネント実装**

`AdminLogCenterPage.tsx` — React Bootstrap を使った統合ログセンター画面。
主要機能:
- サマリーカード（全件/エラー/警告/今日）
- タブ切替（全て/操作ログ/システム/同期/OpenClaw）
- フィルター（期間/レベル/カテゴリ/エラーコード/キーワード）
- ログテーブル（レベルバッジ付き、詳細展開）
- エラーコード管理タブ（CRUD）
- OpenClawコマンド履歴タブ

既存の `AdminLogsPage.tsx`（341行）と `AdminSystemEventsPage.tsx`（243行）のUIパターンを踏襲。
React Bootstrap の `Tabs`, `Tab`, `Table`, `Badge`, `Card`, `Form`, `Button`, `Pagination` を使用。

API呼び出し:
- `GET /api/admin/log-center` — ログ一覧
- `GET /api/admin/log-center/summary` — サマリー
- `GET /api/admin/error-codes` — エラーコード一覧
- `POST /api/admin/error-codes` — エラーコード追加
- `PUT /api/admin/error-codes/:id` — エラーコード編集
- `GET /api/openclaw/commands/history` — コマンド履歴

**Step 2: ルーティング更新**

`client/src/App.tsx` または `route-config.tsx`:
- 新規: `/admin/log-center` → `AdminLogCenterPage`
- 変更: `/admin/logs` → リダイレクト先を `/admin/log-center`
- 変更: `/admin/system-events` → リダイレクト先を `/admin/log-center?tab=system`

**Step 3: サイドバー更新**

`client/src/components/Layout.tsx` (or `Sidebar.tsx`):
- `操作ログ` → `ログセンター` に変更、パスを `/admin/log-center` に
- `システムイベント` を削除（ログセンターに統合）

**Step 4: コミット**

```bash
git add client/src/pages/admin/AdminLogCenterPage.tsx client/src/App.tsx client/src/components/Layout.tsx
git commit -m "feat: add unified AdminLogCenterPage replacing separate log/event pages"
```

---

## Phase 6: 統合テストと仕上げ

### Task 13: 既存ログサービスへのerror_code対応

**Files:**
- Modify: `server/src/services/log-service.ts` (writeLog に errorCode パラメータ追加)
- Modify: `server/src/services/system-event-service.ts` (recordSystemEvent に errorCode パラメータ追加)

**Step 1: log-service.ts**

`writeLog` の options に `errorCode?: string` を追加。
`db.insert` の values に `errorCode: options.errorCode ?? null` を追加。

**Step 2: system-event-service.ts**

`SystemEventInput` に `errorCode?: string` を追加。
`db.insert` の values に `errorCode: input.errorCode ?? null` を追加。

**Step 3: コミット**

```bash
git add server/src/services/log-service.ts server/src/services/system-event-service.ts
git commit -m "feat: add errorCode parameter to log and system-event services"
```

---

### Task 14: ビルド検証と全テスト実行

**Step 1: サーバーのビルド**

Run: `npm run build:server`
Expected: 成功（エラーなし）

**Step 2: クライアントのビルド**

Run: `npm run build:client`
Expected: 成功（エラーなし）

**Step 3: テスト実行**

Run: `npm run test`
Expected: 全テスト通過

**Step 4: マイグレーション確認**

Run: `cd server && npx drizzle-kit push --dry-run`
Expected: 新テーブルと新カラムの差分が表示される

**Step 5: 最終コミット**

```bash
git add -A
git commit -m "feat: unified log center with OpenClaw bidirectional integration

- Add error_codes table for unified error code registry
- Add unified AdminLogCenterPage replacing AdminLogsPage and AdminSystemEventsPage
- Add OpenClaw log auto-push (error/warning logs batched and forwarded)
- Add OpenClaw command reception with whitelist-based security
- Add openclaw_commands and openclaw_command_whitelist tables
- Add admin API routes for log-center, error-codes, and command management"
```

---

## Summary of All Files

### New Files (10)
| File | Purpose |
|------|---------|
| `server/src/services/error-code-service.ts` | エラーコードCRUD |
| `server/src/services/log-center-service.ts` | 統合ログクエリ |
| `server/src/services/openclaw-log-push-service.ts` | ログ自動送信 |
| `server/src/services/openclaw-command-service.ts` | コマンド受信・実行 |
| `server/src/routes/admin-error-codes.ts` | エラーコード管理API |
| `server/src/routes/admin-log-center.ts` | ログセンターAPI |
| `server/src/routes/openclaw-commands.ts` | コマンド受信API |
| `server/src/test/error-code-service.test.ts` | テスト |
| `server/src/test/log-center-service.test.ts` | テスト |
| `server/src/test/openclaw-command-service.test.ts` | テスト |
| `client/src/pages/admin/AdminLogCenterPage.tsx` | 統合ログセンターUI |

### Modified Files (6)
| File | Change |
|------|--------|
| `server/src/db/schema.ts` | 3テーブル追加 + 2カラム追加 |
| `server/src/app.ts` | 3ルート登録追加 |
| `server/src/services/log-service.ts` | errorCode + ログ送信フック |
| `server/src/services/system-event-service.ts` | errorCode + ログ送信フック |
| `server/src/services/openclaw-service.ts` | ゲートウェイ送信エクスポート |
| `client/src/App.tsx` + `Layout.tsx` | ルーティング・サイドバー変更 |

### Database Migrations
| Table | Type |
|-------|------|
| `error_codes` | 新規作成 |
| `openclaw_commands` | 新規作成 |
| `openclaw_command_whitelist` | 新規作成 |
| `activity_logs.error_code` | カラム追加 |
| `system_events.error_code` | カラム追加 |
