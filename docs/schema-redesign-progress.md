# DB スキーマ再設計 進捗追跡

最終更新: 2026-03-21

---

## Phase 1: ファイル分割 ✅ 完了

`server/src/db/schema.ts` を単一ファイルから複数ファイルに分割し、re-export する構成に変更済み。

### 現在の構成

`schema.ts` は以下の 12 ファイルを re-export している:

| ファイル | 含まれる主なテーブル |
|---------|-------------------|
| `schema-common.ts` | 共通 enum・定数値 (pharmacyRelationshipTypeEnum, uploadTypeEnum, exchangeStatusEnum 等) |
| `schema-pharmacy.ts` | pharmacies, pharmacyBusinessHours, pharmacySpecialHours, pharmacyRelationships, inventorySearchPreferences |
| `schema-pharmacy-group.ts` | pharmacyGroups, groupMembers |
| `schema-auth.ts` | pharmacyRegistrationReviews, passwordResetTokens |
| `schema-inventory.ts` | uploadJobs, deadStockItems, usedMedicationItems, columnMappingTemplates, uploadRowIssues |
| `schema-exchange.ts` | exchangeProposals, exchangeProposalItems, proposalComments, exchangeFeedback |
| `schema-matching.ts` | deadStockReservations, matchCandidateSnapshots, matchingRefreshJobs, matchingRuleProfiles |
| `schema-notification.ts` | adminMessages, adminMessageReads, notifications, pushSubscriptions |
| `schema-drug-master.ts` | drugMaster, drugMasterPackages, drugMasterPriceHistory, drugMasterSyncLogs, drugEquivalences, drugMasterSourceState |
| `schema-audit.ts` | adminAuditLogs, events (activity_logs), systemEvents, errorCodes |
| `schema-analytics.ts` | monthlyReports, predictiveAlerts |
| `schema-openclaw.ts` | openclawCommands, openclawCommandWhitelist, userRequests |

### 検証結果

- **pharmacies テーブル**: `schema-pharmacy.ts` に正しく存在する（旧 `schema-auth.ts` から移動済み）
- **重複定義**: なし（各テーブルはいずれか 1 ファイルにのみ定義されている）
- **re-export**: `schema.ts` が全 12 ファイルを export している

---

## Phase 2: text → jsonb 変換対象列の洗い出し

### 変換済み列（既に jsonb）

以下の列はすでに `jsonb` 型で定義されており、変換不要:

| テーブル | カラム名 | スキーマファイル |
|---------|---------|---------------|
| upload_confirm_jobs | mapping_json | schema-inventory.ts |
| upload_confirm_jobs | result_json | schema-inventory.ts |
| upload_row_issues | row_data_json | schema-inventory.ts |
| match_candidate_snapshots | top_candidates_json | schema-matching.ts |
| notifications | detail_json | schema-notification.ts |
| monthly_reports | report_json | schema-analytics.ts |
| predictive_alerts | detail_json | schema-analytics.ts |
| events (activity_logs) | metadata_json | schema-audit.ts |
| system_events | detail_json | schema-audit.ts |
| drug_master_source_state | metadata_json | schema-drug-master.ts |
| openclaw_commands | parameters | schema-openclaw.ts |
| openclaw_commands | result | schema-openclaw.ts |
| openclaw_command_whitelist | parameters_schema | schema-openclaw.ts |
| inventory_search_preferences | draft_json | schema-pharmacy.ts |
| inventory_search_preferences | search_history_json | schema-pharmacy.ts |
| inventory_search_preferences | saved_presets_json | schema-pharmacy.ts |

### 変換対象列（text → jsonb）

JSON データを格納しているが型が `text` のままの列:

| テーブル | カラム名 (DB) | JS プロパティ名 | 現在の型 | 変換後の型 | スキーマファイル | 備考 |
|---------|------------|--------------|--------|----------|---------------|------|
| pharmacy_registration_reviews | mismatch_details_json | mismatchDetailsJson | `text` | `jsonb` | schema-auth.ts | NULL 許容 |
| column_mapping_templates | mapping | mapping | `text` | `jsonb` | schema-inventory.ts | NOT NULL |

### Phase 2 作業内容

1. 上記 2 列を `text()` から `jsonb()` に変更
2. Drizzle migration を生成: `cd server && npx drizzle-kit generate`
3. マイグレーション SQL に `ALTER TABLE ... ALTER COLUMN ... TYPE jsonb USING column::jsonb` が含まれることを確認
4. ステージング環境で動作確認

---

## Phase 3: インデックス最適化（予定）

概要: 高頻度クエリパターンに合わせた複合インデックスの追加・不要インデックスの削除。

対象として想定される領域:
- `dead_stock_items`: 薬品名 + 有効期限 + 薬局 ID の複合検索
- `exchange_proposals`: ステータス + 日付フィルタリング
- `notifications`: 既読フラグ + 薬局 ID の unread カウント

実施前に `EXPLAIN ANALYZE` でクエリプランを確認すること。

---

## Phase 4: 正規化・構造見直し（予定）

概要: 一部テーブルのリレーション設計を見直し、非正規化された列を分離。

対象候補:
- `pharmacies.verificationStatus` / `verificationRequestId` / `verifiedAt` / `rejectionReason` → 別テーブルへの分離を検討
- `pharmacies.trustScore` / `ratingCount` / `positiveRate` → 集計テーブルへの移動を検討

影響範囲が大きいため、API 互換性を維持しながら段階的に実施する。

---

## Phase 5: 制約・バリデーション強化（予定）

概要: DB レベルの CHECK 制約を追加・強化し、アプリケーション層での不正データ混入を防止。

対象候補:
- `pharmacies.verificationStatus`: 許容値を CHECK 制約で列挙
- `notifications.type`: `notificationTypeValues` に対応する CHECK 制約
- `notifications.referenceType`: `notificationReferenceTypeValues` に対応する CHECK 制約

---

## Phase 6: パーティショニング・アーカイブ戦略（予定）

概要: 大量データが蓄積される予定のテーブルに対してパーティショニングまたはアーカイブ戦略を検討。

対象候補:
- `events` (activity_logs): 月次パーティションまたは定期アーカイブ
- `system_events`: 保持期間設定 + 自動削除ジョブ
- `upload_confirm_jobs`: 完了・キャンセル済みのアーカイブ

実施には Vercel Postgres (Neon) のパーティショニングサポート状況の確認が必要。
