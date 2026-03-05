# Lessons (再発防止)

書式:
- Date:
- Symptom:
- Root cause:
- Prevention rule:
- How to detect early next time:

---

## (example)
- Date: YYYY-MM-DD
- Symptom: タスクが途中で止まった（次に進めるなら…で終了）
- Root cause: “確認待ち”を作る手順がAGENTSに混入していた / 圧縮で完遂規約が落ちた
- Prevention rule: 確認待ち禁止。compaction prompt に完遂規約を固定。project_doc_max_bytes を上げる。
- How to detect early next time: plan 出力後に実行へ移っているか、毎回チェックする

- Date: 2026-03-05
- Symptom: simplify 実行中の「コード変更内容・サブエージェント状態」がターミナル上で十分に可視化されていなかった
- Root cause: `prepare-simplify-worklist.sh` が `codex exec` 生ログ依存で、明示レポート（diff要約/agent状態要約）を必須出力していなかった
- Prevention rule: 各ターゲット実行後にスクリプト側で `Execution Report` を必須出力し、`git diff` とログ解析した sub-agent 状態（spawn/wait/completed/error）を標準表示する
- How to detect early next time: 1ターゲット実行直後に `Execution Report` セクションが表示されるかを確認し、無ければスクリプト不備として即修正する
