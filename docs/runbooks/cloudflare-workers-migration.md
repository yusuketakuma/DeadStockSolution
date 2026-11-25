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
| Variable | `PREVIEW_SMOKE_BASE_URL` | `https://deadstocksolution-preview.<サブドメイン>.workers.dev`（必須。旧 `PREVIEW_BRANCH_SMOKE_BASE_URL` は使わない） |
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
4. **`main` へマージする直前に、Vercel の Cron だけを止める**（Vercel のプロジェクト → サイドバーの Schedules → Cron Jobs → Disable Cron Jobs）。
   マージすると本番 Worker がデプロイされて Cloudflare の Cron Triggers が動き始めるため、止めないと定期ジョブが二重に実行される。
   どちらも同じ Neon DB を使うので、画面と API はドメイン切替まで Vercel のままでよい。プロジェクト自体はまだ止めない。
5. `main` へマージ → 本番 Worker がデプロイされる。`https://deadstocksolution.<サブドメイン>.workers.dev/api/health` を確認する。
6. Cron が Cloudflare 側で動いていることを確認する。Workers & Pages → `deadstocksolution` → Settings → Trigger Events（Cron Events のログ）で、
   毎分の `* * * * *` と 5 分・10 分ごとのジョブが「成功」になっていること、`wrangler tail` に `Cron job completed` が出ることを見る。
   Cron Events は内部 API の HTTP 応答だけを見るため、医薬品マスター同期のように処理失敗をログに残して 200 を返すジョブもある。
   管理画面の医薬品マスター管理 → 同期ログで、翌朝（JST 4:00 の同期後）に自動取得が「完了」になっていることも確認する。
   30 分たっても成功が記録されない、または失敗が続く場合は切り戻す。
   先に Cloudflare 側の Cron を止める（Workers & Pages → `deadstocksolution` → Settings → Trigger Events で Cron Triggers をすべて削除）。
   そのあとで Vercel の Cron Jobs を Enable に戻す。片方だけだと、成功しているジョブが両方の環境で二重に動く。
   画面と API はまだ Vercel なので、これで元の状態に戻る。Cron Triggers は次回のデプロイで `wrangler.jsonc` から再登録されるため、
   原因を直すまで `main` へのデプロイは控える。
7. `preview` ブランチの必須チェックを更新する（Settings → Branches）。スモークは `Cloudflare Deploy` から呼ばれるため、
   チェック名は `preview-smoke / smoke` になる。旧 Vercel 用の `Preview Smoke` のチェック名が残っていれば外す。

### 6. ドメインの切り替え

1. ドメインの DNS を Cloudflare に移す（ネームサーバー変更）。
2. Workers & Pages → `deadstocksolution` → Settings → Domains & Routes → Custom domain を追加。
3. 外部サービスの URL を新ドメインに更新: Stripe Webhook、WorkOS リダイレクト、OpenClaw Webhook、`DRUG_PACKAGE_SOURCE_URL` などの許可設定。
4. 新ドメインで問題がなければ Vercel プロジェクトを停止する（Cron は手順 5-4 で停止済み）。
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
| 長時間の手動同期 | 管理画面のマスター更新は応答後に続けると打ち切られる | Workers では同期の完了まで応答を返さない（画面側は最大 10 分待つ） |
| リアルタイム配信（SSE） | Redis がないと別の isolate で起きた更新が届かない | Workers で `REALTIME_REDIS_URL` 未設定なら `/api/realtime/stream` は 503 を返し、画面は定期ポーリングで更新する |
| Cron の失敗 | 内部 API のエラーをログだけにすると実行結果が成功に見える | 失敗したジョブがあれば scheduled ハンドラが例外を投げ、Cron Events に失敗として残る |

## 手元からデプロイする

GitHub Actions を使わずにデプロイする場合は、対象環境の Hyperdrive ID を渡す（未指定や形式違いなら停止する）。

```bash
CLOUDFLARE_HYPERDRIVE_ID_PREVIEW=<ID> npm run deploy:preview      # preview ブランチで
CLOUDFLARE_HYPERDRIVE_ID_PRODUCTION=<ID> npm run deploy:prod      # main ブランチで
```

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
