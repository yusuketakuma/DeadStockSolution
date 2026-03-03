# Repository Codex Configuration

このリポジトリは `.codex/` に **Codex CLI 用の共通設定** を置き、チームで共有する運用を前提にしています。

## 重要（まず読む）
- 司令塔は `danger-full-access` + `approval_policy=never` をデフォルトにしています（高リスク）。
- Apps は **デフォルトON**（`[features].apps=true` / `[apps._default].enabled=true`）です。
- マルチエージェントは **ON**、同時スレッド上限は **32**、ネスト深さは **2**です。

詳しい運用は `AGENTS.md` と `docs/` を参照。

## 主要ファイル
- `.codex/config.toml` : リポジトリ共通設定（コミット対象）
- `.codex/agents/*.toml` : 役割別プロンプト（コミット対象）
- `docs/local-user-config.example.toml` : 各自の `~/.codex/config.toml` の例（信頼設定など）

## まず最初にやること（各ユーザー）
1. `~/.codex/config.toml` を作る（例は docs を参照）
2. プロジェクトを信頼する（`/permissions` か `[projects]` で trusted）
3. `codex` を起動し `/debug-config` で設定が読み込まれているか確認
4. `/apps` で Apps が見えるか確認
