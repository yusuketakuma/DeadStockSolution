# Codex Apps（Connectors）運用

## 目的
- Codex CLI から Apps/Connectors を使って外部サービス連携（探索・自動化）を行う。
- このリポジトリ設定は **Apps をデフォルトON**。

## 有効化（リポジトリ設定）
`.codex/config.toml` にて：
- `[features].apps = true`（Apps有効） :contentReference[oaicite:5]{index=5}
- `[features].apps_mcp_gateway = true`（legacy routing 回避） :contentReference[oaicite:6]{index=6}
- `[features].search_tool = true`（Apps tool discovery を改善） :contentReference[oaicite:7]{index=7}
- `[apps._default] enabled=true`（既定でON） :contentReference[oaicite:8]{index=8}

## 重要：過去の 403 / MCP handshaking 失敗の回避
過去の “403 Forbidden / Just a moment...” や “error decoding response body” は、
legacy routing が HTML を返して JSON decode に失敗する形で発生し得る。
その回避策が **apps_mcp_gateway**（OpenAI connectors MCP gateway 経由） :contentReference[oaicite:9]{index=9}

## 使い方（CLI）
- `/apps`：利用可能な Apps/Connectors を確認 :contentReference[oaicite:10]{index=10}
- `/debug-config`：設定が有効になっているか確認 :contentReference[oaicite:11]{index=11}
- `/permissions`：trust / 権限状態の確認 :contentReference[oaicite:12]{index=12}

## open_world / destructive の既定
- open_world_hint のツール：既定で許可（open_world_enabled=true）
- destructive_hint のツール：既定で拒否（destructive_enabled=false）
  - destructive ツールは承認が必要になり得るため、non-interactive運用だと詰まりやすい :contentReference[oaicite:13]{index=13}

## app id を固定運用する場合（テンプレ）
`/apps` で app id を確認し、必要なら `.codex/config.toml` に追記：

例：
[apps.github]
enabled = true
open_world_enabled = true
destructive_enabled = false
default_tools_enabled = true
default_tools_approval_mode = "auto"

※ `approval_mode` は app/tool の承認挙動を制御するための設定（auto|prompt|approve） :contentReference[oaicite:14]{index=14}

## トラブルシュート最短チェック
1) `.codex/config.toml` 読み込み確認：`/debug-config`
2) Appsが見えるか：`/apps`
3) gateway有効か：`[features].apps_mcp_gateway=true`
4) それでも失敗する場合：
   - ChatGPTログイン状態（ローカル資格情報）
   - `cli_auth_credentials_store` を keyring にして保存先を安定化（ユーザー設定側）
