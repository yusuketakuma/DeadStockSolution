# Codex Setup（Repo-scoped）

## 共有されるもの（コミット対象）
- AGENTS.md（運用契約）
- .codex/config.toml（プロジェクト設定）
- .codex/agents/*.toml（役割別）
- .codex/rules/default.rules（Smart approvals最適化）
- tasks/todo.md / tasks/lessons.md（計画と学習）
- .agents/skills/*（任意）

## ユーザー側（~/.codex）に残すもの（最小）
- 認証（keyring/keychain 推奨）
- このリポジトリを trusted にする設定

## なぜ trusted が必要か
- .codex/config.toml は trusted なプロジェクトでのみ読み込まれる。

## 使い方（基本）
- 対話:
  - `codex`
  - 非自明なら `/plan` で plan mode に入ってから進める
- 非対話:
  - `codex exec "<指示>"` でもよいが、未完了終了禁止のため tasks/todo.md を必ず更新する
