# DeadStockSolution

## システム紹介

DeadStockSolution は、薬局間の不動在庫交換を支援する業務システムです。  
在庫アップロード、マッチング、提案対応、通知、管理者向け運用機能を一つの画面で扱えるようにし、
日々の在庫調整を効率化することを目的としています。

## Vercel Postgres移行手順

1. `server/.env` に `POSTGRES_URL`（必要なら `POSTGRES_URL_NON_POOLING`）を設定
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

## 環境変数（認証・テスト薬局）

- `CORS_ORIGINS`: 許可するオリジンをカンマ区切りで指定（本番必須）
- `ENABLE_TEST_PHARMACY_ACCOUNTS`: `true` のときのみテスト薬局シードを有効化（本番は `false` 推奨）
- `TEST_ACCOUNT_PASSWORD`: テスト薬局の共通パスワード（8文字以上必須）
- `EXPOSE_PASSWORD_RESET_TOKEN`: `true` のときのみパスワードリセットトークンをAPIレスポンスに含める（開発限定）
- `TRUST_PROXY`: `true` または hop数（例: `1`）で `trust proxy` を有効化
- `DRUG_MASTER_AUTO_SYNC`: `true` で医薬品マスター自動取得を有効化
- `DRUG_MASTER_SOURCE_URL`: 医薬品マスター取得元URL（HTTPS）
- `DRUG_MASTER_CHECK_INTERVAL_HOURS`: 自動取得の確認間隔（時間）
- `DRUG_PACKAGE_AUTO_SYNC`: `true` で包装単位マスター自動取得を有効化
- `DRUG_PACKAGE_SOURCE_URL`: 包装単位取得元URL（HTTPS、CSV/XLSX/XML/ZIP）
- `DRUG_PACKAGE_CHECK_INTERVAL_HOURS`: 包装単位自動取得の確認間隔（時間）
- `DRUG_PACKAGE_SOURCE_AUTHORIZATION`: 取得元に認証ヘッダーが必要な場合に指定（任意）
- `DRUG_PACKAGE_SOURCE_COOKIE`: 取得元にCookieが必要な場合に指定（任意）

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
- Neon連携時は `DRUG_PACKAGE_SOURCE_URL` などの環境変数を Vercel Project Settings に設定し、Preview環境で分離DBを利用してください。
- デモアカウントを Preview で使う場合は、Vercel Environment Variables に以下を設定してください。
  - `ENABLE_TEST_PHARMACY_ACCOUNTS=true`
  - `TEST_ACCOUNT_PASSWORD`（クライアントの `VITE_TEST_ACCOUNT_PASSWORD` と同じ値）
  - 互換のため、`VERCEL_ENV=preview` かつ `TEST_ACCOUNT_PASSWORD` 未設定時は `password123` を既定値として使用します。

### main DB を preview DB に同期する（Neon branch reset）

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
