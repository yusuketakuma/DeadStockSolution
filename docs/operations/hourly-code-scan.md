# Hourly Code Scan (preview)

## 目的

`preview` ブランチを1時間ごとに自動スキャンし、以下3点に集中して改善する。

※ 補足: 定期ジョブは Codex CLI の手動実行ではなく、OpenClaw の `cron`（`sessionTarget: isolated`）からサブエージェント実行されます。

1. セキュリティ向上
2. コード可読性向上
3. システム動作速度改善

## 実行コマンド

```bash
npm run quality:gate
```

定期タスクでは `quality:gate` を基盤に、追加でセキュリティ確認を実施する。

- `npm run audit:prod`

## 定期タスクの標準フロー

1. `date '+%Y-%m-%d %H:%M:%S %Z'`（開始時刻記録）
2. `git status --porcelain`（開始前にクリーン確認）
3. `git fetch / checkout / pull --ff-only`
4. `npm run quality:gate`
5. （必要時のみ）
   `QUALITY_GATE_ALLOW_DIRTY=1 QUALITY_GATE_SKIP_SYNC=1 QUALITY_GATE_SKIP_INSTALL=1 npm run quality:gate`
6. `npm run audit:prod`
7. **レビュー（サブエージェント）**:
   - 生成差分がある場合、以下観点でレビュー:
     - セキュリティ: 認証/認可/入力検証/シークレット取り扱い
     - 可読性: 命名・責務分離・副作用の局在化
     - 速度: ループ、DBアクセス、外部API呼び出し数の増悪
   - 問題ありと判断した場合は「課題」に明記し、コミットは保留
8. `date '+%Y-%m-%d %H:%M:%S %Z'`（終了時刻記録）
9. `git status --porcelain`（終了後に差分確認）
10. 差分がある場合のみコミット & push

## 報告フォーマット（固定）

毎回この順で報告する。

1. 変更点
2. 実行日時
3. 重点テーマ結果（セキュリティ/可読性/速度）
4. 実行内容（実行コマンド）
5. テスト結果
6. 課題
7. 次アクション
8. コミットID

※ 報告は必ず1つの吹き出し（単一メッセージ）にまとめる。分割送信は禁止。
※ 実行日時は JST で開始時刻/終了時刻を記載する。

### テンプレート

```text
変更点:
- ...

実行日時:
- 開始: YYYY-MM-DD HH:mm:ss JST
- 終了: YYYY-MM-DD HH:mm:ss JST

重点テーマ結果:
- セキュリティ: ...
- 可読性: ...
- 速度: ...

実行内容:
- npm run quality:gate（実行回数: n回）
- 実行コマンド（要約）:
  - git fetch origin preview && git checkout preview && git pull --ff-only origin preview
  - npm ci --no-audit --no-fund
  - npm run lint:fix
  - npm run typecheck
  - npm run test
  - npm run audit:prod
- 再検証コマンド（QUALITY_GATE_ALLOW_DIRTY=1 ...）使用: あり/なし（回数: n回）

テスト結果:
- lint:fix: pass/fail
- typecheck: pass/fail
- test: pass/fail
- audit:prod: pass/fail（high/critical の有無）

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
  - `fix(auto-scan): ...`

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
