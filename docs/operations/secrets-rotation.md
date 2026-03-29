# Secrets Rotation Runbook

## 対象

- `JWT_SECRET`
- `CRON_SECRET`
- `MATCHING_REFRESH_CRON_SECRET`
- `PROPOSAL_EXPIRY_CRON_SECRET`
- `OPENCLAW_RETRIES_CRON_SECRET`
- `DEAD_STOCK_ARCHIVE_CRON_SECRET`
- `DAILY_STATISTICS_CRON_SECRET`
- `UPLOAD_JOBS_CRON_SECRET`
- `MONTHLY_REPORT_CRON_SECRET`
- `PREDICTIVE_ALERTS_CRON_SECRET`
- Stripe の秘密情報
  - `STRIPE_SECRET_KEY`
  - `STRIPE_SECRET_KEY_LIVE`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_PRICE_ID_LIGHT`
  - `STRIPE_PRICE_ID_LIGHT_LIVE`
  - `STRIPE_PRICE_ID_STANDARD`
  - `STRIPE_PRICE_ID_STANDARD_LIVE`
  - `STRIPE_PRICE_ID_ENTERPRISE`
  - `STRIPE_PRICE_ID_ENTERPRISE_LIVE`

## 前提

1. 反映先の環境を特定する。
2. 旧値を安全な保管先に退避する。
3. 反映後に deployment を再起動できる状態にしておく。

新しいランダム値の例:

```bash
openssl rand -base64 48
```

## JWT_SECRET の更新

1. 新しい `JWT_SECRET` を生成する。
2. 対象環境の secret store / `.env` を更新する。
3. server を再起動、または deployment を再作成する。
4. `/api/health` が正常応答することを確認する。
5. 管理者・一般ユーザーの両方で再ログインできることを確認する。

注意:

- `JWT_SECRET` を更新すると既存セッションは無効化される。
- 切り替え直後は「全ユーザー再ログイン」が起きる前提で告知する。

## Cron secret の更新

基本方針:

- 共通 secret を使うルートは `CRON_SECRET` を更新する。
- ジョブ別 secret を分けている場合は、対応する個別 secret も同時に更新する。

手順:

1. 新しい `CRON_SECRET` と必要な個別 secret を生成する。
2. 対象環境の以下を更新する。
   - `CRON_SECRET`
   - `MATCHING_REFRESH_CRON_SECRET`
   - `PROPOSAL_EXPIRY_CRON_SECRET`
   - `OPENCLAW_RETRIES_CRON_SECRET`
   - `DEAD_STOCK_ARCHIVE_CRON_SECRET`
   - `DAILY_STATISTICS_CRON_SECRET`
   - `UPLOAD_JOBS_CRON_SECRET`
   - `MONTHLY_REPORT_CRON_SECRET`
   - `PREDICTIVE_ALERTS_CRON_SECRET`
3. deployment を再起動する。
4. 内部 cron route を 1 本ずつ手動で叩き、`401/403` にならないことを確認する。
5. サーバーログで開始 / 完了の structured log が出ることを確認する。

確認例:

```bash
curl -i \
  -X POST \
  -H "Authorization: Bearer ${DAILY_STATISTICS_CRON_SECRET:-$CRON_SECRET}" \
  http://127.0.0.1:3001/api/internal/daily-statistics/aggregate

curl -i \
  -X POST \
  -H "Authorization: Bearer ${PROPOSAL_EXPIRY_CRON_SECRET:-$CRON_SECRET}" \
  http://127.0.0.1:3001/api/internal/proposal-expiry/run

curl -i \
  -X POST \
  -H "Authorization: Bearer ${OPENCLAW_RETRIES_CRON_SECRET:-$CRON_SECRET}" \
  http://127.0.0.1:3001/api/internal/openclaw-retries/run
```

## Stripe 秘密情報の更新

`STRIPE_LIVE_MODE=true` の環境では live 用の key / price ID を使う。test 環境では test 用の key / price ID を使う。

更新順:

1. Stripe Dashboard で新しい API key または webhook secret を発行する。
2. 対象環境の secret store を更新する。
   - test 環境:
     - `STRIPE_SECRET_KEY`
     - `STRIPE_WEBHOOK_SECRET`
     - `STRIPE_PRICE_ID_LIGHT`
     - `STRIPE_PRICE_ID_STANDARD`
     - `STRIPE_PRICE_ID_ENTERPRISE`
   - live 環境:
     - `STRIPE_SECRET_KEY_LIVE`
     - `STRIPE_WEBHOOK_SECRET`
     - `STRIPE_PRICE_ID_LIGHT_LIVE`
     - `STRIPE_PRICE_ID_STANDARD_LIVE`
     - `STRIPE_PRICE_ID_ENTERPRISE_LIVE`
3. deployment を再起動する。
4. `GET /api/subscriptions/plans` で `stripeConfigured: true` を確認する。
5. Checkout Session 作成と webhook 受信をそれぞれ 1 回ずつ検証する。

確認観点:

- Checkout Session が生成できる
- Webhook 署名エラーが出ない
- price ID の取り違えで別プランが選ばれない

## ロールバック

1. 退避しておいた旧 secret に戻す。
2. deployment を再起動する。
3. 影響が `JWT_SECRET` のみなら全ユーザー再ログインを再度案内する。
4. Stripe の key を戻した場合は webhook の再送結果も確認する。

## 変更後チェックリスト

1. `/api/health` が正常
2. ログイン / 再ログインが正常
3. cron route が認証エラーなしで動作
4. Stripe checkout / webhook が正常
5. 監視に 401 / 403 / webhook signature error が増えていない
