# Codex Setup (repo-scoped)

## 目的
- 設定・エージェント定義を **リポジトリ側** に集約する
- ユーザー側 `~/.codex` は最小（trust設定のみ）にする

## 必須
1) repo ルートに `.codex/` と `AGENTS.md` を置く
2) プロジェクトを trusted にする（trusted でないと `.codex/` が読み込まれない）

### trust の最小例（ユーザー側）
`~/.codex/config.toml` に以下を追加（パスは自分の環境に合わせる）:

```toml
[projects."/ABSOLUTE/PATH/TO/careviax-pharmacy"]
trust_level = "trusted"
```

## 起動

- repo ルートで `codex` を起動する（相対パス設定が安定）

## 注意

- この設定は `approval_policy = "never"` かつ `sandbox_mode = "danger-full-access"`。
  “速い”が、事故ったら致命的。運用で縛りたいなら workspace-write へ戻すこと。

