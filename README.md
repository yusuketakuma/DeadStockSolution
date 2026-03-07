# DeadStockSolution

## システム紹介

DeadStockSolution は、薬局間のデッドストック交換を支援する業務システムです。  
在庫アップロード、マッチング、提案対応、通知、管理者向け運用機能を一つの画面で扱えるようにし、
日々の在庫調整を効率化することを目的としています。

## このシステムが解決する課題

- 期限が近い在庫・動かない在庫を、単独薬局内で処理しきれない
- 交換相手の探索を電話・FAX・メールに頼っており、調整コストが高い
- 交換提案のステータス管理が分散し、対応漏れや確認遅延が起きやすい
- 在庫リスクや交換実績を横断して把握しづらく、改善判断が遅れる

## 主要機能

- 在庫アップロードと差分反映  
  - Excelアップロード（非同期ジョブ処理）でデッドストック/使用量データを登録
  - replace/diff/partial 方式を選択し、取り込み失敗行の確認にも対応
- マッチング候補の自動生成  
  - 薬剤名類似・期限・距離・相互不動在庫解消効果を加味して候補を優先度付け
  - 候補ごとに交換価値や優先理由（経営インパクト指標）を提示
- 提案ワークフロー管理  
  - 提案作成、承認/拒否、確定、交換完了までを一貫管理
  - コメント、フィードバック、履歴管理で追跡性を確保
- 通知・タイムライン  
  - 未読数、重要イベント、ダイジェストを集約し、対応順を明確化
- 統計ダッシュボード  
  - アップロード状況、在庫リスク、提案/交換実績、信頼指標を可視化
- 認証・審査フロー  
  - 薬局審査（pending/verified/rejected）と再審査トリガーを組み込み
  - 管理者向け審査・運用APIを提供
- 外部連携（OpenClaw）  
  - 要望や審査イベントのハンドオフ/コールバック連携をサポート

## 導入効果（想定）

- 滞留在庫の削減と廃棄損失の抑制
- 交換調整リードタイムの短縮（候補探索と進捗管理の自動化）
- 担当者依存の運用から、状態が見える標準化運用への移行
- データに基づく改善サイクル（在庫・提案・交換の継続的最適化）

## Codex サブエージェント運用メモ

- この環境では `spawn_agent` の role に差異があります。
- 2026-02-25 時点で動作確認できた role:
  - `implementer`
  - `claude_implementer`
  - `claude_reviewer`
- 2026-02-25 実測で利用不可だった role:
  - `default`
  - `explorer`
  - `worker`
  - `verifier`
- `agent type is currently not available` が出る場合は、次の順で再試行してください。
  1. `implementer`
  2. `claude_implementer`
  3. `claude_reviewer`

## Performance Regression Guard

- baseline 更新:

```bash
npm run test:perf:update:server
```

- baseline チェック:

```bash
npm run test:perf:server
```

- 許容差は相対+絶対の組み合わせで判定されます（baseline.json 内の `tolerances`）。

## Vercel Postgres移行手順

1. `server/.env` にDB接続URLを設定（推奨: `POSTGRES_URL_UNIFIED` / `POSTGRES_URL_NON_POOLING_UNIFIED`）
2. スキーマを作成

```powershell
npm run db:migrate --workspace=server
```

3. 既存SQLite/Tursoデータを移行（任意）

```bash
# 既存DBがTursoの場合
$env:LEGACY_DATABASE_URL="libsql://xxxx.turso.io"
$env:LEGACY_AUTH_TOKEN="xxxxx"

# 既存DBがローカルSQLiteの場合（どちらか）
$env:LEGACY_SQLITE_PATH="./local.db"
# または server/local.db を自動検出

npm run db:migrate:legacy --workspace=server
```

`LEGACY_MIGRATION_MODE=replace` を設定すると、移行前にPostgres側テーブルを初期化します（既定は `append`）。

## 環境変数（認証）

- `CORS_ORIGINS`: 許可するオリジンをカンマ区切りで指定（本番必須）
- `JWT_SECRET`: JWT署名シークレット（`NODE_ENV=test` 以外では必須。32文字以上かつ既知の弱い値は不可）
- `POSTGRES_URL_UNIFIED`: preview / production を同一DBへ統一する場合の共通接続URL（最優先）
- `POSTGRES_URL_NON_POOLING_UNIFIED`: マイグレーション用の非プーリング共通URL（任意、未設定時は `POSTGRES_URL_UNIFIED`）
- `POSTGRES_URL_PRODUCTION`: preview環境だけ本番DBへ寄せる場合の接続URL（`VERCEL_ENV=preview` 時のみ参照）
- `POSTGRES_URL_NON_POOLING_PRODUCTION`: 上記の非プーリング版（任意）
- `NODE_ENV=production` または `VERCEL_ENV` 設定環境では、上記いずれかのPostgres URL未設定時にアプリは起動エラーで停止（fail-closed）
- `VITE_API_BASE_URL`: クライアントのAPIベースURL（未設定時は同一オリジンの `/api`）
- `TEST_LOGIN_FEATURE_ENABLED`: テストログイン機能の server-side feature flag。`true` / `false` で明示上書き。未設定時は `VERCEL_ENV=preview` なら `true`、それ以外は `NODE_ENV=production` で `false`、それ以外で `true`
- `VITE_TEST_LOGIN_FEATURE_ENABLED`: テストログイン機能の client-side feature flag。未設定時は `true`、`false` を明示すると無効

### テストログイン仕様の固定ルール

- この仕様は固定です。変更は明示的なプロダクト判断がある場合のみ行ってください。
- server 側は `TEST_LOGIN_FEATURE_ENABLED` 明示値を最優先し、未設定時は `VERCEL_ENV=preview` で有効、それ以外は `NODE_ENV=production` で無効です。
- client 側は `VITE_TEST_LOGIN_FEATURE_ENABLED=false` を明示した場合のみ無効で、未設定時は有効です。
- 回帰防止の契約テストは [test-login-feature-config.test.ts](/Users/yusuke/DeadStockSolution/server/src/test/test-login-feature-config.test.ts) と [test-login-feature.test.ts](/Users/yusuke/DeadStockSolution/client/src/test/test-login-feature.test.ts) です。仕様変更時はこの2つの意図も合わせて更新してください。
- `EXPOSE_PASSWORD_RESET_TOKEN`: `true` のときのみパスワードリセットトークンをAPIレスポンスに含める（開発限定）
- `TRUST_PROXY`: `true` または hop数（例: `1`）で `trust proxy` を有効化
- `DRUG_MASTER_AUTO_SYNC`: `true` で医薬品マスター自動取得を有効化
- `DRUG_MASTER_SOURCE_URL`: 医薬品マスター取得元URL（HTTPS）
- `DRUG_MASTER_CHECK_INTERVAL_HOURS`: 自動取得の確認間隔（時間）
- `DRUG_MASTER_FETCH_RETRIES`: 医薬品マスター取得時の一時障害に対する再試行回数（0-5）
- `DRUG_PACKAGE_AUTO_SYNC`: `true` で包装単位マスター自動取得を有効化
- `DRUG_PACKAGE_SOURCE_URL`: 包装単位取得元URL（HTTPS、CSV/XLSX/XML/ZIP）
- `DRUG_PACKAGE_CHECK_INTERVAL_HOURS`: 包装単位自動取得の確認間隔（時間）
- `DRUG_PACKAGE_FETCH_RETRIES`: 包装単位取得時の一時障害に対する再試行回数（0-5）
- `DRUG_PACKAGE_SOURCE_AUTHORIZATION`: 取得元に認証ヘッダーが必要な場合に指定（任意）
- `DRUG_PACKAGE_SOURCE_COOKIE`: 取得元にCookieが必要な場合に指定（任意）
- `EXTERNAL_FETCH_ALLOWED_HOSTS`: 外部取込み先の許可ホスト（カンマ区切り、`*.example.com` 形式対応。`NODE_ENV=production` では未設定時に外部取得を拒否）
- `SCHEDULER_OPTIMIZED_LOOP_ENABLED`: `true` で scheduler を timeout-chain モード（既定）で動作
- `DRUG_MASTER_SCHEDULER_OPTIMIZED_LOOP_ENABLED`: 医薬品マスター scheduler の loop モード個別上書き（任意）
- `DRUG_PACKAGE_SCHEDULER_OPTIMIZED_LOOP_ENABLED`: 包装単位 scheduler の loop モード個別上書き（任意）
- `IMPORT_FAILURE_ALERT_ENABLED`: `true` で取込失敗アラート監視を有効化
- `IMPORT_FAILURE_ALERT_INTERVAL_MINUTES`: 失敗件数を確認する間隔（分）
- `IMPORT_FAILURE_ALERT_WINDOW_MINUTES`: 集計対象の直近時間幅（分）
- `IMPORT_FAILURE_ALERT_THRESHOLD`: アラート発火の最小失敗件数
- `IMPORT_FAILURE_ALERT_COOLDOWN_MINUTES`: 再通知までのクールダウン時間（分）
- `IMPORT_FAILURE_ALERT_ACTIONS`: 監視対象アクション（カンマ区切り）
- `IMPORT_FAILURE_ALERT_SCHEDULER_OPTIMIZED_LOOP_ENABLED`: 取込失敗アラート scheduler の loop モード個別上書き（任意）
- `IMPORT_FAILURE_ALERT_WEBHOOK_URL`: 通知先Webhook URL（HTTPS推奨、未設定時はログ警告のみ）
- `IMPORT_FAILURE_ALERT_WEBHOOK_TOKEN`: WebhookのBearerトークン（任意）
- `IMPORT_FAILURE_ALERT_WEBHOOK_TIMEOUT_MS`: Webhook通知タイムアウト（ミリ秒）
- `IMPORT_FAILURE_ALERT_OPENCLAW_AUTO_HANDOFF`: `true` で閾値超過時にOpenClawへ自動ハンドオフ
- `IMPORT_FAILURE_ALERT_OPENCLAW_PHARMACY_ID`: 自動ハンドオフ時に `user_requests` を作成する薬局ID
- `IMPORT_FAILURE_ALERT_OPENCLAW_DEDUP_MINUTES`: 自動ハンドオフの重複抑止時間（分）
- `REQUEST_LOG_ERRORS_ONLY`: `true` で4xx/5xxのみ request ログ出力（既定）
- `REQUEST_METRICS_ENABLED`: `false` で request メトリクス収集を停止
- `LOGGER_LAZY_PAYLOAD_ENABLED`: `true` で logger payload 関数を必要時のみ評価（既定）
- `OPENCLAW_WEBHOOK_MAX_SKEW_SECONDS`: OpenClaw Webhook署名検証で許容する時刻ずれ（秒）
- `OPENCLAW_LOG_CONTEXT_WINDOW_HOURS`: OpenClawへ渡すログ集計対象の時間幅（時間）
- `OPENCLAW_LOG_CONTEXT_RECENT_FAILURE_LIMIT`: OpenClawへ渡す直近失敗ログ件数
- `OPENCLAW_LOG_CONTEXT_RECENT_ACTIVITY_LIMIT`: OpenClawへ渡す薬局別アクティビティログ件数
- `OPENCLAW_LOG_CONTEXT_DETAIL_MAX_LENGTH`: OpenClawへ渡すログ詳細文の最大文字数
- `VERCEL_DEPLOY_WEBHOOK_SECRET`: `/api/internal/vercel/deploy-events` のBearer認証シークレット
- `GITHUB_UPDATES_REPOSITORY`: 更新情報表示で参照するGitHubリポジトリ（`owner/repo`）。本番では必須
- `GITHUB_UPDATES_RETRIES`: GitHub release 取得失敗時の再試行回数（0-3）
- OpenClaw Webhook受信時は `x-openclaw-signature` と `x-openclaw-timestamp` を利用したHMAC認証を必須化
- HMAC認証は時刻ずれ検証に加え、同一署名の短時間リプレイも拒否します

## 包装単位マスター（公的ソース）

- 包装単位（販売包装単位コード/JAN/HOT/包装単位）は PMDA の添付文書情報XMLで配信されます。
  - PMDA（添付文書情報XMLのダウンロードサービス案内）: https://www.pmda.go.jp/safety/info-services/drugs/medicines-information/medicines-information-attached/0002.html
  - 厚労省（薬価基準収載品目リスト）: https://www.mhlw.go.jp/topics/2025/04/tp20250401-01.html
- 本システムは `DRUG_PACKAGE_SOURCE_URL` に設定した公的データURLを定期監視し、自動で取り込みます。
- PMDA配信URLに認証が必要な場合は `DRUG_PACKAGE_SOURCE_AUTHORIZATION` / `DRUG_PACKAGE_SOURCE_COOKIE` で付与できます。
- 管理画面から手動トリガーも可能です。

## Vercel / Neon Preview運用

- Vercelの自動デプロイは `main` / `preview` のみ許可しています（`vercel.json` の `git.deploymentEnabled`）。
- featureブランチのGit pushでは自動デプロイされません。
- CLI実行時の誤爆防止として、以下スクリプトはブランチを強制チェックします。
  - `npm run deploy:preview`（`preview` ブランチのみ）
  - `npm run deploy:prod`（`main` ブランチのみ）
- preview / production でDBを統一する場合は、Vercel Project Settings の両環境で同じ `POSTGRES_URL_UNIFIED`（必要なら `POSTGRES_URL_NON_POOLING_UNIFIED`）を設定します。
- 既存運用で preview 環境だけ本番DBへ寄せる場合は、preview側に `POSTGRES_URL_PRODUCTION`（必要なら `POSTGRES_URL_NON_POOLING_PRODUCTION`）を設定します。

### 分離DBを使う場合のみ: main DB を preview DB に同期する（Neon branch reset）

- リポジトリには `/.github/workflows/neon-sync-preview.yml` を追加しています。
- `preview` ブランチへ push（または `workflow_dispatch`）すると、Neon の preview ブランチを親ブランチ最新状態にリセットします。
- 想定構成は「Neon で preview ブランチの親を main（本番）にする」運用です。

設定手順:

1. GitHub Repository Secret に `NEON_API_KEY` を設定
2. GitHub Repository Variable に `NEON_PROJECT_ID` を設定
3. 必要に応じて `NEON_PREVIEW_BRANCH` を設定（未設定時は `preview`）

注意:

- この同期は preview 側のデータを上書きします（preview への書き込みデータは消えます）。
- `main` と `preview` で完全分離を維持したい場合は、このワークフローを有効化しないでください。

## 営業時間設定

- 通常営業時間（曜日別）に加えて、特例営業時間を登録できます。
- 特例営業時間は `祝日休業 / 大型連休休業 / 臨時休業 / 特別営業時間` をサポートします。
- 特例営業時間は同日の通常営業時間より優先して判定されます。
