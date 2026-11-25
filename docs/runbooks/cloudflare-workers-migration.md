# Cloudflare Workers 移行手順

Vercel（serverless）から Cloudflare Workers へホスティングを移す手順。
コード側の対応はこのリポジトリに入っており、ここに書いたアカウント設定・シークレット・DNS は手作業で行う。

## 構成

| 役割 | Vercel（旧） | Cloudflare（新） |
|------|-------------|-----------------|
| 画面（client/dist） | Vercel 静的配信 | Workers 静的アセット（SPA フォールバック） |
| API（/api/*） | `server/api/index.ts` | `server/worker/index.ts`（`cloudflare:node` の `httpServerHandler` で Express を実行） |
| DB 接続 | `pg` Pool（プロセス共有） | Hyperdrive 経由の `pg` Pool をリクエストごとに作成 |
| 定期実行 | `vercel.json` の crons（GET） | Cron Triggers → 内部 API を各ルートのメソッドで呼び出し |
| エラー監視 | `@sentry/node` | `@sentry/cloudflare`（`withSentry`） |
| デプロイ | Vercel Git 連携 | `.github/workflows/cloudflare-deploy.yml`（main → 本番, preview → ステージング） |

設定は `wrangler.jsonc`、定期ジョブ一覧は `server/src/config/cloudflare-cron-jobs.ts`。

## 手作業でやること

### 1. Cloudflare アカウント

1. Workers **Paid** プラン（月 $5〜）にする。無料プランは CPU 時間が 10ms しかなく、このアプリは動かない（`limits.cpu_ms` を 5 分に設定している）。
2. アカウント ID を控える（ダッシュボード右側の Account ID）。

### 2. Hyperdrive（Neon への接続）

Neon の **直接接続（pooler ではない）URL** で、本番用とステージング用を 1 つずつ作る。

```bash
npx wrangler login
npx wrangler hyperdrive create deadstocksolution-prod    --caching-disabled --connection-string="<本番 Neon の直接接続 URL>"
npx wrangler hyperdrive create deadstocksolution-preview --caching-disabled --connection-string="<preview ブランチの直接接続 URL>"
```

`--caching-disabled` は必須。Hyperdrive の既定のクエリキャッシュは読み取り結果を最大 60 秒保持し、書き込みで無効化されないため、
パスワード変更やアカウント停止の直後でも古い認証状態や在庫が返ってしまう。作成済みなら
`npx wrangler hyperdrive update <ID> --caching-disabled` で無効にする。

表示された ID を次の手順の GitHub 変数に入れる（`wrangler.jsonc` のプレースホルダはデプロイ時に置き換わる）。

### 3. GitHub の設定（Settings → Secrets and variables → Actions）

| 種類 | 名前 | 値 |
|------|------|----|
| Secret | `CLOUDFLARE_API_TOKEN` | API トークン（テンプレート「Edit Cloudflare Workers」） |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | 手順 1 のアカウント ID |
| Variable | `CLOUDFLARE_HYPERDRIVE_ID_PRODUCTION` | 手順 2 の本番 ID |
| Variable | `CLOUDFLARE_HYPERDRIVE_ID_PREVIEW` | 手順 2 のステージング ID |
| Variable | `PREVIEW_SMOKE_BASE_URL` | `https://deadstocksolution-preview.<サブドメイン>.workers.dev` |
| Secret（任意） | `PRODUCTION_DATABASE_URL` / `PREVIEW_DATABASE_URL` | デプロイ時のアカウントシード用の直接接続 URL |
| Secret（任意） | `TEST_PHARMACY_SEED_JSON` | 旧 Vercel と同じ値 |

不要になる設定: `VERCEL_TOKEN`, `VERCEL_AUTOMATION_BYPASS_SECRET`（移行完了後に削除）。

### 4. Worker のシークレット

Vercel の環境変数を Worker に移す。本番とステージングでそれぞれ実行する。

```bash
# Vercel から取得
vercel env pull .env.cf-production --environment=production
# POSTGRES_*（Hyperdrive が代わりに提供）と VERCEL_* は除外して登録
grep -vE '^(POSTGRES_|VERCEL_|NODE_ENV=)' .env.cf-production > .env.cf-production.filtered
npx wrangler secret bulk .env.cf-production.filtered --env ""
# ステージングは --environment=preview / --env preview で同様に
rm .env.cf-production .env.cf-production.filtered
```

追加・変更が必要な値:

| 名前 | 値 |
|------|----|
| `PUBLIC_HOST` | 公開ホスト名（例 `app.example.jp`）。旧 `VERCEL_URL` の代わり |
| `CORS_ORIGINS` | 新しいドメインの origin |
| `WORKOS_REDIRECT_URI` | 新しいドメインのコールバック URL |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 必須。未設定だとレート制限が isolate ごとのメモリになり実質効かない |

`DEPLOY_ENV`（旧 `VERCEL_ENV`）と `NODE_ENV` は `wrangler.jsonc` の `vars` で設定済み。
`REDIS_URL` / `REALTIME_REDIS_URL`（TCP 接続の Redis）は Workers 上で未検証のため設定しない。

### 5. 初回デプロイと確認

1. `preview` ブランチへ push → `Cloudflare Deploy` → `Preview Smoke` が走る。
2. `https://deadstocksolution-preview.<サブドメイン>.workers.dev/api/health` が `db.status: ok` を返すことを確認。
3. ログイン、在庫アップロード（プレビュー → 確定）、1 分以内に確定ジョブが完了することを確認。
4. `main` へマージ → 本番 Worker がデプロイされる。

### 6. ドメインの切り替え

1. ドメインの DNS を Cloudflare に移す（ネームサーバー変更）。
2. Workers & Pages → `deadstocksolution` → Settings → Domains & Routes → Custom domain を追加。
3. 外部サービスの URL を新ドメインに更新: Stripe Webhook、WorkOS リダイレクト、OpenClaw Webhook、`DRUG_PACKAGE_SOURCE_URL` などの許可設定。
4. **Vercel プロジェクトを停止する**。Vercel の Cron と Cloudflare の Cron Triggers が両方動くと、定期ジョブが二重に実行される。
5. 安定したら `vercel.json`、`server/vercel.json`、`server/api/index.ts`、`scripts/vercel-*.sh` を削除する。

## Workers 上での制約

| 項目 | 内容 | 対応 |
|------|------|------|
| メモリ 128MB | 50MB 近い Excel や大きな医薬品マスターファイルは解析中に上限を超える可能性がある | ステージングで実ファイルを試し、必要ならアップロード上限を下げる |
| TCP 接続の共有不可 | リクエストをまたいで DB 接続を使えない | リクエストごとに Pool を作成。prepared statement のキャッシュは Workers では無効化 |
| グローバルスコープの I/O・タイマー禁止 | モジュール評価時の `setInterval` などが例外になる | `server/worker/bootstrap-env.ts` で評価中のタイマーを無効化。起動時 ALTER TABLE は初回リクエストで実行 |
| 自動圧縮 | Workers が Content-Encoding を見て圧縮するため Express 側で圧縮すると二重になる | Workers 上では `compression` を無効化 |
| DNS | OS のリゾルバがない | 外部取得 URL の検証は DNS over HTTPS（cloudflare-dns.com）で解決 |
| `worker_threads` / `child_process` | 使えない | 解析はインライン実行にフォールバック（既存挙動）。OpenClaw CLI 連携は Vercel 同様に使えない |
| レスポンス後の処理 | `void` で投げた非同期処理はレスポンス後に打ち切られることがある | 重要な処理は Cron（アップロード確定ジョブ等）で再実行される |

## ローカルで Workers 版を動かす

```bash
cat > .dev.vars <<'EOF'
JWT_SECRET=local-dev-jwt-secret-0123456789abcdef0123456789
CORS_ORIGINS=http://localhost:8787
CRON_SECRET=local-cron-secret
EOF
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://postgres:postgres@localhost:5432/postgres
npm run dev:worker
# Cron の手動実行
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"
```
