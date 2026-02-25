# Codex Workflow（未完了終了禁止）

## ルール
- 未完了で終了しない（DONE / BLOCKED の二択）
- レビューは実装後（実装中のレビュー割り込み禁止）

## フェーズ
0) Preflight: lessons を読んで防止ルール適用
1) Plan: tasks/todo.md に仕様と検証計画を書く（非自明は plan 必須）
2) Implement: todo の実装を全部終える（レビュー禁止）
3) Verify: typecheck → lint → tests を通して証拠を残す
4) Review: 多観点レビュー → 指摘修正 → 再検証 → 再レビュー（P1=0まで）

## BLOCKED
外部要因で進めない場合のみ END_STATE=BLOCKED とし、
必要な情報/権限/認証/再現手順を最小要求で列挙する。
