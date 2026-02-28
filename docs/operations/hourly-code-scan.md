# Hourly Code Scan (preview)

## 目的

`preview` ブランチを1時間ごとに自動スキャンし、
安全に自動修正できる内容（主に lint 自動修正）をコミットして継続的に健全性を維持する。

## 実行コマンド

```bash
npm run quality:gate
```

内部で次を実行する。

1. `git fetch / checkout / pull --ff-only`
2. `npm ci`
3. `npm run lint:fix`
4. `npm run typecheck`
5. `npm run test`
6. 差分がある場合のみコミット & push

失敗時に手修正を入れて再検証する場合は、以下で再実行する。

```bash
QUALITY_GATE_ALLOW_DIRTY=1 QUALITY_GATE_SKIP_SYNC=1 QUALITY_GATE_SKIP_INSTALL=1 npm run quality:gate
```

## 報告フォーマット（提案）

毎回この順で報告する。

1. 変更点
2. 実行内容（実行コマンド）
3. テスト結果
4. 課題
5. 次アクション
6. コミットID

※ 報告は必ず1つの吹き出し（単一メッセージ）にまとめる。分割送信は禁止。

※ 失敗時に再検証した場合は、`QUALITY_GATE_ALLOW_DIRTY=1 ... npm run quality:gate` の実行有無と回数も `実行内容` に必ず記載する。

### テンプレート

```text
変更点:
- ...

実行内容:
- npm run quality:gate（実行回数: 1回）
- 実行コマンド（要約）:
  - git fetch origin preview && git checkout preview && git pull --ff-only origin preview
  - npm ci --no-audit --no-fund
  - npm run lint:fix
  - npm run typecheck
  - npm run test

テスト結果:
- lint:fix: pass/fail
- typecheck: pass/fail
- test: pass/fail

課題:
- ...（なければ「なし」）

次アクション:
- ...（なければ「次回1時間後に再実行」）

コミットID:
- <short_sha>（変更なしの場合は「なし」）
```

## 運用ガードレール

- 作業ツリーが汚れている場合は停止（混在コミット防止）
- テスト未通過の状態では自動コミットしない
- コミットは必ず `preview` に対して実施
- コミットメッセージは機械処理しやすい prefix を使う
  - `chore(auto-scan): ...`

## 参考（インターネット）

- GitHub Docs: Protected branches（必須チェック・レビューで品質担保）
  - https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub Docs: Workflow concurrency（同時実行衝突の防止）
  - https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- ESLint CLI: `--fix` / `--fix-type`（安全な自動修正範囲の限定）
  - https://eslint.org/docs/latest/use/command-line-interface
- Semgrep Autofix（ルールベース自動修正は決定的で再現性が高い）
  - https://semgrep.dev/docs/writing-rules/autofix
- pre-commit（レビュー前に軽微不具合を早期検出）
  - https://pre-commit.com/
