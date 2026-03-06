# 統合ログセンター + OpenClaw双方向統合 設計書

**日付**: 2026-03-02
**ステータス**: 承認済み
**アプローチ**: A — 統合ログセンター + OpenClaw Command API

## 概要

管理者画面からシステム全体のログを一括管理する統合ログセンターを構築する。
既存の `AdminLogsPage`（操作ログ）と `AdminSystemEventsPage`（システムイベント）を
1つの統合ダッシュボードに統合し、統一エラーコードレジストリを導入する。
OpenClaw連携を拡張し、ログの自動送信とリモートコマンド受信を実現する。

## 要件

1. **統合ログセンター**: 既存2ページを統合した統一ダッシュボード
2. **統一エラーコードレジストリ**: 散在するエラーコードを一元管理
3. **OpenClawログ自動送信**: error/warningログを自動的にOpenClawへ送信
4. **OpenClawコマンド受信**: ホワイトリスト方式でリモート操作を安全に実行
5. **監査ログ**: 全コマンド実行の記録

## ベストプラクティス（参考）

- [Better Stack: Logging Best Practices](https://betterstack.com/community/guides/logging/logging-best-practices/)
- [StrongDM: Log Management Best Practices](https://www.strongdm.com/blog/log-management-best-practices)
- 構造化ログ（JSON）、相関ID、ログレベル体系、バッチ送信、リテンションポリシー

---

## 1. 統一エラーコードレジストリ

### データベーススキーマ

```sql
CREATE TABLE error_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,       -- e.g. "UPLOAD_PARSE_FAILED"
  category VARCHAR(32) NOT NULL,          -- "upload" | "auth" | "sync" | "system" | "openclaw"
  severity VARCHAR(16) NOT NULL,          -- "critical" | "error" | "warning" | "info"
  title_ja VARCHAR(128) NOT NULL,         -- "ファイル解析エラー"
  description_ja TEXT,                    -- 詳細説明
  resolution_ja TEXT,                     -- 推奨対処法
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 既存テーブルへのリンク

`activity_logs` と `system_events` に `error_code` カラム（nullable VARCHAR(64)）を追加。

### 初期エラーコード

| コード | カテゴリ | 重要度 | 説明 |
|--------|---------|--------|------|
| UPLOAD_PARSE_FAILED | upload | error | ファイル解析エラー |
| UPLOAD_EMPTY_FILE | upload | warning | 空ファイル |
| UPLOAD_EMPTY_ROWS | upload | warning | 有効行なし |
| UPLOAD_INVALID_MAPPING | upload | error | カラムマッピング不正 |
| UPLOAD_FILE_TOO_LARGE | upload | error | ファイルサイズ超過 |
| UPLOAD_MULTER_ERROR | upload | error | アップロード処理エラー |
| SYNC_MASTER_FAILED | sync | error | 薬価マスター同期失敗 |
| AUTH_LOGIN_FAILED | auth | warning | ログイン失敗 |
| AUTH_TOKEN_EXPIRED | auth | info | トークン期限切れ |
| SYSTEM_INTERNAL_ERROR | system | critical | 内部エラー |
| SYSTEM_UNHANDLED_REJECTION | system | error | 未処理Promise拒否 |
| SYSTEM_UNCAUGHT_EXCEPTION | system | critical | 未捕捉例外 |
| OPENCLAW_HANDOFF_FAILED | openclaw | error | ハンドオフ失敗 |
| OPENCLAW_COMMAND_REJECTED | openclaw | warning | コマンド拒否 |

---

## 2. 統合ログセンター UI

### ページ構造

`AdminLogCenterPage.tsx` — 既存2ページを統合

```
┌─────────────────────────────────────────────────┐
│ 📊 ログセンター                                   │
├─────────────────────────────────────────────────┤
│ [サマリーカード] 全件 | エラー | 警告 | 今日       │
├─────────────────────────────────────────────────┤
│ [タブ] 全て | 操作ログ | システム | 同期 | OpenClaw │
├─────────────────────────────────────────────────┤
│ [フィルター] 期間 | レベル | カテゴリ | エラーコード │
│             | キーワード検索                       │
├─────────────────────────────────────────────────┤
│ [ログテーブル] 統一表示                            │
│  日時 | レベル | カテゴリ | エラーコード |           │
│  メッセージ | ソース | 詳細展開                     │
├─────────────────────────────────────────────────┤
│ [エラーコード管理] コード一覧・追加・編集           │
├─────────────────────────────────────────────────┤
│ [OpenClawコマンド履歴] 受信コマンドと実行結果       │
└─────────────────────────────────────────────────┘
```

### 機能
- 3テーブル横断の統一ログビュー（時系列ソート）
- タブによるソース別フィルタリング
- エラーコード管理（CRUD）
- OpenClawコマンド実行履歴表示
- CSV/JSONエクスポート

### ルーティング変更
- `/admin/logs` → `/admin/log-center` にリダイレクト
- `/admin/system-events` → `/admin/log-center?tab=system` にリダイレクト

---

## 3. OpenClawログ自動送信

### フロー

```
ログ記録 (logActivity / recordSystemEvent)
    ↓
レベル判定: error / warning / critical ?
    ↓ YES
OpenClaw送信キューに追加
    ↓
バッチ送信
  - critical: 即時送信
  - error: 30秒バッファ（同一errorCode重複排除）
  - warning: 5分バッファ（集約して送信）
    ↓
POST to OpenClaw Gateway API
  endpoint: /v1/chat/completions
  auth: Bearer token (OPENCLAW_API_KEY)
```

### 送信データ形式

```json
{
  "type": "log_alert",
  "severity": "error",
  "logs": [
    {
      "id": 123,
      "source": "system_events",
      "errorCode": "SYSTEM_INTERNAL_ERROR",
      "message": "Unhandled error in /api/upload",
      "detail": { "stack": "..." },
      "occurredAt": "2026-03-02T10:30:00Z"
    }
  ],
  "systemContext": {
    "activePharmacies": 45,
    "pendingJobs": 3,
    "recentErrorRate": 0.02
  }
}
```

### サービス: `openclaw-log-push-service.ts`

- メモリ内バッファ（Map<severity, LogEntry[]>）
- タイマーベースのフラッシュ
- 送信失敗時: 3回リトライ + exponential backoff
- 環境変数で有効/無効切替

---

## 4. OpenClawコマンド受信

### エンドポイント

`POST /api/openclaw/commands`

### 認証

既存のWebhook認証（HMAC-SHA256署名検証）を再利用:
- `x-openclaw-signature` ヘッダー
- `x-openclaw-timestamp` ヘッダー
- タイムスタンプ鮮度チェック（5分以内）
- リプレイ攻撃検出

### コマンドスキーマ

```json
{
  "command": "scheduler.restart",
  "parameters": { "target": "drug_master" },
  "threadId": "thread_abc123",
  "reason": "Error rate exceeded threshold"
}
```

### ホワイトリスト管理

```sql
CREATE TABLE openclaw_command_whitelist (
  id SERIAL PRIMARY KEY,
  command_name VARCHAR(64) UNIQUE NOT NULL,
  category VARCHAR(16) NOT NULL,       -- "read" | "write" | "admin"
  description_ja VARCHAR(255),
  is_enabled BOOLEAN DEFAULT TRUE,
  parameters_schema JSONB,             -- JSONスキーマでパラメータ検証
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 初期ホワイトリスト

| コマンド | カテゴリ | 説明 |
|---------|---------|------|
| system.status | read | システムステータス取得 |
| logs.query | read | ログ検索 |
| stats.summary | read | 統計サマリー取得 |
| scheduler.restart | write | スケジューラー再起動 |
| cache.clear | write | キャッシュクリア |
| maintenance.enable | admin | メンテナンスモード有効化 |
| maintenance.disable | admin | メンテナンスモード無効化 |
| pharmacy.toggle | admin | 薬局の有効/無効切替 |
| job.cancel | write | ジョブキャンセル |
| drug_master.sync | write | 薬価マスター同期実行 |
| notification.send | write | 通知送信 |

### コマンド実行履歴

```sql
CREATE TABLE openclaw_commands (
  id SERIAL PRIMARY KEY,
  command_name VARCHAR(64) NOT NULL,
  parameters JSONB,
  status VARCHAR(16) NOT NULL,          -- "received" | "executing" | "completed" | "failed" | "rejected"
  result JSONB,
  error_message TEXT,
  openclaw_thread_id VARCHAR(255),
  signature VARCHAR(255) NOT NULL,
  received_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

### 実行フロー

```
POST /api/openclaw/commands
    ↓
1. HMAC署名検証
2. タイムスタンプ鮮度チェック
3. リプレイ攻撃検出
    ↓
4. コマンド名をホワイトリスト照合
    ↓ 拒否 → 403 + 監査ログ
5. パラメータをJSONスキーマで検証
    ↓ 不正 → 400 + 監査ログ
6. CommandExecutor でコマンド実行
7. 結果を openclaw_commands に記録
8. レスポンス返却
```

---

## 5. バックエンド API 一覧

### 新規エンドポイント

| Method | Endpoint | 認証 | 説明 |
|--------|----------|------|------|
| GET | /api/admin/log-center | Admin | 統合ログ検索 |
| GET | /api/admin/log-center/summary | Admin | サマリー統計 |
| GET | /api/admin/error-codes | Admin | エラーコード一覧 |
| POST | /api/admin/error-codes | Admin | エラーコード追加 |
| PUT | /api/admin/error-codes/:id | Admin | エラーコード編集 |
| GET | /api/admin/openclaw/commands | Admin | コマンド実行履歴 |
| GET | /api/admin/openclaw/whitelist | Admin | ホワイトリスト一覧 |
| PUT | /api/admin/openclaw/whitelist/:id | Admin | ホワイトリスト有効/無効切替 |
| POST | /api/openclaw/commands | HMAC | コマンド受信 |

### 新規サービス

1. `log-center-service.ts` — 3テーブル横断クエリ、統計集計
2. `error-code-service.ts` — エラーコードCRUD、コード解決
3. `openclaw-log-push-service.ts` — ログ自動送信（バッチ、重複排除）
4. `openclaw-command-service.ts` — コマンド受信・検証・実行

---

## 6. セキュリティ

### コマンド実行のセキュリティ

- **ホワイトリスト方式**: 未登録コマンドは自動拒否
- **パラメータ検証**: JSONスキーマによる入力値検証
- **HMAC署名**: 既存のWebhook認証基盤を再利用
- **リプレイ攻撃防止**: タイムスタンプ + 署名キャッシュ
- **監査ログ**: 全コマンド（成功・失敗・拒否）を記録
- **カテゴリ分離**: read/write/admin の権限レベル

### ログ送信のセキュリティ

- **Bearer token認証**: OPENCLAW_API_KEY使用
- **データマスキング**: 機密情報（パスワード、トークン）のフィルタリング
- **送信制限**: レート制限（1分あたり最大60件）

---

## 7. テスト戦略

| 対象 | テスト種別 | 重点項目 |
|------|-----------|---------|
| error-code-service | ユニット | CRUD、一意制約、カテゴリ検証 |
| log-center-service | ユニット | 横断クエリ、ページネーション、フィルター |
| openclaw-log-push-service | ユニット | バッチング、重複排除、リトライ |
| openclaw-command-service | ユニット | ホワイトリスト検証、パラメータ検証 |
| /api/openclaw/commands | 統合 | 署名検証、不正コマンド拒否、正常実行 |
| AdminLogCenterPage | E2E | タブ切替、フィルター、エラーコード管理 |

---

## 8. 環境変数（追加分）

```bash
# ログ自動送信
OPENCLAW_LOG_PUSH_ENABLED=true
OPENCLAW_LOG_PUSH_CRITICAL_IMMEDIATE=true
OPENCLAW_LOG_PUSH_ERROR_BUFFER_MS=30000
OPENCLAW_LOG_PUSH_WARNING_BUFFER_MS=300000
OPENCLAW_LOG_PUSH_RATE_LIMIT_PER_MIN=60

# コマンド受信
OPENCLAW_COMMANDS_ENABLED=true
```

---

## ファイル一覧（新規・変更）

### 新規ファイル
- `server/src/services/log-center-service.ts`
- `server/src/services/error-code-service.ts`
- `server/src/services/openclaw-log-push-service.ts`
- `server/src/services/openclaw-command-service.ts`
- `server/src/routes/admin-log-center.ts`
- `server/src/routes/admin-error-codes.ts`
- `server/src/routes/openclaw-commands.ts`
- `client/src/pages/admin/AdminLogCenterPage.tsx`
- `server/drizzle/XXXX_log_center_*.sql` (マイグレーション)

### 変更ファイル
- `server/src/db/schema.ts` — 新テーブル追加 + 既存テーブルにerror_codeカラム
- `server/src/app.ts` — 新ルート登録
- `server/src/services/log-service.ts` — error_code対応 + 自動送信フック
- `server/src/services/system-event-service.ts` — error_code対応 + 自動送信フック
- `client/src/App.tsx` — ルーティング変更
- `client/src/components/Layout.tsx` — サイドバーメニュー変更

### 削除候補
- `client/src/pages/admin/AdminLogsPage.tsx` — LogCenterに統合（リダイレクトに変更）
- `client/src/pages/admin/AdminSystemEventsPage.tsx` — LogCenterに統合（リダイレクトに変更）
