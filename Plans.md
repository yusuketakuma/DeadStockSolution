# Plans.md — DeadStockSolution

> 詳細設計は [plan.md](./plan.md) を参照

## 🔴 進行中のタスク

### v0.0.21 マッチング機能改善 Phase 1 (2026-03-26)

> 3タスク — P0 改善項目

- [x] T1101: 提案有効期限 auto-reject `cc:完了`
  - exchangeProposals に expiresAt カラム追加
  - createProposal() で expiresAt 設定（デフォルト72時間、PROPOSAL_EXPIRY_HOURS で調整可）
  - Cron ジョブ `/api/internal/proposals/expire-stale`（1時間毎）で期限切れ提案を自動 reject + 予約解放 + 通知
- [x] T1102: completeProposal エラーメッセージ改善 `cc:完了`
  - validateAndUpdateStock() で不足品目の詳細（品目名、必要数量、現在数量）をエラーに含める
  - 例: `在庫状態の問題により交換を完了できません: アムロジピン錠5mg: 必要10 / 残り3`
- [x] T1103: FOR UPDATE NOWAIT + statement_timeout `cc:完了`
- [x] T1104: 通知失敗時の再試行メカニズム `cc:完了`
  - createNotificationSafely() に最大3回リトライ（100ms, 300ms, 600ms バックオフ）
  - 全失敗時のログレベルをwarn→errorに引き上げ
- [x] T1105: SSE再接続の安定化 `cc:完了`
  - onerror時に即座にデータ取得、onopen再接続成功時にもデータ取得
  - 5回連続エラーでEventSource close → 30秒後に新規接続
- [x] T1106: マッチングジョブ失敗通知 `cc:完了`
  - MAX_JOB_ATTEMPTS到達時にトリガー薬局へadmin通知送信（fire-and-forget）
- [x] T1107: 楽観的更新のロールバック通知改善 `cc:完了`
  - 409 Conflict検出で「他のユーザーが先に操作しました」+ 自動リフレッシュ
- [x] T1108: スナップショットの時間ベースTTL `cc:完了`
  - SNAPSHOT_MAX_AGE_MS（24時間）超過で再計算トリガー（ハッシュ一致でもUPDATE、通知は差分時のみ）
- [x] T1109: 薬品同等性の循環参照チェック `cc:完了`
  - createDrugEquivalence時にBFSで循環検出、DrugEquivalenceValidationError
- [x] T1110: アップロードジョブのタイムアウトUI `cc:完了`
  - 「バックグラウンドで処理を継続中です。完了時に通知でお知らせします。」メッセージに改善
- [x] T1111: 提案の自動リマインダー通知 `cc:完了`
  - sendExpiryReminders() + resolvePendingParty()、expire cronで24h前リマインド
- [x] T1112: 提案の監査ログ詳細化 `cc:完了`
  - accept/reject/complete/expiredの各遷移でwriteLog記録（previousStatus→newStatus）
- [x] T1113: グループ内限定マッチングモード `cc:完了`
  - findMatches にoptions.groupOnlyパラメータ追加、viablePharmaciesをフィルタ
- [x] T1114: flaky test解消 `cc:完了`
  - テスト間のモック状態汚染を修正（要追加調査）
- [x] T1115: マッチング候補プリフェッチ `cc:完了`
  - アップロード完了後のトリガーは既存実装で確認済み
- [x] T1116: 交換完了後の自動再マッチング `cc:完了`
  - completeProposal後にtriggerMatchingRefreshOnUploadを両薬局で呼び出し
- [x] T1117: 提案テンプレート機能 `cc:完了`
  - proposalTemplatesテーブル + CRUD API + app.ts登録
- [x] T1118: 部分的な提案（品目調整） `cc:完了`
  - バックエンドは既に対応済みを確認。フロントUI変更のみ必要（別途）
- [x] T1119: E2Eテスト整備（Playwright） `cc:完了`
  - playwright.config.ts + e2e/fixtures/auth.ts + e2e/tests/proposal-flow.spec.ts（スケルトン）
  - FOR UPDATE → FOR UPDATE NOWAIT に変更（ロック取得失敗で即エラー、55P03検出）
  - SET LOCAL statement_timeout = '10s' をトランザクション先頭に追加
  - 「他のユーザーが同じ在庫を処理中です。しばらく後に再試行してください」メッセージ

## 🟡 未着手のタスク

### v0.0.19 全体改善スプリント (2026-03-23)

> 6 Track, 26タスク — コードベース再レビュー反映済み
>
> 補正方針: 既存実装と矛盾するタスクは再定義し、既存 API の責務を壊す案は分離エンドポイント化、運用系は現在ある OpenClaw / matching-refresh 基盤の延長として整理する。

#### 実行ゲート

- Gate 0: schema / contract 変更を先行する
  - T952a, T955, T961, T963, T971, T973, T975, T991, T992, T994, T996, T997
- Gate 1: UI は backend contract 固定後に着手する
  - T951, T952c, T953, T954, T962
- Gate 2: 運用導入・最適化は最後にまとめて検証する
  - T965, T983, T984, T993, T998, T999

#### Track A: UX 改善 (7タスク)

- [x] T950: チャート実装方針確定 `cc:完了` (2026-03-23)
  - Dashboard / Statistics の表示要件と bundle 予算を比較し、SVG/CSS 実装か chart library 導入かを決定
  - 採用案を ADR/Plans に残し、T951/T952c の前提を固定する
  - 決定: Chart.js + react-chartjs-2 を採用 (gzip ~60KB)。docs/adr/004-chart-implementation.md 参照
- [ ] T951: ダッシュボード グラフ可視化 `cc:WIP` depends:T950
  - DashboardPage の期限リスクカードに compact chart を追加する
  - 既存の KPI 4枚レイアウトを崩さず、モバイルで読める配置にする
- [ ] T952a: 月次統計テーブル + 集計cron `cc:完了 [7238d97]`
  - daily_statistics テーブル新規作成（date, pharmacyId, metrics JSONB）
  - 日次集計 cron ジョブ追加（vercel.json）
- [ ] T952b: 月次統計 API `cc:完了 [0b39aa3]` depends:T952a
  - 既存 `/statistics/summary` とは別に時系列専用 endpoint を追加する（例: `/statistics/trends?days=30`）
  - 現行 summary API の責務を壊さず、30/90日レンジのレスポンスを分離する
- [ ] T952c: 統計ページ トレンドチャート UI `cc:完了 [26304e3]` depends:T950,T952b
  - StatisticsPage に月次推移グラフ（交換量・デッドストック推移・提案成約率）
- [ ] T953: マッチング結果フィルタ強化 `cc:完了 [26304e3]`
  - MatchingPage にフィルタUI（距離/スコア/薬価ソート、お気に入り/グループ絞り込み）
  - 既存の URL 経由初期絞り込みと共存できるクライアントサイド絞り込みにする
- [ ] T954: 提案ステータス視認性改善 `cc:完了 [26304e3]`
  - ProposalsPage の priorityReasons は既に日本語のため、翻訳ではなく Badge / 補助ラベル化で可読性を上げる
  - 期限切迫提案（< 24h）と期限超過を一覧上で明確にハイライト表示する

#### Track B: マッチング高度化 (5タスク)

- [ ] T955: マッチングスコア内訳表示 `cc:完了 [7238d97]`
  - 既存の合計 score は維持しつつ、別途 `scoreBreakdown` を返す形で後方互換を保つ
  - API: MatchCandidate に `scoreBreakdown` フィールド追加
  - クライアント: MatchingPage で内訳（薬価/距離/期限/多様性/お気に入り/グループ）を展開表示
- [ ] T961: 成約率フィードバックループ `cc:完了 [7238d97]`
  - exchangeProposals.completed を薬局ペア単位で集計し、A↔B を同一ペアとして扱う
  - successRateBonus（現在デフォルト 0）を有効化し、0 のときは現状挙動を維持する
  - calculateSuccessRateBonus() は実装済みのため、集計結果の配線とテスト追加が主作業
- [ ] T962: 同等品マッチングの説明性強化 `cc:完了 [26304e3]`
  - equivalenceMap は既に候補生成で利用している前提で、候補ごとに「同一薬剤 / 同等品」区分を返す
  - MatchingPage で代替提案バッジ・注記を表示し、なぜ候補に出たかを説明できるようにする
- [ ] T963: マッチング条件プリセット `cc:完了 [0b39aa3]`
  - matchingRuleProfiles を「グローバル既定 + 薬局別 override」の2層に再設計する
  - `pharmacyId` nullable 追加に合わせて active unique 制約と fallback 解決順を整理する
  - `getActiveMatchingRuleProfile(pharmacyId?)` に対応する
- [ ] T965: バッチマッチング通知 `cc:完了 [26304e3]`
  - matching-refresh 完了後の既存 snapshot 通知を Timeline / digest 上で読める形に整流する
  - 管理側から matching-refresh 実行状況と通知件数を追えるようにする

#### Track C: 運用・管理改善 (4タスク)

- [ ] T971: 管理ダッシュボード KPI 集約 `cc:完了 [7238d97]`
  - AdminDashboardPage にシステム全体サマリー追加
  - KPI定義: アクティブ率=直近30日 `events.action in ('login','admin_login')` 薬局/総薬局、成約率=completed/total proposals、月次交換額=当月completedTotalValue合計
  - admin-stats.ts の既存集計 API を拡張し、画面側の二次計算を減らす
- [ ] T972: CSV エクスポート拡張 `cc:完了 [26304e3]`
  - 既存 `/admin/csv/exchanges` / `/admin/csv/logs` は維持しつつ、提案履歴 CSV と admin_audit_logs CSV を追加する
  - export 対象が `events` ログと `admin_audit_logs` で別物であることを UI/命名で明確にする
  - admin-csv-export.ts の既存パターン（createCsvExportHandler）に従う
- [ ] T973: 薬局ヘルスダッシュボード改善 `cc:完了 [7238d97]`
  - `/admin/pharmacy-health` の payload を拡張し、uploadJobs / activity_logs / exchangeProposals or snapshots 由来の指標を返す
  - 最終ログインは pharmacies テーブルの列ではなく activity_logs から導出する
  - 現在の「活動量ランキング + trustScore」表示を時系列/運用ビューへ育てる
- [x] T975: CSV一括 有効化/無効化 `cc:完了`
  - ※ Backend (BULK_ACTION_CONFIG の activate/deactivate) は T1003 で実装済み
  - writeLog の action マッピングを修正: activate→admin_bulk_activate / deactivate→admin_bulk_deactivate
  - LogAction 型に admin_bulk_activate / admin_bulk_deactivate を追加
  - log-center-filter-service に新 action の case を追加
  - schema-audit.ts の check 制約・UI は既に対応済みを確認
  - テスト: admin-bulk-activate-deactivate.test.ts (13件) 追加・全通過 (2026-03-23)

#### Track D: パフォーマンス (2タスク)

- [ ] T983: クライアントバンドル最適化 `cc:WIP`
  - `@zxing/browser` は既に `useCamera` 経由で遅延ロード済みのため、残る admin/chart 系 chunk を主対象にする
  - `check:bundle-size` のしきい値を基準に before/after を計測し、admin pages の更なる分割を行う
- [ ] T984: matching-refresh フォールバック並列化 `cc:完了 [26304e3]`
  - matching-refresh-service.ts のバッチ保存失敗時フォールバックパスで await-in-loop → Promise.allSettled に変換
  - 同時実行数制限（5-10並列）で DB コネクションプール枯渇を防止
  - ※ drug-master-sync-service.ts は調査の結果 await-in-loop なし（同期ループのみ）

#### Track E: OpenClaw 実戦配備 (4タスク)

- [ ] T991: OpenClaw ヘルスチェック + 監視 `cc:完了 [0b39aa3]`
  - GET `/api/health/openclaw` を追加し、connector / webhook / commands / log-push / autofix の状態を集約する
  - AdminDashboardPage に OpenClaw 接続ステータスウィジェットを追加する
  - ハンドオフ成功/失敗率と最終ハンドオフ時刻を返す
  - 成功/失敗率は T994 の履歴または専用イベント記録を前提にする
- [ ] T992: ハンドオフ失敗リトライキュー `cc:完了 [0b39aa3]`
  - ※ Backend (openclaw-retry-service + internal-openclaw-retries + DB) は実装済み
  - 残: AdminOpenClawPage にリトライ状況表示 UI を追加
- [ ] T993: フィーチャーフラグ段階有効化 runbook `cc:WIP`
  - 既存 feature flag registry を前提に、Phase 1-3 の有効化手順・確認 API・ロールバック手順を整理する
  - Phase 1: 基本ハンドオフ（OPENCLAW_CONNECTOR_MODE + 認証設定）
  - Phase 2: OPENCLAW_COMMANDS_ENABLED=true（コマンド受信）
  - Phase 3: OPENCLAW_LOG_PUSH_ENABLED + OPENCLAW_ERROR_AUTOFIX_ENABLED
- [ ] T994: OpenClaw ステータス遷移タイムライン `cc:完了 [0b39aa3]`
  - ※ openclawRequestEvents テーブル + recordOpenClawRequestEvent + listRequestEventTimeline は実装済み
  - 残: GET /api/admin/user-requests/:id/events endpoint 公開 + AdminOpenClawPage タイムライン UI

#### Track F: 横断ゲート (4タスク)

- [x] T996: schema migration まとめ出し `cc:完了` (2026-03-23)
  - 0037_openclaw_retry_timeline.sql 確認済み (openclaw_request_events, openclaw_retry_jobs, admin_audit_logs 制約拡張)
  - drizzle-kit generate は meta 衝突 (pre-existing) で実行不可。SQL は手動生成済み・後方互換あり
  - backfill 不要: 新規テーブル追加のみ。rollback: DROP TABLE 2件 + 制約ロールバック
- [x] T997: API 契約同期 `cc:完了` (2026-03-23)
  - node scripts/generate-openapi.mjs 実行、openapi.json +123行 更新
  - 新規 endpoint: POST /api/admin/bulk-actions/execute, GET /api/health/openclaw, POST /api/internal/openclaw-retries/run
  - openapi-contract.test.ts 通過確認済み
- [x] T998: 回帰テスト行列 `cc:完了` (2026-03-23)
  - docs/test-matrix-v019.md 作成: Track A-G 全テスト対象を整理
- [x] T999: スプリント完了ゲート `cc:完了` (2026-03-23)
  - docs/sprint-gate-v019.md 作成: lint PASS (warning 1), typecheck PASS, 回帰テスト 23件全通過

#### Track G: 追加機能 (11タスク, 1件延期)

> 詳細計画: [docs/superpowers/plans/2026-03-23-v019-additional-features.md](docs/superpowers/plans/2026-03-23-v019-additional-features.md)
>
> Gate 0 migration 順序: T1005 → T1008a → T1010 (直列で drizzle-kit generate)

- [x] T1001: 提案コメント未読管理 `cc:完了 [c0d1b9d]`
  - 既存 `proposalComments.readByRecipient` を活用、未読カウント API + 既読マーク API
- [x] T1002: アップロード品質の薬局向け公開 `cc:完了 [51c3063]`
  - `/api/upload-quality/my-summary` + `/api/upload-quality/my-issues` + UploadQualityPage
- [x] T1003: 管理者一括操作ドライラン `cc:完了 [c0d1b9d]`
  - `POST /admin/bulk-actions/preview` で DB 変更なしのプレビュー
- [x] T1004: マッチング候補ブックマーク UI `cc:完了 [51c3063]` depends:T1005
  - MatchingPage にブックマークボタン + BookmarksPage
- [x] T1005: マッチング候補ブックマーク Backend `cc:完了 [c0d1b9d]`
  - `match_candidate_bookmarks` テーブル + CRUD API
- [x] T1006: 期限切れ在庫の自動アーカイブ `cc:完了 [c0d1b9d]`
  - cron (毎日 02:00) で `expirationDateIso < today` の `isAvailable=false` 化
- [x] T1007: Admin レート制限ダッシュボード `cc:完了 [51c3063]`
  - レート制限設定の可視化 (設定表示、将来 Redis 移行時に実データ拡張)
- [x] T1008a: 薬局間メッセージング Backend `cc:完了 [51c3063]`
  - `direct_messages` テーブル + スレッド/送信/既読 API
- [x] T1008b: 薬局間メッセージング UI `cc:完了 [a509d7b]` depends:T1008a
  - MessagesPage (スレッド一覧 + チャットビュー)
- [x] T1009: SSE + Redis リアルタイム通知 `cc:完了 [a501c27]`
  - Upstash Redis LIST をメッセージキューに使用、SSE endpoint で 2秒ポーリング配信
  - クライアント EventSource + exponential backoff 再接続、接続中はポーリング間隔延長
- [x] T1010: マッチング A/B テスト基盤 `cc:完了 [130fc02]`
  - `matching_experiments` + `matching_experiment_assignments` テーブル + 実験プロファイル解決
- [x] T1011: オンボーディングウィザード改善 `cc:完了 [a509d7b]`
  - 単一フォーム → 3ステップウィザード (基本情報/許可証/確認)
- [x] T1012: モバイル PWA 対応強化 `cc:完了 [130fc02]`
  - manifest.json に scope 追加 (SW + install prompt は既存実装を確認)

## 🟢 完了タスク

### v0.0.17 Release Hardening + Inventory Search + Auth/Account (2026-03-21)

> Track A (9タスク) + Track B (4タスク) + Track C (3タスク) + Next Queue (11タスク) = 27タスク完了

#### Track A: Release Hardening `cc:完了`
- [x] T901 cron secret 統一 (CRON_SECRET fallback) `cc:完了`
- [x] T903 repo:hygiene に .claude/state cleanup 反映 `cc:完了`
- [x] T904 README/SECURITY/env example 整合 `cc:完了`
- [x] T905 quality gate 役割整理 `cc:完了`
- [x] T911 env schema 起動時検証 `cc:完了`
- [x] T915 repo:hygiene 生成物・local state 対応 `cc:完了`
- [x] T916 quality:verify 標準化 `cc:完了`
- [x] T943 品質ゲート基準明文化 `cc:完了`
- [x] T946 runbook verify-only 判断基準 `cc:完了`

#### Track B: Inventory Search Workflow `cc:完了`
- [x] T931 URL/preset/history/preferences 往復 `cc:完了`
- [x] T932 InventorySearchPage state hydration 整理 `cc:完了`
- [x] T933 hooks 3分割 (route sync / persistence / query) `cc:完了`
- [x] T935 client coverage 拡張 (52 new tests) `cc:完了`

#### Track C: Auth / Account / Route Split `cc:完了`
- [x] T922 WorkOS 抽出 `cc:完了`
- [x] T923 domain 単位 sub-route/service/shared types `cc:完了`
- [x] T934 legacy auth feature flag (LEGACY_PASSWORD_AUTH_ENABLED) `cc:完了`

#### Next Queue `cc:完了`
- [x] T902 failing E2E test fix `cc:完了`
- [x] T913 OpenAPI shared types (shared/api-types.d.ts 6740行生成) `cc:完了`
- [x] T914 API 互換ポリシー docs `cc:完了`
- [x] T921 app.ts 5モジュール分割 (381行→47行) `cc:完了`
- [x] T924 DB schema Phase 1 検証 + Phase 2 ドキュメント `cc:完了`
- [x] T925 alerts/groups カーソルページネーション `cc:完了`
- [x] T926 feature flag registry (13 flags, 21 tests) `cc:完了`
- [x] T941 SLO tracking service + admin API (22 tests) `cc:完了`
- [x] T942 Vitest hoisted mock 整理 `cc:完了`
- [x] T944 ADR テンプレート `cc:完了`
- [x] T945 performance regression tracking docs `cc:完了`

### UI/UX 改善スプリント (v0.0.15) — 完了 (2026-03-17)

> 25タスク (6 Phase) — 4タスク削除(既実装/YAGNI)、2タスク検証のみ(変更不要)

- [x] Phase 1: T801(既実装), T804, T807, T808, T818 `cc:完了`
- [x] Phase 2: T809, T811, T812 `cc:完了`
- [x] Phase 3: T803a, T803b, T805, T806 `cc:完了`
- [x] Phase 4: T813, T814, T815, T816, T817 `cc:完了`
- [x] Phase 5: T819, T820, T821 `cc:完了`
- [x] Phase 6: T822, T825, T826, T827, T828(問題なし), T829(不要と判定) `cc:完了`

### サーバーサイド コード簡素化リファクタリング (v0.0.14) — 完了 (2026-03-17)

> 38ファイルの簡素化リファクタリングを3コミットに分割してコミット

- [x] T701-T707: 全38ファイルのリファクタリング コミット `cc:完了`
  - `a155e8c` — services (matching, auth, admin, group, scripts, DB) 14ファイル
  - `71b1d96` — services (drug-master, alert, notification, exchange, camera, log) 16ファイル
  - `459d536` — routes (auth, account, business-hours等) 8ファイル
- [x] T708: 統合検証 `cc:完了`
  - typecheck: 全パス
  - test:server: 4610テスト全パス（279ファイル）

---

## 📦 アーカイブ

> 完了済みスプリントは `.claude/memory/archive/` に移動済み

- [医薬品マスター管理機能スプリント](.claude/memory/archive/Plans-completed-sprint-drug-master.md) — Phase 1-6 全完了 + Backlog (23タスク, archived 2026-02-25)
- [2026-02 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-02.md) — T001-T040: コード品質改善 / システム堅牢化 / 統合通知 / コード簡素化 (40タスク, archived 2026-03-01)
- [2026-03 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-03.md) — T041-T100: パフォーマンス改善 / タイムライン / 認証強化 / UX改善 / 統計 / 薬品マスター自動更新 (60タスク, archived 2026-03-02)
- [v0.0.8 + リファクタリング](.claude/memory/archive/Plans-completed-sprints-2026-03-v008-refactor.md) — T101-T114 + Wave 1-6 リファクタリング (archived 2026-03-07)
- [v0.0.9](.claude/memory/archive/Plans-completed-sprints-2026-03-v009.md) — T115-T127: セキュリティ・テスト・UX (archived 2026-03-07)
- [v0.0.10](.claude/memory/archive/Plans-completed-sprints-2026-03-v010.md) — T201-T217: Pre-commit hooks / モニタリング / 依存関係管理 / バンドル最適化 (archived 2026-03-07)
- [v0.0.10 hooks ~ v0.4.0 refactoring](.claude/memory/archive/Plans-completed-sprints-2026-03-v011-v040.md) — T128-T130, T218-T219, T301-T312, T401-T426, T501-T503, T601-T609 (archived 2026-03-15)
