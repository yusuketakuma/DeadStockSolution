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
