# Codex Workflow (確定版)

## 実行順（絶対）
1. Plan（必要な時だけ）: `tasks/todo.md` を作る
2. Implementation: Work Items を “一気に” 全部完了
3. Verification: typecheck/lint/tests をまとめて実施
4. Broad Review: 複数観点レビュー（関連項目まで）
5. Fix & Re-verify: 指摘があれば修正して検証を通しきる
6. Done: 成果物/検証/レビューが揃ったら終了

## 委譲例
- 調査: `explorer`
- 軽実装: `worker`
- 重実装/設計/セキュリティ: `worker_heavy`
- spark が死ぬ: `*_fallback`

## spark フォールバック（運用）
- 最初に `explorer` を軽タスクで spawn して疎通確認
- 失敗したら以後 `explorer_fallback` / `worker_fallback` を使う

## “途中で止まらない”ためのルール
- 計画提示後に確認待ちしない
- 「次に進めるなら…」は禁止（やるなら今やる）
- レビューは最後にまとめる（実装中に挟まない）
