# Repo-local Codex configuration

このリポジトリは Codex CLI の **プロジェクト設定（.codex/）** を同梱します。
狙い:
- 個人の ~/.codex を極小にして、チームで同じ挙動を再現する
- multi-agent + web search を前提に、高速に「実装→検証→広範レビュー」へ到達する
- apps(connectors) は **無効化**（過去の 403/handshake エラー回避）

## Required: Codex CLI version
- 推奨: `@openai/codex@0.107.0`（2026-03-02 の CLI リリース）  [oai_citation:1‡OpenAI Developers](https://developers.openai.com/codex/changelog/)

## Trust（重要）
プロジェクトが untrusted の場合、**project-scoped .codex が読み飛ばされます**。
各開発者は `~/.codex/config.toml` 側でこの repo を trusted にしてください。  [oai_citation:2‡OpenAI Developers](https://developers.openai.com/codex/config-reference/)

`_user-config.example.toml` を参照。

## Apps is OFF
- `.codex/config.toml` で `[features].apps = false`
- これにより、過去に出ていた connectors/app 関連の 403 や `codex_apps` MCP 失敗を回避する（再現性優先）。  [oai_citation:3‡OpenAI Developers](https://developers.openai.com/codex/config-reference/)

## Multi-agent is ON
- `[features].multi_agent = true`（実験機能・OFFがデフォルト）  [oai_citation:4‡OpenAI Developers](https://developers.openai.com/codex/config-reference/)
- `agents.max_threads = 32`, `agents.max_depth = 2` に固定  [oai_citation:5‡OpenAI Developers](https://developers.openai.com/codex/config-reference/)

## Web search
- `web_search = "live"`（最新情報前提。必要に応じて "cached"/"disabled" に変更）  [oai_citation:6‡OpenAI Developers](https://developers.openai.com/codex/config-reference/)

## codex-spark fallback
spark が使えない（権限/可用性/ダウングレード）時に止まるのが最悪。
そのため spark系 role には `*_fallback` role を用意し、**gpt-5.3-codex + medium** で再実行する運用にしています。
（実装手順は AGENTS.md の "フォールバック規約" を参照）

## Rules（execpolicy）
フルアクセス + approval_policy=never は強烈に危険なので、最低限の禁止ルールを `.codex/rules/default.rules` に置きます。
Rules は `rules/` を各設定レイヤー配下でスキャンし、`prefix_rule()` で制御します。  [oai_citation:7‡OpenAI Developers](https://developers.openai.com/codex/rules)
