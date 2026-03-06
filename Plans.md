# Plans.md — DeadStockSolution

> 詳細設計は [plan.md](./plan.md) を参照

## 🔴 進行中のタスク

（なし）

## 🟢 Sprint: リファクタリング (新機能構築前整理) — 完了 (2026-03-07)

### Wave 1-3: サーバーサイド分割 ✅
- [x] matching-service → 4サブモジュール分割
- [x] upload-confirm-job-service → 8サブモジュール分割

### Wave 4: フロントエンドhook抽出 ✅
- [x] useCamera.ts / useBarcodeResolver.ts / useCameraDraftRows.ts 抽出
- [x] CameraDeadStockRegisterPanel.tsx 統合
- [x] useDiffPreview.ts / useUploadPreview.ts / useUploadJobPolling.ts 抽出
- [x] useUploadExcelFlow.ts 抽出 → UploadPage.tsx 簡素化 (908→280行)
- [x] useAccountForm.ts / useBusinessHoursForm.ts / useNotificationSettings.ts 抽出
- [x] AccountPage.tsx 簡素化 (726→130行)

### Wave 5: サーバーサイド効率化 (simplify-refact) ✅
- [x] upload-confirm-query-service.ts — `createEnumNormalizer` ファクトリで3つのnormalize関数を統合、`countActiveJobs` でcount関数を統合 `cc:完了` (2026-03-07)
- [x] exchange-comments.ts — `findProposalForUser`・`findOwnComment`・`parseCommentBody`・`rejectIfAdmin` の4ヘルパー抽出 `cc:完了` (2026-03-07)
- [x] exchange-service.ts — `notifyProposalEvent`・`assertNotBlocked`・`validateAndUpdateStock` の3ヘルパー抽出 `cc:完了` (2026-03-07)
---

## 🟡 未着手のタスク

## Sprint: コードベース品質強化 v0.0.9
> **目的**: セキュリティ強化・パフォーマンス最適化・テストカバレッジ拡充・UX改善の4軸で品質基盤を固める（第2弾）

### Phase 1: セキュリティ強化 [security]

- [x] T115: CSRFミドルウェアテスト追加 `cc:完了` (2026-03-06)
- [x] T116: Uploadミドルウェア入力検証テスト追加 `cc:完了` (2026-03-06)
- [x] T117: Request loggerミドルウェアテスト追加 `cc:完了` (2026-03-06)

### Phase 2: パフォーマンス最適化 [performance]

- [x] T118: timeline-aggregatorsサービステスト追加 `cc:完了` (2026-03-06)
- [x] T119: gs1-parserサービステスト追加 `cc:完了` (2026-03-06)
- [x] T120: camera-dead-stock-service テスト追加 `cc:完了` (2026-03-06)
  - 写真登録フロー・DBクエリパターン・エラーハンドリング

### Phase 3: テストカバレッジ強化 [test]

- [x] T121: error-handlerミドルウェアテスト追加 `cc:完了` (2026-03-06)
- [x] T122: scheduler系サービステスト追加（drug-master-scheduler, drug-package-scheduler） `cc:完了` (2026-03-06)
  - スケジュール実行・リトライ・エラー処理
- [x] T123: mhlw-source-fetch / mhlw-index-scraper テスト追加 `cc:完了` (2026-03-06)
  - 厚労省データ取得・スクレイピング・エラーハンドリング
- [x] T120: camera-dead-stock-service テスト追加 `cc:完了` (2026-03-06)
  - 写真登録フロー・DBクエリパターン・エラーハンドリング（純粋関数29テスト追加）

### Phase 4: UX 改善 [ui]

- [x] T124: エラーメッセージ定数ファイル作成 `cc:完了` (2026-03-06)
- [x] T125: AdminDrugMasterPage console.error → ユーザー表示へ修正 `cc:完了` (2026-03-06)
- [x] T126: ローディング状態統一コンポーネント作成 `cc:完了` (2026-03-06)
  - LoadingOverlay / LoadingButton コンポーネント作成
  - ProposalsPage, AccountPage, StatisticsPage に適用
- [x] T127: aria-label属性追加（インタラクティブ要素） `cc:完了` (2026-03-06)
  - LoginPage パスワード表示切替ボタン
  - ProposalsPage チェックボックス
  - AccountInfoForm フォームコントロール（AppFieldで既に適切に実装済み）
  - LoginPage パスワード表示切替ボタン
  - ProposalsPage チェックボックス
  - AccountInfoForm フォームコントロール

---

---

## 🟢 完了タスク

## Sprint: コードベース品質強化 v0.0.8

> **目的**: セキュリティ強化・パフォーマンス最適化・テストカバレッジ拡充・UX改善の4軸で品質基盤を固める

### Phase 1: セキュリティ強化 [security]

- [x] T101: パスワード変更・アカウント削除にエンドポイント専用レート制限追加 `cc:完了` (2026-03-02)
  - passwordChangeLimiter(10回/時) + accountDeletionLimiter(3回/日) をユーザーIDキーで追加
- [x] T102: admin-log-center タイムスタンプパラメータ検証追加 `cc:完了` (2026-03-02)
  - from/to に ISO 8601 形式チェック・from≤to 検証・90日スパン制限・不正値 400 返却
- [x] T103: OpenClaw コマンドパラメータ Zod スキーマ検証 `cc:完了` (2026-03-02)
  - pharmacy.toggle/job.cancel/logs.query/notification.send に Zod v4 スキーマ追加

### Phase 2: パフォーマンス最適化 [performance]

- [x] T104: 交換完了時の逐次 UPDATE をバッチ化 `cc:完了` (2026-03-02)
  - ループ内逐次 UPDATE → Promise.all 並列化
- [x] T105: enrichment パッケージ事前一括読み込み `cc:完了` (2026-03-02)
  - N+1 パターン → 2パス設計で masterIds 一括ロード
- [x] T106: マッチングスナップショット一括保存 `cc:完了` (2026-03-02)
  - saveMatchSnapshotsBatch() 追加、UPSERT + 一括通知 INSERT、M*3→3 DB round trip
- [x] T107: 薬品マスター同期 UPDATE バッチ化 `cc:完了` (2026-03-02)
  - syncDrugMaster() 内 UPDATE を Promise.all 並列化

### Phase 3: テストカバレッジ強化 [test]

- [x] T108: drug-master-enrichment テスト追加 `cc:完了` (2026-03-02)
  - 8テスト: YJコード/GS1/名前マッチ・未登録・空入力・パッケージ補完
- [x] T109: column-mapper テスト追加 `cc:完了` (2026-03-02)
  - 33テスト: parseColumnIndex/getCell/detectHeaderRow/suggestMapping/detectUploadType/computeHeaderHash
- [x] T110: data-extractor テスト追加 `cc:完了` (2026-03-02)
  - 18テスト: Excel/CSV パース・境界値・異常系・大量行・wrapper関数
- [x] T111: matching-filter-service テスト追加 `cc:完了` (2026-03-02)
  - 17テスト: balanceValues/groupByPharmacy の正常系・境界値
- [x] T112: matching-rule-service テスト追加 `cc:完了` (2026-03-02)
  - 13テスト: キャッシュ・DB取得・フォールバック・更新バリデーション（既存確認）
- [x] T113: monitoring-kpi-service テスト追加 `cc:完了` (2026-03-02)
  - 13テスト: uploadFailureRate算出・status判定・レスポンス構造

### Phase 4: UX 改善 [ui]

- [x] T114: PharmacyListPage エラー/空状態の排他表示修正 `cc:完了` (2026-03-02)
  - エラー > ローディング > 空状態 > コンテンツ の排他制御に統合

---

## 📦 アーカイブ

> 完了済みスプリントは `.claude/memory/archive/` に移動済み

- [医薬品マスター管理機能スプリント](.claude/memory/archive/Plans-completed-sprint-drug-master.md) — Phase 1-6 全完了 + Backlog (23タスク, archived 2026-02-25)
- [2026-02 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-02.md) — T001-T040: コード品質改善 / システム堅牢化 / 統合通知 / コード簡素化 (40タスク, archived 2026-03-01)
- [2026-03 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-03.md) — T041-T100: パフォーマンス改善 / タイムライン / 認証強化 / UX改善 / 統計 / 薬品マスター自動更新 (60タスク, archived 2026-03-02)
