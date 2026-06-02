# DeadStockSolution source-material catalog

目的: C4関連の手がかりを含む可能性がある、プロジェクト内の一次/準一次資料を棚卸ししたメモ。

結論:
- 明示的な `C4` ラベルは、今回の走査範囲では見つからなかった。
- 代わりに、`v0.0.x` 系の版情報、日付、`DeadStockSolution v0.0.22` 表示、運用ハンドオフ、Playwright監査成果物が主要な手がかりだった。

## 主要ソース

| 種別 | パス | 使いどころ | バージョン/日付の手がかり |
|---|---|---|---|
| README | `README.md` | プロダクト概要、主要機能、公開URL | `version-0.0.24` バッジ |
| Changelog | `CHANGELOG.md` | 変更履歴の一次情報 | `0.0.26` / `0.0.25` |
| 実装計画 | `plan.md` | 医薬品マスター実装の詳細設計 | 章立て: 概要 / Phase 1 / Phase 2 ... |
| 全体計画 | `Plans.md` | 進行中・完了タスクの履歴 | `v0.0.22`, `v0.0.24` |
| ゼロベース再構築 | `docs/zero-base-rebuild-roadmap-2026-02-26.md` | 再構築ロードマップ | 作成日 `2026-02-26` |
| 進捗追跡 | `docs/schema-redesign-progress.md` | DBスキーマ再設計の進捗 | 最終更新 `2026-03-21` |
| 設計ギャップ | `docs/componentization-gap-report.md` | UI共通化の完了状況 | `2026-02-26 完了` |
| P1整理 | `docs/p1-remediation-batch.md` | レビュー起点の一括修正テンプレ | なし（計画テンプレ） |
| 監査所見 | `.deep-review-findings.md` | deep review の要点まとめ | `2026-03-06` のテーマ別記録 |
| OpenClaw復旧 | `docs/operations/recovery-runbook.md` | バックアップ/復元/品質ゲート | なし（手順書） |
| 監視/自動修正 | `docs/operations/hourly-code-scan.md` | 定期スキャン運用 | なし（運用手順） |
| リリース品質 | `docs/operations/release-quality-gate.md` | preview / release gate | なし（運用手順） |
| 監査仕様 | `docs/dds-agent-runner-spec.md` | managed_remote_agent 連携仕様 | なし（仕様書） |
| DB分割 | `server/src/db/migrations/README-partitioning.md` | 大規模テーブルのパーティション戦略 | なし（設計メモ） |
| 薬局ID監査 | `server/src/routes/PHARMACYID_WHERE_AUDIT.md` | route/ID監査の追跡用メモ | なし（監査メモ） |

## 仕様/設計系の読みどころ

- `docs/superpowers/specs/2026-03-17-database-schema-redesign.md`
  - 見出し: `## Overview`, `## Goals`
- `docs/superpowers/specs/2026-03-18-mobile-ux-and-search-design.md`
  - モバイルUX/検索の設計
- `docs/superpowers/specs/2026-03-20-prescription-inventory-search-design.md`
  - 見出し: `## 概要`, `## 現在の導線`, `## API 契約`, `## サーバ設計`, `## クライアント設計`, `## テスト対象`
- `docs/superpowers/plans/2026-03-20-prescription-inventory-search.md`
  - 実装済み項目と残タスクの整理
- `docs/plans/2026-03-02-log-center-openclaw-plan.md`
  - OpenClaw 連携・ログセンター関連の設計
- `docs/plans/2026-03-02-log-center-openclaw-design.md`
  - 詳細設計
- `docs/plans/2026-03-01-pharmacy-verification-plan.md`
  - 認証/検証まわりの計画
- `docs/plans/2026-03-01-pharmacy-verification-design.md`
  - 詳細設計
- `docs/plans/2026-02-26-notification-center-plan.md`
  - 通知センターの計画
- `docs/plans/2026-02-26-notification-center-design.md`
  - 通知センターの詳細設計
- `docs/adr/004-chart-implementation.md`
  - `Status: accepted`, `Date: 2026-03-23`

## 運用・検証系

- `docs/test-matrix-v019.md` — `v0.0.19` 回帰テスト行列
- `docs/sprint-gate-v019.md` — `v0.0.19` の gate 結果
- `docs/performance/README.md` — 回帰テストの閾値と baseline 更新手順
- `docs/performance/baseline.md` — baseline 更新履歴
- `docs/codex-setup.md`, `docs/codex-workflow.md`, `docs/codex-troubleshooting.md`, `docs/codex-app-server.md`, `docs/codex-apps.md` — Codex運用の補助資料
- `docs/runbooks/openclaw-feature-flags.md` — feature flag の runbook
- `docs/operations/secrets-rotation.md` — 秘密情報ローテーション手順
- `docs/operations/migration-rollback.md` — migration rollback 手順

## ランタイム/実務ログ

- `workspace/queue/cross-agent-handoff.md`
  - `updated_at: 2026-04-10T10:17:00+09:00`
  - owner pause directive / CI failure / notification off などの最新ハンドオフ
- `workspace/reports/dss/daily-20260409.md`
  - `CI (24h): 0/2 passed, 2 failed`
- `workspace/reports/dss/daily-20260410.md`
  - `2026-04-10 09:05 JST`
- `artifacts/rls-boundary-checklist-2026-05-03.md`
  - RLS 境界のチェックリスト

## 画面/監査成果物

### Playwright 監査スクリーンショット
`artifacts/playwright-audit/screenshots/`
- `box-unit-mobile-dead-stock.png`
- `box-unit-proposal-print.png`
- `box-unit-proposal-detail.png`
- `box-unit-matching.png`
- `box-unit-inventory-browse.png`
- `box-unit-dead-stock.png`
- `runtime-user-dashboard.png`
- `runtime-admin-dashboard.png`
- `vercel-main-login-form-annotated.png`
- `vercel-main-home.png`
- `vercel-main-dev-login.png`
- `vercel-main-dev-login-annotated.png`
- `vercel-main-after-login.png`
- `vercel-main-after-login-success.png`
- `local-user-authenticated.png`
- `local-admin-authenticated.png`

### HTML レポート
`artifacts/playwright-audit/reports/html/`
- `index.html`
- `trace/index.html`
- `box-unit-ui-review/index.html`
- `proposal-flow/index.html`
- `proposal-flow/trace/index.html`
- `login-dashboard/index.html`
- `login-dashboard/trace/index.html`

### 画面上の版表示が見えた例
- `artifacts/playwright-audit/test-results/login-dashboard/.../error-context.md`
  - `DeadStockSolution v0.0.22` が見えている

## 補足

- `README.md` の公開URL: `https://dead-stock-solution.vercel.app/`
- `README.md` の関連リンク: GitHub Actions CI / Lighthouse CI バッジ
- `docs/adr/README.md` は ADR のインデックスと命名規則を説明している
- 今回の走査では、ファイル名・本文のどちらにも `C4` そのものは確認できなかった

## C4相当として使うべき資料の優先順位

1. `README.md`
   - プロダクトの一次説明、主要機能、公開URL、デモ環境、APIの入口
2. `CHANGELOG.md`
   - 版ごとの変更点と、どの領域がいつ動いたかの手がかり
3. `Plans.md`
   - 完了済みタスクとリリース単位の整理。実装の到達点を見るのに有効
4. `plan.md`
   - 医薬品マスター領域の設計意図、DB/サービス/UIの段階構成
5. `docs/` 配下の計画・運用・ADR
   - 再構築、進捗、運用手順、品質ゲート、監査仕様の補助根拠
6. `workspace/reports/` と Playwright 監査成果物
   - 実画面、実行ログ、版表示などの準一次証跡

## 関連実装の対応先

### アップロード / 取り込み / 検証
- サーバ: `server/src/routes/upload.ts`, `server/src/routes/upload-parser.ts`, `server/src/routes/upload-validation.ts`, `server/src/routes/upload-quality.ts`
- クライアント: `client/src/pages/UploadPage.tsx`, `client/src/pages/UploadQualityPage.tsx`, `client/src/pages/upload/CameraDeadStockRegisterPanel.tsx`
- 周辺: `server/src/routes/internal-upload-jobs.ts`, `server/src/routes/admin-upload-jobs.ts`, `server/src/routes/admin-upload-quality.ts`

### マッチング / 候補生成 / 交換
- サーバ: `server/src/routes/exchange.ts`, `server/src/routes/exchange-proposals.ts`, `server/src/routes/exchange/history.ts`, `server/src/routes/exchange/feedback.ts`, `server/src/routes/match-bookmarks.ts`
- サービス: `server/src/services/matching-refresh-service.ts`, `server/src/services/matching-priority-service.ts`, `server/src/services/matching-snapshot-service.ts`, `server/src/services/matching-*.ts`
- クライアント: `client/src/pages/MatchingPage.tsx`, `client/src/pages/ProposalsPage.tsx`, `client/src/pages/ProposalDetailPage.tsx`, `client/src/pages/ExchangeHistoryPage.tsx`, `client/src/pages/BookmarksPage.tsx`

### アラート / タイムライン / 通知
- サーバ: `server/src/routes/alerts.ts`, `server/src/routes/timeline.ts`, `server/src/routes/notifications.ts`, `server/src/services/alert-read-service.ts`, `server/src/services/timeline-service.ts`, `server/src/services/notification-helper-service.ts`, `server/src/services/push-dispatch-service.ts`
- クライアント: `client/src/pages/AlertListPage.tsx`, `client/src/pages/NotificationsPage.tsx`, `client/src/pages/DashboardPage.tsx`
- 近接実装: `server/src/services/timeline-fetchers/notification-fetchers.ts`, `server/src/services/timeline-fetchers/exchange-fetchers.ts`

### 医薬品マスター / 検索 / 管理
- サーバ: `server/src/routes/drug-master.ts`, `server/src/routes/drug-master-crud.ts`, `server/src/routes/drug-master-sync.ts`, `server/src/routes/internal-drug-master-sync.ts`
- DB: `server/src/db/schema-drug-master.ts`（`schema.ts` から再エクスポート）
- クライアント: `client/src/pages/admin/AdminDrugMasterPage.tsx` と `client/src/pages/admin/components/DrugMaster*.tsx`
- 補助: `client/src/pages/admin/components/DrugMasterSearchFilter.tsx`, `DrugMasterTable.tsx`, `DrugMasterDetailModal.tsx`, `DrugMasterEditModal.tsx`, `DrugMasterBulkEditModal.tsx`

### グループ / 招待 / 連携
- サーバ: `server/src/routes/groups.ts`, `server/src/routes/admin-groups.ts`, `server/src/services/group-service.ts`
- クライアント: `client/src/pages/GroupListPage.tsx`, `client/src/pages/GroupDetailPage.tsx`

### OpenClaw / 運用補助
- サーバ: `server/src/routes/openclaw*.ts`, `server/src/routes/admin-openclaw*.ts`, `server/src/routes/internal-openclaw-retries.ts`
- クライアント: `client/src/pages/admin/AdminOpenClawPage.tsx`, `client/src/pages/admin/AdminOpenClawCommandsPage.tsx`

## 追加で拾える証跡

- `artifacts/playwright-audit/screenshots/` は画面実態の一次証跡として使える
- `artifacts/playwright-audit/reports/html/` は遷移やトレースの確認に使える
- `artifacts/playwright-audit/test-results/*/error-context.md` には版表示や失敗状況が残っている
- `workspace/queue/cross-agent-handoff.md` と `workspace/reports/dss/*.md` は運用ハンドオフ・日次実績の根拠になる

## 補足
