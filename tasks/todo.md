# tasks/todo.md

## Goal
- （自動設定 or ユーザー指定）
- 受け入れ条件（箇条書き）

## Plan（Plan mode 相当）
- [ ] 影響範囲の特定（explorer）
- [ ] 実装（worker_*）
- [ ] テスト（test_engineer）
- [ ] 検証（typecheck/lint/test）
- [ ] 広範レビュー（reviewer_*）
- [ ] 修正（必要なら）
- [ ] 最終検証
- [ ] ドキュメント更新（必要なら）

## Delegation（割当）
- loc_delta_est: 
- files_changed_est:
- tests_added:
- runtime_est_min:
- 役割割当メモ:

## Implementation Log
- 変更点の要約
- 変更ファイル一覧

## Verification Log
- 実行コマンド:
  - `...`
- 結果:
  - ✅/❌（ログへのリンクや抜粋）

## Review Log（複数観点）
- reviewer_security:
- reviewer_quality:
- reviewer_release:
- 主要指摘（Severity順）
- 修正対応（実施したもの）

## Done Checklist
- [ ] 受け入れ条件を満たした
- [ ] typecheck ✅
- [ ] lint ✅
- [ ] test ✅
- [ ] P1/P2 指摘ゼロ（または修正済み）
