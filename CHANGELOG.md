# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.9] - 2026-03-06

### Added

- **カメラデッドストック登録**: カメラ撮影によるデッドストック一括登録フロー（CameraDeadStockRegisterPanel 1,202行）、GS1バーコードパーサー、サーバー側 camera-dead-stock-service
- **サインインフロー刷新**: ログイン画面を再設計しシンプル化、テストログインのゲート制御（testLoginFeature）、環境別フィーチャーフラグ対応
- **ErrorBoundary**: クライアント全体のエラー境界コンポーネント、ErrorRetryAlert による再試行UI
- **デッドストック取込改善**: アップロードページの取込フロー安定化、CSV行長セキュリティチェック追加
- **テスト大幅追加**: inventory-route（335行）、scheduler-runtime-branch（235行）、admin-pharmacies-list-extra（141行）、logger-branches（144行）、drug-master-source-state-service-extra（121行）、test-pharmacy-schema（91行）、gs1-parser（57行）、test-login-feature-config（46行）、csv-line-length-security（37行）等の新規テスト
- **デザインシステム拡張**: design-language.css（286行追加）、モバイル向けスタイル強化
- **proposal-status ユーティリティ**: proposalStatusStyle のカバレッジを95%基準に到達

### Fixed

- **テスト薬局プレビュー**: Vercel preview 環境でのテスト薬局プレビュー表示を修正（2件）
- **タイムゾーン対応**: toJstDate のタイムゾーン非依存化、23:00 JST テストの UTC 明示化でCI互換性を確保
- **自動スキャン**: safe autofix の適用（2件）
- **エラーハンドラ**: error-handler ミドルウェアの改善
- **テストアカウントパスワード**: preview 環境でのテストアカウントパスワード返却を修正

### Changed

- **サーバー大規模リファクタリング**: auth.ts、exchange-proposals.ts、notifications.ts、matching-service.ts、upload-diff-service.ts、upload-confirm-service.ts 等の主要サービス・ルートを整理・最適化（計 6,000行以上の差分）
- **ホットパス最適化**: codex repo 設定の除去、不要な処理パスの簡略化
- **usePaginatedList**: キャッシュ処理の簡略化、過剰な useMemo を除去
- **共通ユーティリティ抽出**: parseTimestamp 抽出、LOG_SOURCE_VALUES 重複除去
- **ページコンポーネント改善**: LoginPage（535行→簡略化）、MatchingPage、StatisticsPage、UploadPage、ProposalDetailPage 等の UI 改善
- **PGlite統合テスト基盤**: test-db.ts のスナップショットDDL生成を168行拡張
- **network-utils**: 100行の改善、request-utils にユーティリティ追加
- **migrate-legacy**: レガシーマイグレーション処理の簡略化（135行削減）

## [0.0.7] - 2026-03-02

### 🎯 What's Changed for You

**統合ログセンターとOpenClawコマンド管理で運用監視を強化。コード品質の大幅改善**

| Before | After |
|--------|-------|
| ログは各テーブルを個別に確認 | 統合ログセンター（4ソース横断検索・フィルタ） |
| エラーコードなし | 14種の構造化エラーコード（カテゴリ・重要度付き） |
| OpenClawコマンドは手動実行のみ | HMAC認証付きコマンド受信API + 管理者履歴表示 |
| スケジューラに重複ロジック | 共通モジュール化（mhlw-source-fetch等） |

### Added

- **統合ログセンター**: activity_logs / system_events / drug_master_sync_logs / openclaw_commands の4テーブルを横断する統合ログビュー、レベル・ソース・薬局フィルタ、サマリーAPI
- **エラーコード管理**: error_codes テーブル、14種の初期コード（upload/auth/sync/system/openclaw）、管理者CRUD API
- **OpenClawコマンド受信**: HMAC署名検証付きコマンドAPI、ホワイトリスト方式の実行制御、管理者向けコマンド履歴タブ
- **ログアラート転送**: OpenClawゲートウェイへのバッファ付きバッチ送信サービス
- **MHLWソース状態管理**: drug_master_source_state テーブルで更新チェック状態を永続化、ETag/Last-Modified/content-hash による差分検知

### Fixed

- **タイムラインソート安定化**: cursor pagination のソート順安定性を修正
- **アップロードジョブ処理**: 設定されたリトライバッチサイズまで処理するよう修正
- **OpenClaw IPv6対応**: localhost の IPv6 ベースURL を許可
- **自動スキャン**: safe autofix の適用（6件）

### Changed

- **スケジューラ共通化**: drug-master-scheduler / drug-package-scheduler の更新チェック・ダウンロードロジックを mhlw-source-fetch.ts に統合
- **コード品質改善**: getErrorMessageOrFallback 除去、previewDetail 共通ユーティリティ化、normalizeSearchTerm 統一、useMemo 最適化、AdminSystemEventsPage デッドコード削除（244行）

## [0.0.6] - 2026-03-01

### 🎯 What's Changed for You

**薬局登録時の本人確認フローを追加。OpenClaw連携による自動検証を実現**

| Before | After |
|--------|-------|
| 薬局登録即利用可能 | 登録→本人確認→承認の3ステップフロー |
| 管理者の手動確認のみ | OpenClaw連携による自動検証 + 管理者手動承認 |
| 確認状態の表示なし | ログイン時の状態チェック + 確認待ちページ |

### Added

- **薬局本人確認フロー**: 登録→pending_verification→verified/rejected の状態遷移
- **OpenClaw検証連携**: 登録時にOpenClawへ自動ハンドオフ、コールバックで結果受信
- **管理者手動承認**: 管理者画面から確認状態の表示・手動承認操作
- **確認待ちページ**: 登録後のリダイレクト先、状態に応じた案内表示
- **認証ミドルウェア強化**: ログイン時の確認状態チェック

### Fixed

- **タイムラインUI**: ダッシュボードタイムラインにカードボーダーを追加

### Changed

- **エラーハンドリング整理**: 不要なヘルパー関数の削除
- **レビュー指摘対応**: exchange/statistics/upload の品質改善

## [0.0.5] - 2026-03-01

### 🎯 What's Changed for You

**統合タイムラインでダッシュボードを刷新。朝開いたら全部わかる体験を実現**

| Before | After |
|--------|-------|
| 通知ベースの個別表示 | 9テーブル統合タイムライン（優先度ランク付き） |
| ダッシュボードはスクロール必須 | PC画面にフィットするビューポートレイアウト |
| ログイン→表示まで約7秒 | API並列化+キャッシュで高速化 |
| 運用監視なし | KPIモニタリング・予測アラート・取込ジョブ管理 |

### Added

- **統合タイムライン**: 9テーブルから集約したイベントフィード、Critical/High/Medium/Low 4段階優先度エンジン、SmartDigest（今日のアクション）、優先度フィルタ付きタイムラインビュー（97テスト）
- **運用管理機能群**: 取込ジョブ管理、システムイベント、KPIモニタリング、予測アラート、マッチングルール管理
- **ダッシュボードPC画面フィット**: 2カラムトップ（SmartDigest+リスクKPI）+ タイムライン（flex-grow内部スクロール）でスクロール不要

### Fixed

- **セキュリティ**: fast-xml-parser の脆弱性修正（audit finding 対応）
- **自動スキャン**: safe autofix の適用

### Changed

- **ダッシュボード表示高速化**: `/notifications` クエリ並列化、リスクAPI 30秒キャッシュ、AuthContext 二重取得除去、NotificationContext 統合
- **運用ドキュメント整備**: hourly scan 設定、isolated subagent review mode 文書化

## [0.0.4] - 2026-02-28

### 🎯 What's Changed for You

**提案タイムライン・アップロード確認ワークフロー・セキュリティ強化の大型アップデート**

| Before | After |
|--------|-------|
| 提案の経緯が不明 | アクター・操作ごとのタイムライン表示で経緯が一目瞭然 |
| アップロード即反映で誤操作リスク | 差分プレビュー→確認→反映の3ステップ確認ワークフロー |
| エラーメッセージに内部情報が漏れる可能性 | 本番環境ではエラー詳細をサニタイズ、CSP/CSRF対策も強化 |
| バージョン表示なし | タイトル横にアプリバージョンを常時表示 |

### Added

- **提案タイムライン**: 提案の状態遷移をアクター・操作・日時で時系列表示
- **タイムラインフィルター**: 管理者向け全タイムライン閲覧・絞り込み機能
- **アップロード確認ワークフロー**: 差分プレビュー→確認→反映の3ステップで誤操作を防止
- **OpenClaw Gateway CLI モード**: OpenClaw コネクタにゲートウェイCLIモードを追加
- **管理者アラートサマリ**: アップロード失敗・未処理ジョブの要約表示

### Fixed

- **バージョン表示**: ヘッダーとログイン画面のタイトル横にアプリバージョンを表示
- **セキュリティ強化**: エラーメッセージのサニタイズ、CSP ヘッダー追加、CSRF/内部認証のタイミングセーフ比較
- **テスト薬局プレビュー**: プレビュー環境でのデフォルト動作を復元
- **テスト基盤改善**: Node 25+ 環境の localStorage 互換性修正

### Changed

- **コードリファクタリング**: exchange.ts と admin-pharmacies.ts をサブルートモジュールに分割
- **パフォーマンス改善**: マッチングリフレッシュのN+1クエリ解消、複合インデックス追加
- **ステータスラベル日本語化**: 提案の承認/拒否ステータスをユーザー視点の日本語表記に統一

## [0.0.3] - 2026-02-28

### 🎯 What's Changed for You

**通知センター・テストアカウント基盤・UIコンポーネントライブラリの追加**

| Before | After |
|--------|-------|
| 通知機能なし | 統合通知センター（リアルタイム既読管理付き） |
| テストアカウントはハードコード | DB 駆動の is_test_account フラグで一元管理 |
| ページごとに個別UI実装 | 再利用可能なUIコンポーネントライブラリ (AppField, AppSelect 等) |
| 管理画面は薬局一覧のみ | 管理者向け薬局編集・月次レポート・リスク管理画面追加 |

### Added

- **通知センター**: notifications テーブル、NotificationService、通知API 5エンドポイント、フロントエンド NotificationContext
- **テストアカウント基盤**: is_test_account フラグ、DB 駆動のテスト薬局シード、テスト薬局ピッカーUI
- **UIコンポーネントライブラリ**: AppField, AppSelect, AppCard, AppAlert, AppEmptyState, PageLoader, LoadingButton 等 16コンポーネント
- **管理者薬局編集ページ**: AdminPharmacyEditPage（652行）で薬局情報の詳細編集が可能に
- **月次レポート機能**: MonthlyReportService、スケジューラ、管理者レポートページ
- **信頼スコアサービス**: TrustScoreService で薬局の信頼度を評価
- **期限切れリスクサービス**: ExpiryRiskService で在庫の期限切れリスクを分析
- **アップロード差分サービス**: UploadDiffService で在庫アップロード時の差分検出
- **提案優先度サービス**: ProposalPriorityService で提案の優先順位付け
- **デザインシステム**: medical-ui-design-language.css (608行)、generic-design-presets
- **楽観的ロック**: optimistic lock versions による同時編集の競合防止
- **新規テスト 20+件**: auth, notifications, exchange, inventory, pharmacies, trust-score, upload-diff, monthly-report 等
- **デモログイン改善**: 個別デモ資格情報、ロールベース薬局編集UX

### Fixed

- **通知 referenceId**: new_comment 通知で commentId ではなく proposalId を使用するよう修正
- **認証フロー強化**: ログイン/セッションフローのハードニング、本番環境ガード
- **テスト薬局プレビュー**: アカウントサイズに連動した表示件数制御
- **Drizzle マイグレーション**: 繰り返し実行時のべき等性を確保
- **テストアカウントパスワード**: ワンクリックログイン用のデフォルトパスワードフォールバック復元
- **テスト薬局フォールバック**: test フラグ欠損時に DB のテスト風薬局へフォールバック

### Changed

- **テスト薬局一覧**: is_test_account のみでシンプルに判定するようリファクタリング
- **認証リファクタリング**: デモログイン・シードの成果物を整理・削除
- **ESLint 設定**: eslint.config.mjs 追加（monorepo 対応）

## [0.0.2] - 2026-02-26

### 🎯 What's Changed for You

**コードベースの大規模モジュール分割とマッチング基盤強化**

| Before | After |
|--------|-------|
| 巨大な単一ファイル (admin.ts 700行, drug-master.ts 700行等) | 責務別に分割された小モジュール群 |
| マッチング結果は毎回フル計算 | スナップショット・リフレッシュジョブによる差分更新基盤 |
| マッチング通知なし | match_notifications テーブルで新規候補を通知可能に |

### Changed

- **モジュール分割**: server routes (admin, drug-master, upload) と services (drug-master, matching) を責務別に分割
- **クライアント分割**: AccountPage, DashboardPage, AdminDrugMasterPage を小コンポーネントに分解
- **CSS分割**: app.css をセクション別 (header, layout-sidebar, content, mobile) に分離
- **ルート定義抽出**: App.tsx から route-config.tsx に分離

### Added

- **マッチング予約**: dead_stock_reservations テーブルで提案中在庫の二重マッチを防止
- **マッチングスナップショット**: match_candidate_snapshots テーブルで候補状態を保持
- **マッチング通知**: match_notifications テーブルとリアルタイム通知基盤
- **リフレッシュジョブキュー**: matching_refresh_jobs テーブルとリトライ・排他制御
- **pg_trgm インデックス**: 医薬品名・ジェネリック名・ログ詳細のあいまい検索高速化
- **useAsyncResource フック**: 非同期リソース取得の共通化
- **新規テスト**: exchange-service, matching-refresh, matching-snapshot, notifications-route, http-utils, network-utils, dashboard, routes-meta, business-hours-settings

## [0.0.1] - 2026-02-25

### 🎯 What's Changed for You

**薬局向けデッドストック管理システムの初回リリース**

| Before | After |
|--------|-------|
| 未提供 | 薬局デッドストック管理システム |
| 薬局間の手動在庫管理 | 仮マッチング → 確定 → 完了の自動ワークフロー |
| 薬価参照なし | 厚労省医薬品マスター自動同期 (Excel/CSV) |

### Added

- **医薬品マスター管理**: MHLW データ取得・パース・同期・検索、管理者UI
- **在庫マッチング**: 3フェーズワークフロー、薬局お気に入り/ブロック機能
- **OpenClaw連携**: コールバック処理、自動ハンドオフ、ログコンテキスト
- **GitHub Updates API**: `/api/updates` エンドポイント
- **取り込み失敗アラート**: インポート失敗の定期監視
- **モバイルUI改善**: ヘッダークイックリンク、ユーザーリクエストボタン
- **E2Eテスト**: ダッシュボード、ログイン、在庫、提案、登録フロー
- **可観測性**: リクエストロガー、フィーチャーフラグ付き構造化ログ

### Fixed

- Vercel preview でのデモアカウントシード/パスワードフォールバック
- デモログイン資格情報の自動入力
- Preview DB同期とテストアカウントパスワード更新
- 本番環境でのCORS同一ホストオリジンチェック

[0.0.9]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.8...v0.0.9
[0.0.7]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/yusuketakuma/DeadStockSolution/commits/v0.0.1
