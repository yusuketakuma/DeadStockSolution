# Database Schema Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 44 テーブル・9 スキーマファイルを 40 テーブル・13 ファイルにゼロベース再設計し、冗長テーブル排除・JSON jsonb 統一・ドメイン分割を実施する。

**Architecture:** 6 フェーズの段階的マイグレーション。Phase 1 はコードのみ（DB 変更なし）、Phase 2-6 は DB スキーマ変更 + サービス/ルートのコード更新。各フェーズは独立デプロイ可能。全フェーズで typecheck + 4610+ テスト全パスを維持する。

**Tech Stack:** Drizzle ORM, PostgreSQL (Vercel Postgres/Neon), TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-17-database-schema-redesign.md`

---

## Chunk 1: Phase 1 — Schema File Reorganization (DB 変更なし)

### Task 1: schema-pharmacy.ts を作成（pharmacies + 営業時間 + 関係性を分離）

**Files:**
- Create: `server/src/db/schema-pharmacy.ts`
- Modify: `server/src/db/schema-auth.ts` — pharmacies, pharmacyBusinessHours, pharmacySpecialHours, pharmacyRelationships を削除
- Modify: `server/src/db/schema.ts` — re-export 更新

- [ ] **Step 1: schema-pharmacy.ts を作成**

schema-auth.ts から以下のテーブル定義 + relations をコピーして新ファイルを作成:
- `pharmacies`
- `pharmacyBusinessHours`
- `pharmacySpecialHours`
- `pharmacyRelationships`
- 関連する relations 定義
- import: `schema-common.ts` から必要な enum を import

- [ ] **Step 2: schema-auth.ts から移動したテーブルを削除**

schema-auth.ts に残すのは:
- `passwordResetTokens`
- `pharmacyRegistrationReviews`
- 関連する relations
- import を `./schema-pharmacy` からの pharmacies 参照に変更

- [ ] **Step 3: 全スキーマファイルの import パスを更新**

以下のファイルで `from './schema-auth'` の `pharmacies` import を `from './schema-pharmacy'` に変更:
- `server/src/db/schema-inventory.ts`
- `server/src/db/schema-exchange.ts`
- `server/src/db/schema-matching.ts`
- `server/src/db/schema-notification.ts`
- `server/src/db/schema-drug-master.ts`
- `server/src/db/schema-upload-jobs.ts`
- `server/src/db/schema-admin.ts`

- [ ] **Step 4: schema.ts の re-export を更新**

```typescript
export * from './schema-common';
export * from './schema-pharmacy';
export * from './schema-auth';
// ... (残りはそのまま)
```

- [ ] **Step 5: typecheck を実行して確認**

Run: `npm run typecheck`
Expected: PASS（import パスの更新漏れがあればここで検出）

- [ ] **Step 6: テスト実行**

Run: `npm run test:server`
Expected: 4610+ tests PASS

- [ ] **Step 7: コミット**

```bash
git add server/src/db/schema-pharmacy.ts server/src/db/schema-auth.ts server/src/db/schema.ts server/src/db/schema-*.ts
git commit -m "refactor: extract schema-pharmacy.ts from schema-auth.ts"
```

---

### Task 2: schema-pharmacy-group.ts を作成（グループ + メンバーを分離）

**Files:**
- Create: `server/src/db/schema-pharmacy-group.ts`
- Modify: `server/src/db/schema-auth.ts` — pharmacyGroups, groupMembers を削除
- Modify: `server/src/db/schema.ts`

- [ ] **Step 1: schema-pharmacy-group.ts を作成**

schema-auth.ts から以下を移動:
- `pharmacyGroups`
- `groupMembers`
- 関連する relations
- import: `./schema-pharmacy` から pharmacies

- [ ] **Step 2: schema-auth.ts からグループ関連を削除**

- [ ] **Step 3: schema.ts の re-export に追加**

```typescript
export * from './schema-pharmacy-group';
```

- [ ] **Step 4: typecheck + テスト**

Run: `npm run typecheck && npm run test:server`
Expected: ALL PASS

- [ ] **Step 5: コミット**

```bash
git add server/src/db/schema-pharmacy-group.ts server/src/db/schema-auth.ts server/src/db/schema.ts
git commit -m "refactor: extract schema-pharmacy-group.ts from schema-auth.ts"
```

---

### Task 3: schema-admin.ts を 4 ファイルに分割

**Files:**
- Create: `server/src/db/schema-audit.ts`
- Create: `server/src/db/schema-analytics.ts`
- Create: `server/src/db/schema-openclaw.ts`
- Create: `server/src/db/schema-system.ts` (systemEvents, errorCodes) — spec では schema-audit.ts に含めるが、先に分割してから統合
- Delete: `server/src/db/schema-admin.ts`
- Modify: `server/src/db/schema.ts`

- [ ] **Step 1: schema-audit.ts を作成**

schema-admin.ts から移動:
- `adminAuditLogs`
- `activityLogs`
- `systemEvents`
- `errorCodes`
- import: `./schema-pharmacy` から pharmacies

- [ ] **Step 2: schema-analytics.ts を作成**

schema-admin.ts から移動:
- `monthlyReports`
- `predictiveAlerts`
- import: `./schema-pharmacy` から pharmacies, `./schema-notification` から notifications

- [ ] **Step 3: schema-openclaw.ts を作成**

schema-admin.ts から移動:
- `openclawCommands`
- `openclawCommandWhitelist`

schema-auth.ts から移動:
- `userRequests`（+ 関連 relations）
- import: `./schema-pharmacy` から pharmacies

- [ ] **Step 4: schema-admin.ts を削除**

pharmacyTrustScores は Phase 3 で pharmacies に統合するため、一時的に schema-analytics.ts に仮配置する。

- [ ] **Step 5: schema.ts の re-export を更新**

```typescript
export * from './schema-common';
export * from './schema-pharmacy';
export * from './schema-pharmacy-group';
export * from './schema-auth';
export * from './schema-inventory';
export * from './schema-exchange';
export * from './schema-matching';
export * from './schema-notification';
export * from './schema-drug-master';
export * from './schema-upload-jobs';
export * from './schema-audit';
export * from './schema-analytics';
export * from './schema-openclaw';
```

- [ ] **Step 6: csv-export-service.ts の直接 import を修正**

`server/src/services/csv-export-service.ts` は `schema-admin` から直接 import している:
```typescript
// 修正前
import { activityLogs } from '../db/schema-admin';
// 修正後
import { activityLogs } from '../db/schema';
```
（他のサービスは `../db/schema` バレル経由なので影響なし）

- [ ] **Step 7: typecheck + テスト**

Run: `npm run typecheck && npm run test:server`
Expected: ALL PASS

- [ ] **Step 8: コミット**

```bash
git add server/src/db/schema-*.ts server/src/db/schema.ts server/src/services/csv-export-service.ts
git commit -m "refactor: split schema-admin.ts into audit, analytics, openclaw"
```

---

### Task 4: schema-upload-jobs.ts を schema-inventory.ts に統合

**Files:**
- Modify: `server/src/db/schema-inventory.ts` — uploadConfirmJobs, uploadRowIssues を追加
- Delete: `server/src/db/schema-upload-jobs.ts`
- Modify: `server/src/db/schema.ts`

- [ ] **Step 1: schema-upload-jobs.ts のテーブル定義を schema-inventory.ts に移動**

uploadConfirmJobs, uploadRowIssues + relations を schema-inventory.ts に追加。
import の追加: `uploadJobStatusEnum` from `./schema-common`

- [ ] **Step 2: schema-upload-jobs.ts を削除**

- [ ] **Step 3: schema.ts から schema-upload-jobs の re-export を削除**

- [ ] **Step 4: typecheck + テスト**

Run: `npm run typecheck && npm run test:server`
Expected: ALL PASS

- [ ] **Step 5: コミット**

```bash
git add server/src/db/schema-inventory.ts server/src/db/schema.ts
git rm server/src/db/schema-upload-jobs.ts
git commit -m "refactor: merge schema-upload-jobs.ts into schema-inventory.ts"
```

---

## Chunk 2: Phase 2 — JSON text → jsonb Conversion

### Task 5: Drizzle スキーマの JSON カラム型を text → jsonb に変更

**Files:**
- Modify: `server/src/db/schema-matching.ts` — matchCandidateSnapshots.topCandidatesJson
- Modify: `server/src/db/schema-drug-master.ts` — drugMasterSourceState.metadataJson
- Modify: `server/src/db/schema-audit.ts` — activityLogs.metadataJson, systemEvents.detailJson
- Modify: `server/src/db/schema-analytics.ts` — monthlyReports.reportJson, predictiveAlerts.detailJson
- Modify: `server/src/db/schema-openclaw.ts` — openclawCommands.parameters/result, openclawCommandWhitelist.parametersSchema
- Modify: `server/src/db/schema-inventory.ts` — uploadConfirmJobs.mappingJson/resultJson, uploadRowIssues.rowDataJson

- [ ] **Step 1: 各スキーマファイルの JSON カラムを text() → jsonb() に変更**

Drizzle ORM で `text()` → `jsonb()` に変更。例:

```typescript
// 変更前
topCandidatesJson: text('top_candidates_json'),
// 変更後
topCandidatesJson: jsonb('top_candidates_json'),
```

対象 10 カラム（spec Section 4 の 12 カラム中、upload_jobs.column_mapping と upload_jobs.result_json は Phase 4 で upload_jobs テーブル作成時に最初から jsonb で定義するため、ここでは現存する uploadConfirmJobs.mappingJson と uploadConfirmJobs.resultJson を変換する）。

- [ ] **Step 2: サービスコードの JSON.parse/JSON.stringify を削除**

jsonb カラムは Drizzle が自動で JSON ↔ オブジェクト変換するため、手動の parse/stringify が不要になる。

対象サービスを grep で特定:
```bash
grep -rn 'JSON\.parse.*topCandidatesJson\|JSON\.parse.*metadataJson\|JSON\.parse.*detailJson\|JSON\.parse.*reportJson\|JSON\.parse.*mappingJson\|JSON\.parse.*resultJson\|JSON\.parse.*rowDataJson\|JSON\.parse.*parameters\b' server/src/
```

各ヒットを確認し、jsonb 化によって不要になった JSON.parse/stringify を削除。

- [ ] **Step 3: Drizzle migration を生成**

Run: `cd server && npx drizzle-kit generate`
Expected: ALTER TABLE ... ALTER COLUMN ... TYPE jsonb のマイグレーションが生成

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: テスト実行**

Run: `npm run test:server`
Expected: 4610+ tests PASS

- [ ] **Step 6: コミット**

```bash
git add server/src/db/schema-*.ts server/src/services/ server/src/drizzle/
git commit -m "refactor: convert all JSON text columns to jsonb"
```

---

## Chunk 3: Phase 3 — pharmacyTrustScores → pharmacies 統合

### Task 6: pharmacies テーブルに trust カラムを追加 + pharmacyTrustScores 廃止

**Files:**
- Modify: `server/src/db/schema-pharmacy.ts` — trust_score, rating_count, positive_rate カラム追加
- Modify: `server/src/db/schema-analytics.ts` — pharmacyTrustScores テーブル定義削除
- Modify: `server/src/services/trust-score-service.ts` — pharmacies 直接更新に変更
- Modify: `server/src/services/admin-pharmacy-health-service.ts` — pharmacyTrustScores 参照を削除
- Modify: `server/src/routes/statistics.ts` — pharmacyTrustScores 参照を pharmacies に変更

- [ ] **Step 1: テスト先行 — trust-score-service のテストを更新**

trust-score-service のテストで pharmacyTrustScores テーブルではなく pharmacies テーブルの trust_score カラムを参照するように変更。

テストファイルを特定:
```bash
grep -rn 'pharmacyTrustScores' server/src/test/
```

- [ ] **Step 2: pharmacies テーブルにカラム追加**

`server/src/db/schema-pharmacy.ts` の pharmacies テーブルに追加:
```typescript
trustScore: numeric('trust_score', { precision: 5, scale: 2 }).default('60.00'),
ratingCount: integer('rating_count').default(0),
positiveRate: numeric('positive_rate', { precision: 5, scale: 2 }).default('0.00'),
```

- [ ] **Step 3: trust-score-service.ts を更新**

pharmacyTrustScores への INSERT/UPDATE を pharmacies テーブルの直接 UPDATE に変更。

- [ ] **Step 4: 他の参照箇所を更新**

- `admin-pharmacy-health-service.ts`: pharmacyTrustScores JOIN → pharmacies の直接参照
- `statistics.ts`: 同上
- その他 grep で特定した参照箇所

- [ ] **Step 5: pharmacyTrustScores テーブル定義を削除**

`server/src/db/schema-analytics.ts` から pharmacyTrustScores テーブル + relations を削除。
（Phase 1 Task 3 で schema-admin.ts から仮配置したもの。これで schema-analytics.ts には monthlyReports と predictiveAlerts のみ残る — spec の最終構成と一致することを確認。）

- [ ] **Step 6: マイグレーション生成**

Run: `cd server && npx drizzle-kit generate`
Expected: pharmacies に 3 カラム追加 + pharmacyTrustScores DROP のマイグレーション

- [ ] **Step 7: データ移行 SQL を作成**

```sql
-- pharmacyTrustScores → pharmacies にデータコピー
UPDATE pharmacies p
SET trust_score = pts.trust_score,
    rating_count = pts.rating_count,
    positive_rate = pts.positive_rate
FROM pharmacy_trust_scores pts
WHERE p.id = pts.pharmacy_id;
```

この SQL をマイグレーションファイルに追加。

- [ ] **Step 8: typecheck + テスト**

Run: `npm run typecheck && npm run test:server`
Expected: ALL PASS

- [ ] **Step 9: コミット**

```bash
git add server/src/db/ server/src/services/ server/src/routes/ server/src/test/
git commit -m "refactor: merge pharmacyTrustScores into pharmacies table"
```

---

## Chunk 4: Phase 4 — uploads + uploadConfirmJobs → upload_jobs 統合

### Task 7: upload_jobs テーブルを定義 + uploads/uploadConfirmJobs を廃止

**Files:**
- Modify: `server/src/db/schema-inventory.ts` — upload_jobs 定義追加、uploads/uploadConfirmJobs 削除
- Modify: `server/src/services/upload-service.ts` — upload_jobs 参照に変更
- Modify: `server/src/services/upload-confirm-service.ts` — uploads INSERT → upload_jobs
- Modify: `server/src/services/upload-confirm/upload-confirm-query-service.ts` — uploadConfirmJobs → uploadJobs
- Modify: `server/src/services/upload-confirm/upload-confirm-cancel-service.ts` — 同上
- Modify: `server/src/services/upload-confirm/upload-confirm-enqueue-service.ts` — 同上
- Modify: `server/src/services/upload-confirm/upload-confirm-processor-service.ts` — 同上
- Modify: `server/src/services/upload-confirm/upload-confirm-queue-service.ts` — 同上
- Modify: `server/src/services/upload-confirm/upload-confirm-retry-service.ts` — 同上
- Modify: `server/src/services/upload-confirm/upload-confirm-cleanup-service.ts` — 同上
- Modify: `server/src/services/matching-refresh-service.ts` — uploads 参照を upload_jobs に変更
- Modify: `server/src/services/matching-service.ts` — uploads 参照を upload_jobs に変更
- Modify: `server/src/services/matching/matching-data-fetcher.ts` — uploads 参照を upload_jobs に変更
- Modify: `server/src/services/camera-dead-stock-service.ts` — uploads 参照を upload_jobs に変更
- Modify: `server/src/services/monthly-report-service.ts` — uploads 参照を upload_jobs に変更
- Modify: `server/src/services/timeline-fetchers/upload-fetchers.ts` — uploads → uploadJobs
- Modify: `server/src/services/timeline-unread-counts.ts` — uploads 参照を更新
- Modify: `server/src/services/admin-upload-job-service.ts` — uploadConfirmJobs → upload_jobs
- Modify: `server/src/services/monitoring-kpi-service.ts` — uploadConfirmJobs → upload_jobs
- Modify: `server/src/routes/upload.ts` — uploads 参照を upload_jobs に変更
- Modify: `server/src/routes/statistics.ts` — uploads 参照を upload_jobs に変更
- Modify: `server/src/routes/admin-stats.ts` — uploadConfirmJobs → upload_jobs

- [ ] **Step 1: upload_jobs テーブルを schema-inventory.ts に定義**

spec Section 2 の upload_jobs カラム定義に従い、Drizzle テーブルを定義。
column_mapping と result_json は jsonb 型。

- [ ] **Step 2: dead_stock_items と used_medication_items の FK を更新**

```typescript
// 変更前
uploadId: integer('upload_id').references(() => uploads.id),
// 変更後
uploadJobId: integer('upload_job_id').references(() => uploadJobs.id),
```

- [ ] **Step 3: upload_row_issues の FK を更新**

```typescript
// 変更前
jobId: integer('job_id').references(() => uploadConfirmJobs.id),
// 変更後
jobId: integer('job_id').references(() => uploadJobs.id),
```

- [ ] **Step 4: uploads + uploadConfirmJobs テーブル定義を削除**

- [ ] **Step 5: サービスコードを更新**

全サービスの `uploads` / `uploadConfirmJobs` テーブル参照を `uploadJobs` に変更。
grep で全参照を特定:
```bash
grep -rn 'uploads\b\|uploadConfirmJobs' server/src/services/ server/src/routes/
```

主な変更パターン:
- `uploads` → `uploadJobs` (テーブル参照)
- `uploadId` → `uploadJobId` (FK カラム参照)
- `uploadConfirmJobs` → `uploadJobs` (テーブル参照)

- [ ] **Step 6: テストコードを更新**

```bash
grep -rn 'uploads\b\|uploadConfirmJobs\|uploadId' server/src/test/
```
全テストの参照を更新。

- [ ] **Step 7: マイグレーション生成 + データ移行 SQL**

```sql
-- 1. upload_jobs テーブル CREATE（Drizzle 生成）
-- 2. uploadConfirmJobs → upload_jobs にデータ移行
INSERT INTO upload_jobs (...)
SELECT ... FROM upload_confirm_jobs ucj
LEFT JOIN uploads u ON u.pharmacy_id = ucj.pharmacy_id
  AND u.upload_type = ucj.upload_type
  AND u.created_at <= ucj.created_at;
-- 3. dead_stock_items.upload_id → upload_job_id リネーム
ALTER TABLE dead_stock_items RENAME COLUMN upload_id TO upload_job_id;
-- 4. used_medication_items 同上
-- 5. 旧テーブル DROP
```

- [ ] **Step 8: typecheck + テスト**

Run: `npm run typecheck && npm run test:server`
Expected: ALL PASS

- [ ] **Step 9: コミット**

```bash
git add server/src/db/ server/src/services/ server/src/routes/ server/src/test/
git commit -m "refactor: merge uploads + uploadConfirmJobs into upload_jobs"
```

---

## Chunk 5: Phase 5 — matchNotifications → notifications 統合

### Task 8: notifications テーブルにカラム追加 + matchNotifications 廃止

**Files:**
- Modify: `server/src/db/schema-notification.ts` — detail_json, source_pharmacy_id, dedupe_key カラム追加
- Modify: `server/src/db/schema-matching.ts` — matchNotifications テーブル削除
- Modify: `server/src/db/schema-common.ts` — notificationType に 'match_update' 追加
- Modify: `server/src/services/matching-snapshot-service.ts` — matchNotifications → notifications
- Modify: `server/src/services/notification-service.ts` — matchNotifications 参照削除
- Modify: `server/src/services/timeline-unread-counts.ts` — matchNotifications 参照削除
- Modify: `server/src/services/timeline-fetchers/notification-fetchers.ts` — matchNotifications クエリを notifications に変更
- Modify: `server/src/routes/notifications.ts` — UNION クエリ → notifications のみ
- Modify: `server/src/routes/admin-stats.ts` — matchNotifications 参照削除

- [ ] **Step 1: notifications テーブルにカラム追加**

`server/src/db/schema-notification.ts`:
```typescript
detailJson: jsonb('detail_json'),
sourcePharmacyId: integer('source_pharmacy_id').references(() => pharmacies.id),
dedupeKey: text('dedupe_key'),
```

インデックス追加:
```typescript
dedupeKeyIdx: uniqueIndex('notifications_pharmacy_dedupe_key_idx')
  .on(table.pharmacyId, table.dedupeKey)
  .where(sql`dedupe_key IS NOT NULL`),
```

- [ ] **Step 2: notificationType に 'match_update' を追加**

`server/src/db/schema-common.ts` の notificationType 定数に `'match_update'` を追加。

- [ ] **Step 3: matching-snapshot-service.ts を更新**

matchNotifications への INSERT を notifications への INSERT に変更:
```typescript
// 変更前
await db.insert(matchNotifications).values({...});
// 変更後
await db.insert(notifications).values({
  pharmacyId,
  type: 'match_update',
  title: '...',
  message: '...',
  referenceType: 'match',
  sourcePharmacyId: triggerPharmacyId,
  dedupeKey,
  detailJson: {
    trigger_upload_type: uploadType,
    candidate_count_before: before,
    candidate_count_after: after,
    diff: diffData,
  },
});
```

- [ ] **Step 4: notification routes を更新**

`server/src/routes/notifications.ts`:
- matchNotifications との UNION クエリを削除
- notifications テーブルのみのクエリに変更
- `/notifications/matches/:id/read` エンドポイントを `/notifications/:id/read` に統合（type='match_update' フィルタ）

- [ ] **Step 5: 他のサービスの matchNotifications 参照を更新**

- `timeline-unread-counts.ts`: matchNotifications COUNT → notifications WHERE type='match_update'
- `admin-stats.ts`: 同上
- `notification-service.ts`: matchNotifications 参照削除

- [ ] **Step 6: matchNotifications テーブル定義を削除**

`server/src/db/schema-matching.ts` から matchNotifications + relations を削除。

- [ ] **Step 7: テストを更新**

```bash
grep -rn 'matchNotifications' server/src/test/
```
全テストの参照を notifications に変更。

- [ ] **Step 8: マイグレーション生成 + データ移行 SQL**

```sql
-- 1. notifications にカラム追加（Drizzle 生成）
-- 2. matchNotifications → notifications にデータ移行
INSERT INTO notifications (pharmacy_id, type, title, message, reference_type,
  source_pharmacy_id, dedupe_key, detail_json, is_read, created_at)
SELECT
  pharmacy_id, 'match_update', 'マッチング候補更新', '新しいマッチング候補があります',
  'match', trigger_pharmacy_id, dedupe_key,
  jsonb_build_object(
    'trigger_upload_type', trigger_upload_type,
    'candidate_count_before', candidate_count_before,
    'candidate_count_after', candidate_count_after,
    'diff', diff_json::jsonb
  ),
  is_read, created_at
FROM match_notifications;
-- 3. matchNotifications DROP
```

- [ ] **Step 9: typecheck + テスト**

Run: `npm run typecheck && npm run test:server`
Expected: ALL PASS

- [ ] **Step 10: コミット**

```bash
git add server/src/db/ server/src/services/ server/src/routes/ server/src/test/
git commit -m "refactor: merge matchNotifications into notifications table"
```

---

## Chunk 6: Phase 6 — exchangeHistory → ビュー化 + activityLogs リネーム

### Task 9: exchangeHistory をビューに置換

**Files:**
- Modify: `server/src/db/schema-exchange.ts` — exchangeHistory 削除、completedTotalValue 追加
- Modify: `server/src/services/exchange-execution-service.ts` — exchangeHistory INSERT → exchangeProposals UPDATE
- Modify: `server/src/services/timeline-unread-counts.ts` — exchangeHistory 参照削除
- Modify: `server/src/services/monthly-report-service.ts` — exchangeHistory → exchangeProposals フィルタ
- Modify: `server/src/routes/exchange-history.ts` — ビュー or フィルタクエリに変更
- Modify: `server/src/routes/statistics.ts` — exchangeHistory 参照を変更
- Modify: `server/src/routes/admin-pharmacies-list.ts` — exchangeHistory 参照を変更
- Modify: `server/src/routes/admin-stats.ts` — exchangeHistory 参照を変更
- Modify: `server/src/services/timeline-fetchers/exchange-fetchers.ts` — exchangeHistory クエリを exchangeProposals フィルタに変更
- Modify: `server/src/db/migrate-legacy.ts` — exchangeHistory 参照を更新
- Modify: `server/src/routes/admin-logs.ts` — exchangeHistory 参照がある場合は更新

- [ ] **Step 1: exchange_proposals に completedTotalValue カラム追加**

`server/src/db/schema-exchange.ts`:
```typescript
completedTotalValue: numeric('completed_total_value', { precision: 12, scale: 2 }),
```

- [ ] **Step 2: exchange-execution-service.ts を更新**

complete アクション時:
```typescript
// 変更前
await db.insert(exchangeHistory).values({...});
// 変更後
await db.update(exchangeProposals)
  .set({ completedTotalValue: totalValue, status: 'completed', completedAt: new Date() })
  .where(eq(exchangeProposals.id, proposalId));
```

- [ ] **Step 3: exchangeHistory を参照する全サービス/ルートを更新**

各ファイルで `exchangeHistory` テーブル参照を `exchangeProposals` の `WHERE status = 'completed'` フィルタに変更。

```bash
grep -rn 'exchangeHistory' server/src/services/ server/src/routes/
```

- [ ] **Step 4: exchangeHistory テーブル定義を削除**

`server/src/db/schema-exchange.ts` から exchangeHistory + relations を削除。

- [ ] **Step 5: exchange_history_view を SQL マイグレーションに追加**

```sql
CREATE VIEW exchange_history_view AS
SELECT ep.id AS proposal_id, ep.pharmacy_a_id, ep.pharmacy_b_id,
       ep.completed_total_value AS total_value, ep.completed_at
FROM exchange_proposals ep
WHERE ep.status = 'completed' AND ep.completed_at IS NOT NULL;
```

- [ ] **Step 6: テストを更新**

```bash
grep -rn 'exchangeHistory' server/src/test/
```

- [ ] **Step 7: データ移行 SQL**

```sql
-- exchangeHistory → exchangeProposals にデータ backfill
UPDATE exchange_proposals ep
SET completed_total_value = eh.total_value
FROM exchange_history eh
WHERE ep.id = eh.proposal_id;
```

- [ ] **Step 8: typecheck + テスト**

Run: `npm run typecheck && npm run test:server`
Expected: ALL PASS

- [ ] **Step 9: コミット**

```bash
git add server/src/db/ server/src/services/ server/src/routes/ server/src/test/
git commit -m "refactor: replace exchangeHistory table with view + proposal column"
```

---

### Task 10: activityLogs → events リネーム

**Files:**
- Modify: `server/src/db/schema-audit.ts` — activityLogs → events にリネーム
- Modify: 15+ サービスファイル — activityLogs 参照を events に変更

- [ ] **Step 1: schema-audit.ts で activityLogs を events にリネーム**

```typescript
// 変更前
export const activityLogs = pgTable('activity_logs', {...});
// 変更後
export const events = pgTable('activity_logs', {...}); // DB テーブル名は維持
```

注意: PostgreSQL のテーブル名 (`activity_logs`) は変更しない。Drizzle の export 名のみ変更。

- [ ] **Step 2: 全サービス/ルートの import を更新**

```bash
grep -rn 'activityLogs' server/src/services/ server/src/routes/
```

15+ ファイルで `activityLogs` → `events` に変更。主な対象:
- log-service.ts
- csv-export-service.ts
- log-center-query-service.ts
- log-center-filter-service.ts
- log-center-issue-service.ts
- log-center-issue-workflow-service.ts
- admin-pharmacy-health-service.ts
- proposal-timeline-service.ts
- openclaw-log-context-service.ts
- import-failure-alert-scheduler.ts
- admin-logs.ts (routes)

- [ ] **Step 3: テストの参照を更新**

```bash
grep -rn 'activityLogs' server/src/test/
```

- [ ] **Step 4: typecheck + テスト**

Run: `npm run typecheck && npm run test:server`
Expected: ALL PASS

- [ ] **Step 5: コミット**

```bash
git add server/src/db/ server/src/services/ server/src/routes/ server/src/test/
git commit -m "refactor: rename activityLogs export to events"
```

---

### Task 11: 最終検証 + クライアント側の影響確認

**Files:**
- Verify: `client/src/` — フロントエンドに DB テーブル名の直接参照がないことを確認

- [ ] **Step 1: 全テスト実行（server + client）**

Run: `npm run test`
Expected: ALL PASS

- [ ] **Step 2: typecheck（both workspaces）**

Run: `npm run typecheck`
Expected: ALL PASS

- [ ] **Step 3: lint**

Run: `npm run lint`
Expected: ALL PASS

- [ ] **Step 4: PGlite DDL スナップショット再生成 + 統合テスト**

スキーマ変更により PGlite の DDL スナップショットが古くなっている可能性がある。
`server/src/test/integration/helpers/test-db.ts` の DDL 生成が新スキーマを反映しているか確認。

Run: `npm run test:integration:server`
Expected: ALL PASS（スキーマ変更が統合テスト基盤に正しく反映されているか確認）

失敗する場合は DDL スナップショットを再生成:
```bash
cd server && npx tsx src/test/integration/helpers/generate-ddl.ts
```

- [ ] **Step 5: 最終コミット（必要な場合のみ）**

```bash
git commit -m "test: verify schema redesign — all tests pass"
```
