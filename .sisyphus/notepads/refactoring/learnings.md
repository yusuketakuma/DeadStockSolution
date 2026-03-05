# Refactoring Learnings

## [2026-02-27] Session ses_35fd1ce96ffeUDlEcHQQ2Y71b3 — Init

### 重要な事実（Metis検証済み）
- matching-service.ts: 390行（過大報告13,912行は誤り）— 既に5ファイルに分割済み
- inventory.ts: 265行（過大報告9,702行は誤り）
- 実際の分割対象: exchange.ts (941行), admin-pharmacies.ts (851行) のみ
- CSRF実装: 完全実装済み（csrf.ts, 38箇所で使用）
- ページネーション: 全エンドポイント parsePagination() で実装済み
- .env: gitignore済み（gitで追跡されていない）

### セキュリティ未対策（実際に修正すべき）
1. error-handler.ts:31 — 4xxで err.message をそのまま返す
2. internal-matching-refresh.ts:14 — `===` 比較（timing attack）
3. internal-monthly-reports.ts:14 — `===` 比較（timing attack）
4. app.ts:111 — `contentSecurityPolicy: false`
5. csrf.ts:69 — `!==` 比較（defense-in-depth）

### パターン参照
- アグリゲーターパターン: server/src/routes/admin.ts を参照
- timingSafeEqual パターン: server/src/services/openclaw-service.ts:221 を参照

### Drizzle / DB
- スキーマ: server/src/db/schema.ts (563行、30+テーブル、40+インデックス)
- マイグレーション: npm run db:generate --workspace=server
- 追加インデックス: dead_stock_items(pharmacy_id, is_available, drug_name), used_medication_items(pharmacy_id, drug_name)

### テスト基盤
- Vitest 4.0, 78+テストファイル
- Coverage閾値: Lines ≥49%, Statements ≥48%, Functions ≥56%, Branches ≥42%
- パフォーマンステスト: npm run test:perf:server (baseline.json)

## [2026-02-28] Task 5: exchange.ts Split

### Route Split Pattern
- Aggregator pattern works cleanly: sub-routers define their own paths, aggregator mounts via `router.use(subRouter)` without path prefix
- Auth middleware (`requireLogin`) applied ONCE in aggregator — sub-files must NOT duplicate it
- Route registration order preserved by mounting sub-routers in same order as original endpoints
- Static routes (e.g. `/proposals/bulk-action`) naturally stay before parameterized routes (e.g. `/proposals/:id`) when in the same sub-file

### Helper Placement
- Each helper/constant moved to the sub-file that uses it exclusively
- `sanitizeProposalActionError` used only by accept/reject/complete → exchange-status.ts
- `sanitizeBulkActionErrorMessage` + bulk helpers used only by bulk-action → exchange-proposals.ts
- Comment rate-limit constants used only by POST comments → exchange-comments.ts
- No shared helpers needed across multiple sub-files (clean separation)

### Verification
- Existing tests (exchange-route-priority.test.ts) pass without modification — they import the aggregator which transparently delegates to sub-routers
- 941 lines → 19 line aggregator + 5 focused sub-files (435+69+329+94+68 = 995 total)
- Zero business logic changes — pure file structure refactoring

## [2026-02-28] Task 6: admin-pharmacies.ts Split

### Route Split Pattern
- Same aggregator pattern as exchange.ts: 12-line aggregator + 3 sub-files
- admin.ts already handles `requireLogin` + `requireAdmin` — sub-files must NOT add auth middleware
- Route order preserved: list endpoints first, then detail/CRUD, then special actions

### Shared Resource Duplication
- `adminWriteLimiter` used by both detail.ts (3 PUT) and actions.ts (2 POST) — defined locally in each file
- This is intentional: each rate limiter instance has its own counter, which is correct behavior for route-level limiting
- Alternative (shared module) would be over-engineering for a simple rate-limit config

### Helper Placement
- `isValidVersion` → detail.ts only (used by PUT /pharmacies/:id and PUT /business-hours)
- `AdminHandoffResponse` type + `collectAdminHandoffContext` + `buildAdminHandoffResponse` + `sendAdminHandoffResponse` → actions.ts only
- Clean separation: no helper needed by multiple sub-files (except adminWriteLimiter, duplicated by design)

### Verification
- admin.ts NOT modified — it imports admin-pharmacies.ts which now transparently delegates to sub-routers
- 851 lines → 12 line aggregator + 3 focused sub-files (177+455+262 = 894 total)
- All 379 tests pass, typecheck clean, build succeeds
- Zero business logic changes — pure file structure refactoring

## [2026-02-28] Task 7: matching-refresh N+1 Elimination

### Matching Batch Pattern
- Additive API worked best: keep `findMatches(pharmacyId)` unchanged for existing route callers and add `findMatchesBatch(pharmacyIds)` for refresh pipeline only
- Batch once per refresh job: `runSingleRefresh` resolves `impactedIds`, executes one `findMatchesBatch(impactedIds)`, then consumes map entries in loop
- Shared query sets to prefetch once: candidate pool pharmacies, block relationships (both directions), dead stock, used meds, reservations, business/special hours

### Correctness Guardrails
- Keep single-pharmacy path intact to preserve unit tests that assert specific query-shape behavior (`notExists` + bidirectional block predicates)
- In batch path, preserve scoring/filtering/sorting logic exactly and only change data-fetch granularity
- Add missing export mock (`findMatchesBatch`) in matching-refresh tests to avoid ESM named export mismatch

### Perf Test Stability
- Perf regression suite can hit route-level limiter due repeated `/api/exchange/find` benchmark calls
- Mocking `express-rate-limit` as pass-through inside `performance-regression.test.ts` stabilizes benchmark execution and removes non-performance 429 noise

## [2026-02-28] Task 8: Composite DB Indexes

### Index Design Pattern
- Drizzle ORM index syntax: `index('idx_name').on(table.col1, table.col2, ...)`
- Column order matters: leftmost columns are most selective for query filtering
- Composite indexes support prefix matching (e.g., index on (A, B, C) helps queries filtering on A, A+B, or A+B+C)

### Indexes Added
1. `dead_stock_items`: (pharmacy_id, is_available, drug_name)
   - Supports pharmacy-specific available inventory lookups by drug name
   - Complements existing `idx_dead_stock_pharmacy_available_created` (different sort order)
   - Does NOT duplicate existing indexes (verified against 7 existing indexes)

2. `used_medication_items`: (pharmacy_id, drug_name)
   - Supports pharmacy-specific usage lookups by drug name
   - Complements existing `idx_used_medication_pharmacy_created` (different sort order)
   - Does NOT duplicate existing indexes (verified against 3 existing indexes)

### Migration Generation
- `npm run db:generate --workspace=server` creates migration file automatically
- Drizzle compares schema.ts against drizzle/meta/ snapshots
- Generated SQL uses PostgreSQL btree algorithm (default)
- Migration file: `drizzle/0018_tricky_gauntlet.sql`

### Verification
- All 379 tests pass (1 skipped)
- TypeScript: 0 errors
- No schema changes (columns, types, constraints unchanged)
- No existing indexes modified or deleted
- Commit: `perf(db): add composite indexes for pharmacy+drug_name queries`

## [2026-02-28] Task 9: Tests for Split Route Modules

### Mock Query Patterns
- `createFromQuery`: For `db.select({count}).from(table)` where `.from()` is terminal (no `.where()`) — common in count queries
- `createPaginatedQuery`: For full paginated chains (from → orderBy → limit → offset resolves)
- `createJoinOrderByQuery`: For queries with innerJoin + where + orderBy terminal — used by admin exchange comments
- `createLimitQuery`: For existence checks (from → where → limit resolves)
- `createWhereQuery`: For queries where `.where()` is terminal (from → where resolves)
- Key insight: The terminal method in a Drizzle query chain is the one that resolves the promise — mock that with `.mockResolvedValue()`

### Test Coverage
- 56 new tests across 2 files (379 → 435 total)
- exchange-subroutes.test.ts: status (accept/reject/complete), feedback, history, comments (GET + POST)
- admin-pharmacies-subroutes.test.ts: list (options/pharmacies/history/messages/requests), detail (CRUD/business-hours/toggle), actions (exchanges/comments/messages/handoff)
- Coverage improved: Lines 56.67%, Statements 54.96%, Functions 63.48%, Branches 45.23%

### Pattern: Admin Auth Mock
- Admin routes need both `requireLogin` and `requireAdmin` mocked
- Auth mock sets `isAdmin: true` for admin route tests vs `isAdmin: false` for exchange route tests
- Rate limiter must be mocked as pass-through: `vi.mock('express-rate-limit', () => ({ default: () => (req, res, next) => next() }))`

### Pattern: Drizzle ORM Mock
- All drizzle-orm exports must be mocked even if not all are used by the specific route under test
- The aggregator imports all sub-routers, so all their drizzle-orm dependencies must be available
- Transaction mock needs to provide tx object with execute/select/insert methods for comment POST testing

## [2026-02-28] Multi-angle Review Fix Pass

### Security hardening follow-up
- Internal cron endpoints should avoid returning raw validation text even when protected by bearer secret
- `server/src/routes/internal-monthly-reports.ts` now returns fixed 400 text (`年月パラメータが不正です`) instead of propagating thrown detail
- Keep operator observability in logs, not in HTTP payloads; this preserves debuggability without leaking parser internals

### Regression-test guardrails
- Added route test file for internal monthly report endpoint: auth failure, sanitized validation failure, and success path
- Added production-mode test in error-handler suite to lock behavior that 4xx details are hidden in production
- Security behavior changes should always ship with explicit tests so future refactors cannot silently revert them

## [2026-03-05] Task 12: openclaw-service.ts Simplification

### Refactoring Pattern: Generic Helper Extraction
- **pruneExpiredMapEntries<K, V>()**: Generic helper for cache pruning
  - Constraint: `V extends { expiresAtMs: number }`
  - Eliminates duplication between webhookReplayCache (Map<string, number>) and handoffResultCache (Map<string, { expiresAtMs: number; result: ... }>)
  - Note: webhookReplayCache stores raw numbers, not objects, so it keeps its own pruneWebhookReplayCache() function
  - handoffResultCache now delegates to generic helper via pruneExpiredMapEntries(handoffResultCache, nowMs)

### Refactoring Pattern: Options Object Helper
- **buildHandoffSuccess()**: Consolidates success response construction
  - Takes config + options object with (status, threadId, summary, note)
  - Spreads options into response object
  - Eliminates duplication between handoffViaGatewayCli (status: 'in_dialogue') and handoffViaLegacyHttp (status: dynamic)
  - Both callers now use: `buildHandoffSuccess(config, { status, threadId, summary, note })`

### Verification
- All 99 tests pass (3 test files: openclaw-service.test.ts, openclaw-service-deep.test.ts, openclaw-service-ultra.test.ts)
- typecheck: 0 errors
- lint: 0 warnings
- No behavior changes, no API signature changes
- Reduced duplication: 2 success returns → 1 helper + 2 calls, 2 prune functions → 1 helper + 1 call

### Multi-angle Review Results
- **Correctness**: All behavior preserved, type safety maintained, edge cases handled
- **Security**: No regressions, no new input processing, helpers are internal
- **Performance**: No degradation, same O(n) for pruning, O(1) for object spread
- **Maintainability**: Clearer intent, reduced duplication, consistent naming
- **UX**: No user-facing changes, logging preserved, observability maintained

### Key Insight
Generic constraint pattern (`V extends { expiresAtMs: number }`) is effective for consolidating similar operations on different Map types. The constraint ensures type safety while allowing code reuse.

## [2026-03-05] Security Audit Findings

### P1 Fixes Applied
1. **Command Injection Defense** in `openclaw-service.ts`
   - Added `sanitizeCliMessage()` helper to remove control characters and shell metacharacters
   - Applied to `input.requestText` before passing to `execFile`
   - Defense-in-depth: `execFile` doesn't use shell, but sanitization prevents edge cases

### P2 Fixes Applied
1. **Input Validation** in `internal-monthly-reports.ts`
   - Replaced `Number()` with `parsePositiveInt()` utility
   - Added year range validation (2020-2099)
   - Added month range validation (1-12)
   - Specific error messages for each validation failure

### Already Secure (No Changes Needed)
- SQL Injection: Drizzle ORM with parameterized queries ✓
- XSS: No `dangerouslySetInnerHTML` usage ✓
- CSRF: Proper implementation with timing-safe comparison ✓
- CSP Headers: Properly configured in app.ts ✓
- Error Handling: Production mode hides details ✓
- Rate Limiting: Implemented on auth endpoints ✓
- Webhook Security: `crypto.timingSafeEqual` used ✓

### Security Patterns to Follow
- Always use `parsePositiveInt()` from `request-utils.ts` for integer parsing
- Always use `timingSafeEqual` for secret comparison
- Sanitize user input before passing to external processes
- Validate ranges explicitly (not just type checking)
Generic constraint pattern (`V extends { expiresAtMs: number }`) is effective for consolidating similar operations on different Map types. The constraint ensures type safety while allowing code reuse.
