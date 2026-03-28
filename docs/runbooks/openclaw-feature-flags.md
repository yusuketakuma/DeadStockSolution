# OpenClaw フィーチャーフラグ段階有効化 Runbook

## 概要

OpenClaw 統合を段階的に有効化するための手順書。
各 Phase は独立しており、前の Phase が安定してから次の Phase に進むことを推奨する。

## 前提条件

以下の環境変数が Vercel Environment Variables に設定済みであること。

| 変数名 | 用途 |
|--------|------|
| `OPENCLAW_API_KEY` | OpenClaw API 認証キー |
| `OPENCLAW_WEBHOOK_SECRET` | Webhook 署名検証用シークレット |
| `OPENCLAW_BASE_URL` | OpenClaw API のベース URL (HTTPS) |
| `OPENCLAW_CONNECTOR_MODE` | `legacy_http` または `gateway_cli` |

設定場所: Vercel Dashboard → Project → Settings → Environment Variables

---

## Phase 1: 基本ハンドオフ

コネクター設定が正しく機能し、ハンドオフが受け付けられることを確認する。

### 有効化

追加の環境変数設定は不要。`OPENCLAW_BASE_URL`、`OPENCLAW_API_KEY`、`OPENCLAW_WEBHOOK_SECRET` が設定されていれば有効になる。

`OPENCLAW_CONNECTOR_MODE` の値:
- `legacy_http` — HTTP API 経由（デフォルト）
- `gateway_cli` — CLI ゲートウェイ経由（`OPENCLAW_CLI_PATH` も必要）

```
OPENCLAW_CONNECTOR_MODE=legacy_http
OPENCLAW_BASE_URL=https://your-openclaw-instance.example.com
OPENCLAW_API_KEY=your-api-key
OPENCLAW_WEBHOOK_SECRET=your-webhook-secret
```

変更後、Vercel でプレビューブランチを再デプロイする。

### 確認手順

1. ヘルスエンドポイントでコネクター状態を確認:

   ```bash
   curl https://your-app.vercel.app/api/health/openclaw
   ```

   期待するレスポンス (HTTP 200):
   ```json
   {
     "status": "ok",
     "connector": { "configured": true, "mode": "legacy_http" },
     "webhook": { "configured": true },
     "commands": { "enabled": false },
     "logPush": { "enabled": false },
     "autoFix": { "enabled": false },
     "autoEscalate": { "enabled": false }
   }
   ```

   `connector.configured` と `webhook.configured` が両方 `true` であることを確認する。

2. ハンドオフテスト: 管理画面 `/admin/openclaw` からテスト薬局のリクエストを選択し、OpenClaw ハンドオフを実行する。
3. `handoffSuccessRate` が上昇していることを確認する。

### ロールバック

`OPENCLAW_BASE_URL`、`OPENCLAW_API_KEY`、`OPENCLAW_WEBHOOK_SECRET` を Vercel Dashboard から削除して再デプロイする。

---

## Phase 2: コマンド受信

OpenClaw からのコマンド API を有効化し、外部トリガーによる処理を受け付ける。

### 有効化

Vercel Environment Variables に追加:

```
OPENCLAW_COMMANDS_ENABLED=true
```

変更後、再デプロイする。

### 確認手順

1. ヘルスエンドポイントで `commands.enabled` が `true` になっていることを確認:

   ```bash
   curl https://your-app.vercel.app/api/health/openclaw
   ```

   期待するレスポンス:
   ```json
   {
     "commands": { "enabled": true }
   }
   ```

2. OpenClaw 側からコマンドを送信し、正常に受け付けられることを確認する。
3. サーバーログに `openclaw` 関連のエラーが出ていないことを確認する:

   ```bash
   vercel logs --follow
   ```

### ロールバック

```
OPENCLAW_COMMANDS_ENABLED=false
```

または環境変数を削除して再デプロイする（デフォルト値: `false`）。

---

## Phase 3: ログプッシュ + エラー自動修正

OpenClaw へのログプッシュと、エラー検知時の自動修正機能を有効化する。

### 有効化

Vercel Environment Variables に追加:

```
OPENCLAW_LOG_PUSH_ENABLED=true
OPENCLAW_ERROR_AUTOFIX_ENABLED=true
```

必要に応じて追加設定（オプション）:

```
OPENCLAW_LOG_CONTEXT_WINDOW_HOURS=24
OPENCLAW_LOG_CONTEXT_RECENT_FAILURE_LIMIT=20
OPENCLAW_LOG_CONTEXT_RECENT_ACTIVITY_LIMIT=20
OPENCLAW_LOG_CONTEXT_DETAIL_MAX_LENGTH=280
```

変更後、再デプロイする。

### 確認手順

1. ヘルスエンドポイントで `logPush.enabled` と `autoFix.enabled` が `true` になっていることを確認:

   ```bash
   curl https://your-app.vercel.app/api/health/openclaw
   ```

   期待するレスポンス:
   ```json
   {
     "logPush": { "enabled": true },
     "autoFix": { "enabled": true }
   }
   ```

2. エラーを意図的に発生させ、OpenClaw 側に通知が届くことを確認する。
3. `retryQueue.failed` が意図せず増加していないことを確認する。

### ロールバック

```
OPENCLAW_LOG_PUSH_ENABLED=false
OPENCLAW_ERROR_AUTOFIX_ENABLED=false
```

または環境変数を削除して再デプロイする（デフォルト値: いずれも `false`）。

---

## Phase 4: 自動エスカレーション

エラーログを OpenClaw に自動エスカレーションする機能を有効化する（本番環境推奨）。

### 有効化

```
OPENCLAW_AUTO_ESCALATE_ENABLED=true
```

### 確認手順

1. ヘルスエンドポイントで `autoEscalate.enabled` が `true` になっていることを確認する。
2. エスカレーション対象のエラーが発生した場合に、OpenClaw 側に通知が届くことを確認する。

### ロールバック

```
OPENCLAW_AUTO_ESCALATE_ENABLED=false
```

または環境変数を削除して再デプロイする（デフォルト値: `false`）。

---

## トラブルシューティング

### `connector.configured: false` になる

原因: `OPENCLAW_BASE_URL`、`OPENCLAW_API_KEY`、または `OPENCLAW_CONNECTOR_MODE` が未設定または無効。

対処:
1. `OPENCLAW_BASE_URL` が `https://` で始まる有効な URL か確認する。
2. `OPENCLAW_API_KEY` が空でないか確認する。
3. 環境変数を設定後、必ず再デプロイする。

### `webhook.configured: false` になる

原因: `OPENCLAW_WEBHOOK_SECRET` が未設定。

対処: Vercel Dashboard で `OPENCLAW_WEBHOOK_SECRET` を設定し、再デプロイする。

### `retryQueue.failed` が増加している

原因: OpenClaw への通信が断続的に失敗している。

対処:
1. `OPENCLAW_BASE_URL` の疎通確認。
2. `OPENCLAW_RETRY_MAX`（デフォルト: 2）と `OPENCLAW_RETRY_BASE_MS`（デフォルト: 400）を確認する。
3. `OPENCLAW_TIMEOUT_MS`（デフォルト: 10000ms）を増やすことを検討する。
4. 管理画面 `/admin/openclaw` の Retry Queue から pending / failed を確認し、対象リクエストの再連携を実行する。

### ヘルスエンドポイントが HTTP 503 を返す

原因: `connector.configured` または `webhook.configured` が `false`、あるいは `retryQueue.failed > 0`。

対処: 上記の確認手順に従い、各フィールドの状態を確認する。

### コマンドが受け付けられない（Phase 2）

原因: `OPENCLAW_COMMANDS_ENABLED` が `false` のまま。

対処: 環境変数を `true` に設定し、再デプロイ後にヘルスエンドポイントで `commands.enabled: true` を確認する。

---

## フラグ一覧

| 環境変数 | デフォルト | Phase | 説明 |
|---------|-----------|-------|------|
| `OPENCLAW_COMMANDS_ENABLED` | `false` | 2 | コマンド API エンドポイントの有効化 |
| `OPENCLAW_LOG_PUSH_ENABLED` | `false` | 3 | OpenClaw へのログプッシュ |
| `OPENCLAW_ERROR_AUTOFIX_ENABLED` | `false` | 3 | エラー自動修正サービスの有効化 |
| `OPENCLAW_AUTO_ESCALATE_ENABLED` | `false` | 4 | エラーログの自動エスカレーション |
