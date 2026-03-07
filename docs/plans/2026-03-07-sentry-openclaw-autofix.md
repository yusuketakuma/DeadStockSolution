# Sentry → OpenClaw 自律修正連携 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** サーバー 5xx エラーを Sentry + OpenClaw 経由で自律修正する仕組みを構築する

**Architecture:** error-handler で 5xx エラーを検知 → Sentry に captureException（既存）+ エラーコンテキスト付きで OpenClaw にハンドオフ → OpenClaw が codex exec でブランチ作成・修正・PR 作成。既存の `openclaw-auto-handoff-service.ts` の import failure パターンを踏襲し、`openclaw-error-autofix-service.ts` を新規作成する。

**Tech Stack:** Express 5, @sentry/node, OpenClaw CLI/HTTP connector (既存)

---

### Task 1: captureException の戻り値で eventId を返す

**Files:**
- Modify: `server/src/config/sentry.ts`

**Step 1: 実装を変更**

`captureException` が Sentry の eventId を返すように変更:

```typescript
import * as Sentry from '@sentry/node';

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
}

export function captureException(err: unknown): string | null {
  if (!process.env.SENTRY_DSN) return null;
  return Sentry.captureException(err);
}
```

**Step 2: ビルド確認**

Run: `npm run build:server`
Expected: 成功（戻り値の型が void → string | null に変わるが、呼び出し側は戻り値を使っていないので互換）

**Step 3: コミット**

```bash
git add server/src/config/sentry.ts
git commit -m "refactor: captureException returns Sentry eventId"
```

---

### Task 2: エラーコンテキスト抽出ユーティリティ作成

**Files:**
- Create: `server/src/services/error-fix-context.ts`
- Create: `server/src/test/error-fix-context.test.ts`

**Step 1: テストを書く**

```typescript
import { describe, expect, it } from 'vitest';
import { extractSourceLocation, buildErrorFixContext } from '../services/error-fix-context';

describe('extractSourceLocation', () => {
  it('should extract file and line from stack trace', () => {
    const stack = `Error: something failed
    at Object.<anonymous> (/Users/x/server/src/services/upload-service.ts:42:10)
    at Module._compile (node:internal/modules/cjs/loader:1241:14)`;
    const loc = extractSourceLocation(stack);
    expect(loc).toEqual({
      file: 'server/src/services/upload-service.ts',
      line: 42,
    });
  });

  it('should return null for non-project stack frames', () => {
    const stack = `Error: fail
    at Module._compile (node:internal/modules/cjs/loader:1241:14)`;
    expect(extractSourceLocation(stack)).toBeNull();
  });

  it('should return null for undefined stack', () => {
    expect(extractSourceLocation(undefined)).toBeNull();
  });
});

describe('buildErrorFixContext', () => {
  it('should build context with all fields', () => {
    const err = new Error('DB connection timeout');
    err.stack = `Error: DB connection timeout
    at Object.<anonymous> (/Users/x/server/src/services/exchange-service.ts:100:5)`;
    const ctx = buildErrorFixContext({
      err,
      method: 'POST',
      path: '/api/exchange/propose',
      status: 500,
      sentryEventId: 'abc123',
    });
    expect(ctx.errorMessage).toBe('DB connection timeout');
    expect(ctx.sourceFile).toBe('server/src/services/exchange-service.ts');
    expect(ctx.sourceLine).toBe(100);
    expect(ctx.endpoint).toBe('POST /api/exchange/propose');
    expect(ctx.sentryEventId).toBe('abc123');
    expect(typeof ctx.timestamp).toBe('string');
  });

  it('should handle non-Error objects', () => {
    const ctx = buildErrorFixContext({
      err: 'string error',
      method: 'GET',
      path: '/api/test',
      status: 500,
      sentryEventId: null,
    });
    expect(ctx.errorMessage).toBe('string error');
    expect(ctx.sourceFile).toBeNull();
  });
});
```

**Step 2: テスト実行 → 失敗確認**

Run: `cd server && npx vitest run src/test/error-fix-context.test.ts`
Expected: FAIL (モジュール未作成)

**Step 3: 実装**

```typescript
export interface ErrorFixContext {
  errorMessage: string;
  stackTrace: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  endpoint: string | null;
  sentryEventId: string | null;
  timestamp: string;
}

export interface ErrorFixInput {
  err: unknown;
  method: string;
  path: string;
  status: number;
  sentryEventId: string | null;
}

export function extractSourceLocation(
  stack: string | undefined,
): { file: string; line: number } | null {
  if (!stack) return null;
  // Match project files (not node_modules, not node: internals)
  const match = stack.match(
    /at .+\((?:\/[^)]*\/)?((?:server|client)\/src\/[^:]+):(\d+):\d+\)/,
  );
  if (!match) return null;
  return { file: match[1], line: Number(match[2]) };
}

export function buildErrorFixContext(input: ErrorFixInput): ErrorFixContext {
  const errMessage =
    input.err instanceof Error ? input.err.message : String(input.err);
  const stack =
    input.err instanceof Error ? input.err.stack ?? null : null;
  const loc = extractSourceLocation(stack ?? undefined);

  return {
    errorMessage: errMessage,
    stackTrace: stack,
    sourceFile: loc?.file ?? null,
    sourceLine: loc?.line ?? null,
    endpoint: `${input.method} ${input.path}`,
    sentryEventId: input.sentryEventId,
    timestamp: new Date().toISOString(),
  };
}
```

**Step 4: テスト実行 → 成功確認**

Run: `cd server && npx vitest run src/test/error-fix-context.test.ts`
Expected: PASS (5 tests)

**Step 5: コミット**

```bash
git add server/src/services/error-fix-context.ts server/src/test/error-fix-context.test.ts
git commit -m "feat: add error-fix-context utility for OpenClaw autofix"
```

---

### Task 3: OpenClaw エラー自動修正サービス作成

**Files:**
- Create: `server/src/services/openclaw-error-autofix-service.ts`
- Create: `server/src/test/openclaw-error-autofix-service.test.ts`

**Step 1: テストを書く**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorFixContext } from '../services/error-fix-context';

const mocks = vi.hoisted(() => ({
  handoffToOpenClaw: vi.fn(),
  dbInsert: vi.fn(),
  dbUpdate: vi.fn(),
}));

vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: mocks.handoffToOpenClaw,
}));

vi.mock('../config/database', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: mocks.dbInsert }) }),
    update: () => ({ set: () => ({ where: mocks.dbUpdate }) }),
  },
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  handoffErrorToOpenClaw,
  _resetDedupCacheForTests,
} from '../services/openclaw-error-autofix-service';

function makeContext(overrides?: Partial<ErrorFixContext>): ErrorFixContext {
  return {
    errorMessage: 'test error',
    stackTrace: null,
    sourceFile: 'server/src/services/test.ts',
    sourceLine: 42,
    endpoint: 'POST /api/test',
    sentryEventId: 'evt123',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('handoffErrorToOpenClaw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDedupCacheForTests();
    vi.stubEnv('OPENCLAW_ERROR_AUTOFIX_ENABLED', 'true');
    vi.stubEnv('OPENCLAW_ERROR_AUTOFIX_PHARMACY_ID', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should skip when disabled', async () => {
    vi.stubEnv('OPENCLAW_ERROR_AUTOFIX_ENABLED', 'false');
    const result = await handoffErrorToOpenClaw(makeContext(), 500);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('should skip 4xx errors', async () => {
    const result = await handoffErrorToOpenClaw(makeContext(), 400);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('not_5xx');
  });

  it('should deduplicate same error within window', async () => {
    mocks.dbInsert.mockResolvedValue([{ id: 1 }]);
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: true, status: 'in_dialogue',
      threadId: 't1', summary: 's1', note: 'ok',
    });

    await handoffErrorToOpenClaw(makeContext(), 500);
    const result = await handoffErrorToOpenClaw(makeContext(), 500);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('deduplicated');
  });

  it('should trigger handoff for 5xx', async () => {
    mocks.dbInsert.mockResolvedValue([{ id: 1 }]);
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: true, status: 'in_dialogue',
      threadId: 't1', summary: 's1', note: 'ok',
    });

    const result = await handoffErrorToOpenClaw(makeContext(), 500);
    expect(result.triggered).toBe(true);
    expect(result.accepted).toBe(true);
    expect(mocks.handoffToOpenClaw).toHaveBeenCalledOnce();
  });
});
```

**Step 2: テスト実行 → 失敗確認**

Run: `cd server && npx vitest run src/test/openclaw-error-autofix-service.test.ts`
Expected: FAIL

**Step 3: 実装**

ファイル: `server/src/services/openclaw-error-autofix-service.ts`

既存の `openclaw-auto-handoff-service.ts` パターンを踏襲:
- 環境変数 `OPENCLAW_ERROR_AUTOFIX_ENABLED` で有効/無効
- 環境変数 `OPENCLAW_ERROR_AUTOFIX_PHARMACY_ID` でハンドオフ先薬局
- 環境変数 `OPENCLAW_ERROR_AUTOFIX_DEDUP_MINUTES` でデデュプ間隔 (デフォルト 60分)
- エラーフィンガープリント = `errorMessage + sourceFile` でデデュプ
- 5xx のみトリガー
- `user_requests` テーブルに記録 → `handoffToOpenClaw` 呼び出し

```typescript
import { db } from '../config/database';
import { userRequests } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from './logger';
import { handoffToOpenClaw, type OpenClawStatus } from './openclaw-service';
import type { ErrorFixContext } from './error-fix-context';
import { parsePositiveInt } from '../utils/request-utils';
import { parseBoundedInt } from '../utils/number-utils';

export interface ErrorAutoFixResult {
  triggered: boolean;
  accepted: boolean;
  requestId: number | null;
  reason: string;
}

const AUTO_REQUEST_TEXT_PREFIX = '[自動修正] Sentry エラー検知:';
const dedupCache = new Map<string, number>();

function readConfig() {
  return {
    enabled: process.env.OPENCLAW_ERROR_AUTOFIX_ENABLED === 'true',
    pharmacyId: parsePositiveInt(
      process.env.OPENCLAW_ERROR_AUTOFIX_PHARMACY_ID,
    ),
    dedupMinutes: parseBoundedInt(
      process.env.OPENCLAW_ERROR_AUTOFIX_DEDUP_MINUTES,
      60,
      1,
      1440,
    ),
  };
}

function buildFingerprint(ctx: ErrorFixContext): string {
  return `${ctx.errorMessage}::${ctx.sourceFile ?? 'unknown'}`;
}

function isDeduplicated(fingerprint: string, dedupMinutes: number): boolean {
  const lastSeen = dedupCache.get(fingerprint);
  if (!lastSeen) return false;
  return Date.now() - lastSeen < dedupMinutes * 60_000;
}

function buildRequestText(ctx: ErrorFixContext): string {
  const parts = [
    AUTO_REQUEST_TEXT_PREFIX,
    ctx.errorMessage,
    ctx.sourceFile
      ? `ファイル: ${ctx.sourceFile}:${ctx.sourceLine}`
      : '',
    ctx.endpoint ? `エンドポイント: ${ctx.endpoint}` : '',
    ctx.sentryEventId
      ? `Sentry Event: ${ctx.sentryEventId}`
      : '',
    'エラーを分析し、修正ブランチを作成してPRを出してください。',
  ].filter(Boolean);
  return parts.join(' ').slice(0, 2000);
}

function buildContext(
  ctx: ErrorFixContext,
): Record<string, unknown> {
  return {
    source: 'sentry_error_autofix',
    errorContext: {
      errorMessage: ctx.errorMessage,
      stackTrace: ctx.stackTrace,
      sourceFile: ctx.sourceFile,
      sourceLine: ctx.sourceLine,
      endpoint: ctx.endpoint,
      sentryEventId: ctx.sentryEventId,
      timestamp: ctx.timestamp,
    },
    instructions: [
      '1. エラーの根本原因を特定してください',
      '2. preview ブランチから修正ブランチを作成してください',
      '3. テストを追加/修正してください',
      '4. PR を作成してください（タイトルに Sentry eventId を含める）',
      '5. main ブランチへの直接変更は禁止です',
    ],
  };
}

function skipped(reason: string): ErrorAutoFixResult {
  return {
    triggered: false,
    accepted: false,
    requestId: null,
    reason,
  };
}

export async function handoffErrorToOpenClaw(
  ctx: ErrorFixContext,
  status: number,
): Promise<ErrorAutoFixResult> {
  const config = readConfig();
  if (!config.enabled) return skipped('disabled');
  if (!config.pharmacyId) {
    logger.warn(
      'OpenClaw error autofix skipped: invalid pharmacy ID',
    );
    return skipped('invalid_pharmacy_id');
  }
  if (status < 500) return skipped('not_5xx');

  const fingerprint = buildFingerprint(ctx);
  if (isDeduplicated(fingerprint, config.dedupMinutes)) {
    logger.info('OpenClaw error autofix deduplicated', {
      fingerprint,
    });
    return skipped('deduplicated');
  }

  try {
    dedupCache.set(fingerprint, Date.now());

    const requestText = buildRequestText(ctx);
    const [created] = await db
      .insert(userRequests)
      .values({
        pharmacyId: config.pharmacyId,
        requestText,
        openclawStatus: 'pending_handoff',
      })
      .returning({ id: userRequests.id });

    const handoff = await handoffToOpenClaw({
      requestId: created.id,
      pharmacyId: config.pharmacyId,
      requestText,
      context: buildContext(ctx),
    });

    if (handoff.accepted) {
      await db
        .update(userRequests)
        .set({
          openclawStatus: handoff.status as string,
          openclawThreadId: handoff.threadId,
          openclawSummary: handoff.summary,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userRequests.id, created.id));
    }

    logger.info('OpenClaw error autofix handoff completed', {
      requestId: created.id,
      accepted: handoff.accepted,
      fingerprint,
    });

    return {
      triggered: true,
      accepted: handoff.accepted,
      requestId: created.id,
      reason: handoff.note,
    };
  } catch (err) {
    logger.error('OpenClaw error autofix failed', {
      error: err instanceof Error ? err.message : String(err),
      fingerprint,
    });
    return skipped('error');
  }
}

/** Test-only: reset dedup cache */
export function _resetDedupCacheForTests(): void {
  dedupCache.clear();
}
```

**Step 4: テスト実行 → 成功確認**

Run: `cd server && npx vitest run src/test/openclaw-error-autofix-service.test.ts`
Expected: PASS (4 tests)

**Step 5: コミット**

```bash
git add server/src/services/openclaw-error-autofix-service.ts server/src/test/openclaw-error-autofix-service.test.ts
git commit -m "feat: add openclaw-error-autofix-service for Sentry error auto-fix"
```

---

### Task 4: error-handler に自動修正ハンドオフを統合

**Files:**
- Modify: `server/src/middleware/error-handler.ts`
- Modify: `server/src/test/error-handler-middleware.test.ts`

**Step 1: テスト追加**

`error-handler-middleware.test.ts` に以下を追加:

```typescript
// 既存の mock セクションに追加
vi.mock('../services/openclaw-error-autofix-service', () => ({
  handoffErrorToOpenClaw: vi.fn().mockResolvedValue({
    triggered: false, accepted: false, requestId: null, reason: 'disabled',
  }),
}));

vi.mock('../services/error-fix-context', () => ({
  buildErrorFixContext: vi.fn().mockReturnValue({
    errorMessage: 'test',
    stackTrace: null,
    sourceFile: null,
    sourceLine: null,
    endpoint: 'GET /test',
    sentryEventId: null,
    timestamp: '2026-01-01T00:00:00.000Z',
  }),
}));
```

テストケース:
```typescript
describe('OpenClaw error autofix integration', () => {
  it('should call handoffErrorToOpenClaw for 5xx errors', async () => {
    const { handoffErrorToOpenClaw } = await import(
      '../services/openclaw-error-autofix-service'
    );
    const err = new Error('DB timeout');
    // trigger errorHandler with 500 error
    // ...verify handoffErrorToOpenClaw was called
    expect(handoffErrorToOpenClaw).toHaveBeenCalled();
  });
});
```

**Step 2: error-handler.ts を変更**

```typescript
// 追加 import
import { buildErrorFixContext } from '../services/error-fix-context';
import { handoffErrorToOpenClaw } from '../services/openclaw-error-autofix-service';

// errorHandler 内、captureException の後に追加:
  const eventId = captureException(err);
  // ... existing logger.error ...
  // ... existing recordHttpUnhandledError ...

  // 5xx の場合のみ OpenClaw 自動修正ハンドオフ（非ブロック）
  if (status >= 500) {
    const fixContext = buildErrorFixContext({
      err,
      method: req.method,
      path: req.path,
      status,
      sentryEventId: eventId,
    });
    void handoffErrorToOpenClaw(fixContext, status);
  }
```

**Step 3: ビルド & テスト確認**

Run: `npm run build:server && cd server && npx vitest run src/test/error-handler-middleware.test.ts`
Expected: PASS

**Step 4: コミット**

```bash
git add server/src/middleware/error-handler.ts server/src/test/error-handler-middleware.test.ts
git commit -m "feat: integrate OpenClaw error autofix into error-handler"
```

---

### Task 5: Plans.md 更新 & 最終統合テスト

**Files:**
- Modify: `Plans.md`

**Step 1: 全テスト実行**

Run: `npm run test:server`
Expected: 全テスト通過

**Step 2: ビルド確認**

Run: `npm run build:server`
Expected: 成功

**Step 3: Plans.md にタスク追加 & 完了マーク**

**Step 4: コミット**

```bash
git add Plans.md
git commit -m "feat: Sentry → OpenClaw autofix integration complete"
```
