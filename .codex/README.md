# .codex/README.md

このリポジトリは Codex CLI の project-scoped config を使う。

## どこに何を置くか
- .codex/config.toml: プロジェクト設定（共有）
- .codex/agents/*.toml: マルチエージェント役割
- codex/rules/*.rules: フルアクセス運用の最低限ガードレール（共有）
- AGENTS.md: リポジトリ規律（共有）
- tasks/*.md: Plan/学習ログ（共有）

## 設定の優先順位
Codex は project-scoped `.codex/config.toml` を user config より優先して読む（ただしプロジェクトが trusted の時だけ）。

## Web search
フルアクセス時は live がデフォルトだが、`.codex/config.toml` で `web_search="live"` を明示している。

## apps
apps は無効。過去の codex_apps 起動失敗や403系を踏まない設計。
必要になった時だけ features.apps を true にして別途チューニングする。

## 注意
approval_policy=never + danger-full-access は"止まらない"代わりに事故が致命傷になる。
codex/rules/default.rules で禁じ手を封じる。
