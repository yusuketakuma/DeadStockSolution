# Execpolicy Rules

このリポジトリはデフォルトで `sandbox_mode = danger-full-access` + `approval_policy = never`。
つまり、Codex は **止まらずにコマンドを実行**できる。

だから最低限の "禁止" を rules で入れる（安全弁）。
Rules は `.codex/rules/*.rules` に置く。

- ルール形式は Starlark、`prefix_rule()` を使う  [oai_citation:11‡OpenAI Developers](https://developers.openai.com/codex/rules)
- ルールのテストは `codex execpolicy check` でできる  [oai_citation:12‡OpenAI Developers](https://developers.openai.com/codex/rules)
