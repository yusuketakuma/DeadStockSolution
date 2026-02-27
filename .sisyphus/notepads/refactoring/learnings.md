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
