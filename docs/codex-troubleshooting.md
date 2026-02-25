# Troubleshooting

## apps が 403 / Cloudflare HTML / MCP decode で落ちる
Symptoms:
- 403 Forbidden (Just a moment...)
- MCP handshaking failed / error decoding response body

対策:
1) .codex/config.toml:
   - [features].apps = true
   - [features].apps_mcp_gateway = true
2) 再ログイン:
   - codex login
3) Enterprise/Workspace 制限の可能性があれば管理者に設定確認
4) 作業継続が優先なら apps を一時OFFにして回避
   - 例: `[features].apps = false`
   - 復旧条件: `codex login` 再実行後に handshake エラーが解消し、Apps機能が必要な作業に戻る時点で `apps=true` に戻す

## plan mode
- CLIでは /plan が使える。非自明タスクは必ず plan から入る。

## multi-agent
- [features].multi_agent = true が必要
- agents.max_threads で上限を管理する
