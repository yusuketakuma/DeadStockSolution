# Repo-scoped Codex Settings（0.105.0+）

このリポジトリは `.codex/config.toml` を同梱します。
Codex は project-scoped config を **trusted** なプロジェクトでのみ読み込みます。  
（各開発者の `~/.codex/config.toml` には trust 設定だけ入れる運用が最小です）

## 重要：trust設定（各自のHOME側）
例（パスは各自の絶対パスに置換）：

```toml
# ~/.codex/config.toml（最小例）
[projects."/ABS/PATH/TO/REPO"]
trust_level = "trusted"
```

## このrepoが提供するもの
- マルチエージェント（multi_agent）をON
- Web検索（live）をON
- Apps（/apps）をON（必要時のみ MCP gateway を使用）
- 役割別エージェント設定（goal_setter / explorer / worker_heavy / worker_light / reviewer）
- 「実装→一括検証→最後にレビュー」をAGENTSで強制

## Appsが落ちる/403になる場合（過去障害対策）
- Appsは `[features].apps` で有効化されます（旧 connectors は廃止）。
- `apps_mcp_gateway` は環境依存で不安定になることがあります。
  Cloudflare系（403/HTML返却）なら `true`、JSON decode エラーなら `false` を推奨します。

それでも `codex_apps` が起動しない場合：
- 認証状態を確認：`codex login status`
- 必要なら再ログイン：`codex login`（ブラウザ） or `codex login --device-auth`
- APIキー運用へ切替も可：`printenv OPENAI_API_KEY | codex login --with-api-key`

（CLIの login サブコマンド仕様は公式参照）
