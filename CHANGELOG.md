# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.4]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/yusuketakuma/DeadStockSolution/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/yusuketakuma/DeadStockSolution/commits/v0.0.1
