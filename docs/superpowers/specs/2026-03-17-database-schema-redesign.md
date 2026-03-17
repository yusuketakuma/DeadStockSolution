# Database Schema Redesign Spec

## Overview

DeadStockSolution のデータベーススキーマをゼロベースで再設計する。現在 44 テーブル・9 スキーマファイルの構成を、ビジネスドメインに基づいた 40 テーブル・13 スキーマファイルに再編成する。

## Goals

- スキーマファイルの責務を明確にし、保守性を向上させる
- 冗長テーブル（1:1 テーブル、非正規化コピー、重複通知）を排除する
- JSON text カラムを jsonb に統一し、型安全性とクエリ性能を改善する
- 中規模（数百薬局・数十万アイテム）での安定運用に最適化する

## Non-Goals

- パーティショニングの実装（将来の大規模化時に検討）
- テーブル構造の大幅なカラム変更（既存データとの互換性を維持）
- 新規ビジネス機能のためのテーブル追加

## Target Scale

- 数百薬局、数万〜数十万アイテム（複数地域展開）

---

## Schema File Structure

### Current (9 files, 44 tables)

```
schema-common.ts        — Enum/型定義 (0 tables)
schema-auth.ts          — 認証+薬局+営業時間+関係+グループ (9 tables)
                          pharmacies, userRequests, pharmacyRegistrationReviews,
                          passwordResetTokens, pharmacyBusinessHours, pharmacySpecialHours,
                          pharmacyRelationships, pharmacyGroups, groupMembers
schema-inventory.ts     — アップロード+在庫+使用実績+マッピング (4 tables)
                          uploads, deadStockItems, usedMedicationItems, columnMappingTemplates
schema-exchange.ts      — 提案+アイテム+履歴+コメント+フィードバック (5 tables)
                          exchangeProposals, exchangeProposalItems, exchangeHistory,
                          proposalComments, exchangeFeedback
schema-matching.ts      — 予約+スナップショット+通知+ジョブ+ルール (5 tables)
                          deadStockReservations, matchCandidateSnapshots, matchNotifications,
                          matchingRefreshJobs, matchingRuleProfiles
schema-notification.ts  — 管理メッセージ+通知+Push (4 tables)
                          adminMessages, adminMessageReads, notifications, pushSubscriptions
schema-drug-master.ts   — 医薬品マスター+包装+価格+同期+同等性+ソース状態 (6 tables)
                          drugMaster, drugMasterPackages, drugMasterPriceHistory,
                          drugMasterSyncLogs, drugEquivalences, drugMasterSourceState
schema-upload-jobs.ts   — アップロードジョブ+行エラー (2 tables)
                          uploadConfirmJobs, uploadRowIssues
schema-admin.ts         — 信頼スコア+レポート+監査+ログ+イベント+エラー+OpenClaw+アラート (9 tables)
                          pharmacyTrustScores, monthlyReports, adminAuditLogs, activityLogs,
                          systemEvents, errorCodes, openclawCommands, openclawCommandWhitelist,
                          predictiveAlerts
```

### New (13 files, 40 tables + 1 view)

```
schema-common.ts           — Enum/型定義 (0 tables)
schema-pharmacy.ts         — 薬局マスター+営業時間+関係性 (4 tables)
                             pharmacies, pharmacyBusinessHours, pharmacySpecialHours,
                             pharmacyRelationships
schema-pharmacy-group.ts   — グループ+メンバー (2 tables)
                             pharmacyGroups, groupMembers
schema-auth.ts             — 認証+パスワードリセット+登録審査 (2 tables)
                             passwordResetTokens, pharmacyRegistrationReviews
schema-inventory.ts        — 在庫+アップロード+ジョブ統合 (5 tables)
                             upload_jobs, deadStockItems, usedMedicationItems,
                             columnMappingTemplates, uploadRowIssues
schema-exchange.ts         — 取引+コメント+フィードバック (4 tables + 1 view)
                             exchangeProposals, exchangeProposalItems,
                             proposalComments, exchangeFeedback + exchange_history_view
schema-matching.ts         — マッチング候補+予約+ジョブ+ルール (4 tables)
                             deadStockReservations, matchCandidateSnapshots,
                             matchingRefreshJobs, matchingRuleProfiles
schema-drug-master.ts      — 医薬品マスター+包装+価格+同期+同等性+ソース状態 (6 tables)
                             drugMaster, drugMasterPackages, drugMasterPriceHistory,
                             drugMasterSyncLogs, drugEquivalences, drugMasterSourceState
schema-notification.ts     — 統合通知+管理メッセージ+Push (4 tables)
                             notifications, adminMessages, adminMessageReads, pushSubscriptions
schema-analytics.ts        — 月次レポート+予測アラート (2 tables)
                             monthlyReports, predictiveAlerts
schema-audit.ts            — 統合イベントログ+エラーコード+管理者監査 (4 tables)
                             events, systemEvents, errorCodes, adminAuditLogs
schema-openclaw.ts         — OpenClaw連携 (3 tables)
                             userRequests, openclawCommands, openclawCommandWhitelist
```

---

## Table Changes

### 1. Eliminated Tables (3)

#### pharmacyTrustScores → pharmacies に統合

**Reason**: 1:1 relationship。不要な JOIN を排除。

pharmacies テーブルに以下のカラムを追加:
- `trust_score` numeric(5,2) DEFAULT 60.00
- `rating_count` integer DEFAULT 0
- `positive_rate` numeric(5,2) DEFAULT 0.00

**Migration**: pharmacyTrustScores の値を pharmacies にコピー後、テーブル DROP。

**Affected services**: trust-score-service — pharmacies テーブルを直接 UPDATE に変更。

#### exchangeHistory → exchange_history_view に置換

**Reason**: exchange_proposals (status='completed') の非正規化コピー。データ不整合リスク。

exchange_proposals に追加:
- `completed_total_value` numeric(12,2)

```sql
CREATE VIEW exchange_history_view AS
SELECT
  ep.id AS proposal_id,
  ep.pharmacy_a_id,
  ep.pharmacy_b_id,
  ep.completed_total_value AS total_value,
  ep.completed_at
FROM exchange_proposals ep
WHERE ep.status = 'completed'
  AND ep.completed_at IS NOT NULL;
```

**Migration**: exchange_proposals.completed_total_value を exchangeHistory.totalValue から backfill 後、テーブル DROP + ビュー CREATE。

**Affected services/routes**:
- exchange-execution-service (complete): exchangeHistory INSERT → exchange_proposals UPDATE
- GET /exchange-history: exchangeHistory SELECT → exchange_history_view SELECT

#### matchNotifications → notifications に統合

**Reason**: 同一受信者（薬局）、同一表示先（通知一覧/バッジ）、同一既読管理。分離する理由がない。

notifications に追加:
- `detail_json` jsonb — matchNotifications の diffJson, triggerUploadType, candidateCountBefore, candidateCountAfter を JSON オブジェクトとして格納
- `source_pharmacy_id` integer FK — matchNotifications.triggerPharmacyId を吸収
- `dedupe_key` text — matchNotifications.dedupeKey を吸収

notifications.type に `'match_update'` を追加。

matchNotifications の以下カラムは detail_json に統合（専用カラム不要）:
- `triggerUploadType` → detail_json.trigger_upload_type
- `candidateCountBefore` → detail_json.candidate_count_before
- `candidateCountAfter` → detail_json.candidate_count_after
- `diffJson` → detail_json.diff

**Migration**: matchNotifications の既存データを notifications に INSERT (type='match_update', detail_json に上記フィールドを構造化) 後、テーブル DROP。

**Affected services/routes**:
- matching-service: matchNotifications INSERT → notifications INSERT (type='match_update')
- GET /notifications: UNION クエリ → notifications のみ SELECT
- POST /notifications/matches/:id/read → POST /notifications/:id/read (type フィルタ)
- GET /notifications/unread-count: 両テーブル COUNT → notifications のみ COUNT

### 2. Merged Tables (2 → 1)

#### uploads + uploadConfirmJobs → upload_jobs

**Reason**: 同一アップロードの異なるフェーズ。uploads は完了済みメタデータ、uploadConfirmJobs は処理中ジョブだが、実質同一ライフサイクル。

upload_jobs カラム:

| Column | Type | Source |
|--------|------|--------|
| id | serial PK | — |
| pharmacy_id | integer FK NOT NULL | both |
| upload_type | enum NOT NULL | both |
| original_filename | text NOT NULL | both |
| file_hash | text NOT NULL | uploadConfirmJobs |
| header_row_index | integer NOT NULL | uploadConfirmJobs |
| column_mapping | jsonb NOT NULL | uploads.columnMapping + jobs.mappingJson |
| apply_mode | text DEFAULT 'replace' | uploadConfirmJobs |
| delete_missing | boolean DEFAULT false | uploadConfirmJobs |
| deduplicated | boolean DEFAULT false | uploadConfirmJobs |
| file_base64 | text NOT NULL | uploadConfirmJobs |
| idempotency_key | text | uploadConfirmJobs |
| status | enum DEFAULT 'pending' | uploadConfirmJobs |
| attempts | integer DEFAULT 0 | uploadConfirmJobs |
| last_error | text | uploadConfirmJobs |
| result_json | jsonb | uploadConfirmJobs |
| row_count | integer | uploads (set on completion) |
| cancel_requested_at | timestamp | uploadConfirmJobs |
| canceled_at | timestamp | uploadConfirmJobs |
| canceled_by | integer FK | uploadConfirmJobs |
| processing_started_at | timestamp | uploadConfirmJobs |
| next_retry_at | timestamp | uploadConfirmJobs |
| completed_at | timestamp | uploadConfirmJobs |
| created_at / updated_at | timestamp | — |

Indexes:
- `(pharmacy_id, created_at)`
- `(pharmacy_id, idempotency_key)` UNIQUE WHERE status IN ('pending', 'processing')
- `(status, attempts, next_retry_at, processing_started_at, created_at)` — retry queue

**Dropped columns from uploads**: `requestedAt` は `created_at` に統合（意味的に同一）。

**Migration**:
1. upload_jobs テーブル CREATE
2. uploadConfirmJobs データを upload_jobs に移行（uploads との JOIN で row_count 等を補完）
3. dead_stock_items.upload_id → upload_job_id にリネーム (FK 変更)
4. used_medication_items.upload_id → upload_job_id にリネーム (FK 変更)
5. upload_row_issues.job_id FK 先を upload_jobs に変更
6. uploads, uploadConfirmJobs を DROP

**Affected services/routes**:
- upload-service: uploads + uploadConfirmJobs の二重管理 → upload_jobs のみ
- GET /upload/status: uploads 参照 → upload_jobs 参照
- admin/upload-jobs: uploadConfirmJobs 参照 → upload_jobs 参照

### 3. Renamed Table (1)

#### activityLogs → events

**Reason**: より汎用的な名称。action カラムで操作種別を表現する設計と一致。

カラム変更: metadata_json text → metadata_json jsonb (カラム名は維持、型のみ変更)

### 4. JSON text → jsonb Conversions (12 columns)

| Table | Column | Current | New |
|-------|--------|---------|-----|
| upload_jobs | column_mapping | text | jsonb |
| upload_jobs | result_json | text | jsonb |
| upload_row_issues | row_data_json | text | jsonb |
| match_candidate_snapshots | top_candidates_json | text | jsonb |
| notifications | detail_json | — | jsonb (new) |
| drug_master_source_state | metadata_json | text | jsonb |
| events (旧 activityLogs) | metadata_json | text | jsonb |
| system_events | detail_json | text | jsonb |
| monthly_reports | report_json | text | jsonb |
| predictive_alerts | detail_json | text | jsonb |
| openclaw_commands | parameters, result | text | jsonb |
| openclaw_command_whitelist | parameters_schema | text | jsonb |

**Migration**: `ALTER TABLE ... ALTER COLUMN ... TYPE jsonb USING col::jsonb`

### 5. File Moves (1)

| Table | From | To |
|-------|------|----|
| user_requests | schema-auth.ts | schema-openclaw.ts |

### 6. Tables with Minor Changes Only (13)

以下のテーブルはカラム追加・FK 変更・jsonb 変換などの小規模変更のみ:

- pharmacies (trust_score, rating_count, positive_rate カラム追加)
- dead_stock_items (upload_id → upload_job_id FK リネーム)
- used_medication_items (upload_id → upload_job_id FK リネーム)
- upload_row_issues (job_id FK 先変更 + row_data_json jsonb 化)
- exchange_proposals (completed_total_value カラム追加)
- notifications (detail_json, source_pharmacy_id, dedupe_key カラム追加)
- match_candidate_snapshots (top_candidates_json jsonb 化)
- drug_master_source_state (metadata_json jsonb 化)
- system_events (detail_json jsonb 化)
- monthly_reports (report_json jsonb 化)
- predictive_alerts (detail_json jsonb 化)
- openclaw_commands (parameters, result jsonb 化)
- openclaw_command_whitelist (parameters_schema jsonb 化)

### 7. Completely Unchanged Tables (25)

以下のテーブルは変更なし（ファイル移動のみの場合を含む）:

- pharmacy_business_hours
- pharmacy_special_hours
- pharmacy_relationships
- pharmacy_groups
- group_members
- password_reset_tokens
- pharmacy_registration_reviews
- column_mapping_templates
- exchange_proposal_items
- proposal_comments
- exchange_feedback
- dead_stock_reservations
- matching_refresh_jobs
- matching_rule_profiles
- drug_master
- drug_master_packages
- drug_master_price_history
- drug_equivalences
- drug_master_sync_logs
- admin_messages
- admin_message_reads
- push_subscriptions
- admin_audit_logs
- error_codes
- user_requests (ファイル移動のみ)

---

## Migration Plan

6 フェーズに分割。各フェーズは独立してデプロイ可能。

### Phase 1: Schema File Reorganization (DB 変更なし)

- schema-auth.ts → schema-pharmacy.ts / schema-auth.ts / schema-pharmacy-group.ts に分割
- schema-admin.ts → schema-audit.ts / schema-analytics.ts / schema-openclaw.ts に分割
- schema-upload-jobs.ts → schema-inventory.ts に統合
- user_requests を schema-openclaw.ts に移動
- schema.ts の re-export を更新

**Risk**: 低〜中。DB に影響なしだが、多数のスキーマファイルが pharmacies を import しているため、import パスの一括更新が必要（schema-auth → schema-pharmacy）。schema-inventory.ts, schema-exchange.ts, schema-matching.ts, schema-notification.ts, schema-drug-master.ts, schema-admin.ts 系の全ファイルが影響を受ける。不完全な更新はビルドエラーになる。
**Rollback**: git revert

### Phase 2: JSON text → jsonb Conversion

- 12 カラムを ALTER TABLE で jsonb に変換
- アプリケーションコード側で JSON.parse/stringify を削除（Drizzle が自動変換）

**Risk**: 低。PostgreSQL の text → jsonb キャストはデータ互換あり。不正 JSON があれば失敗するが、アプリケーションが生成した JSON なので問題ない。
**Rollback**: ALTER COLUMN TYPE text

### Phase 3: pharmacyTrustScores → pharmacies 統合

1. pharmacies に trust_score, rating_count, positive_rate カラム追加
2. UPDATE pharmacies SET ... FROM pharmacyTrustScores でデータコピー
3. trust-score-service を pharmacies 直接更新に変更
4. pharmacyTrustScores テーブル DROP

**Risk**: 中。trust-score-service の変更が必要。
**Rollback**: pharmacyTrustScores を再作成し pharmacies からデータコピー

### Phase 4: uploads + uploadConfirmJobs → upload_jobs 統合

1. upload_jobs テーブル CREATE
2. データ移行スクリプトで既存データをマージ
3. dead_stock_items.upload_id → upload_job_id リネーム
4. used_medication_items.upload_id → upload_job_id リネーム
5. upload_row_issues.job_id FK 先変更
6. upload-service のコード変更
7. uploads, uploadConfirmJobs DROP

**Risk**: 中。FK 変更と複数サービスの更新が必要。
**Rollback**: 旧テーブルを再作成し upload_jobs からデータ分離

### Phase 5: matchNotifications → notifications 統合

1. notifications に detail_json, source_pharmacy_id, dedupe_key カラム追加
2. matchNotifications データを notifications に INSERT (type='match_update')
3. matching-service, notification routes のコード変更
4. matchNotifications テーブル DROP

**Risk**: 中。通知関連の複数ルート変更が必要。
**Rollback**: matchNotifications を再作成し notifications から type='match_update' データを移動

### Phase 6: exchangeHistory → ビュー化

1. exchange_proposals に completed_total_value カラム追加
2. UPDATE exchange_proposals SET completed_total_value = eh.totalValue FROM exchangeHistory eh
3. exchange_history_view CREATE
4. exchange-execution-service, exchange-history routes のコード変更
5. exchangeHistory テーブル DROP

**Risk**: 低。ビューによる後方互換性が高い。
**Rollback**: exchangeHistory を再作成しビューから INSERT

---

## Testing Strategy

各フェーズで以下を実施:

1. **マイグレーション前**: 既存テスト全パス確認 (4610+ tests)
2. **マイグレーション実行**: ローカル PGlite 環境でテスト
3. **コード変更**: 影響を受けるサービス/ルートのテスト更新
4. **マイグレーション後**: 全テスト再実行

## Success Criteria

- 全テスト (4610+) がパス
- typecheck がパス
- テーブル数: 44 → 40
- スキーマファイル: 責務が明確で各ファイル 2-6 テーブル
- JSON カラム: 全て jsonb
- 冗長テーブル: 0
