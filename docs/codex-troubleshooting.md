# Codex Troubleshooting

## 1) MCP client for `codex_apps` failed to start / 403 / decode error
- apps 機能が有効な場合、内部で apps 系 MCP が起動して失敗することがある
- 対策: `.codex/config.toml` で
  - `[features].apps = false`
  - `[features].apps_mcp_gateway = false`
  - `[features].search_tool = false`
  にして apps 系を明示的に無効化する

## 2) spark フォールバックが効かない
- 自動フォールバックは保証されない
- 対策: “運用”でフォールバックする
  - 最初に spark ロールを軽タスクで spawn（疎通）
  - 失敗したら `*_fallback` を使い続ける
  - spawn 失敗時は同じ指示を fallback に即投げ直す（確認待ち禁止）

## 3) タスクが途中で止まる
主因はこの2つ:
- “確認待ち”の手順（計画確認など）が混入している
- コンテキスト圧縮で完遂規約が落ちる

対策:
- AGENTS.md の Completion Contract（確認待ち禁止）を厳守
- `.codex/config.toml` の
  - `project_doc_max_bytes` を増やす
  - `experimental_compact_prompt_file` を設定
  で圧縮時も規約を保持

## 4) 長時間コマンドが途中で死ぬ
- `background_terminal_max_timeout` を増やす（ms）
  例: 3600000 (60分)
