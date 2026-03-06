# Refactoring Issues

## [2026-02-27] Known Issues

### 初期調査の過大報告
- 探索エージェントがファイルサイズを10-35倍に過大報告した
- Metisの検証でwc -lで実測値を確認し、スコープを修正

## [2026-02-28] F4 Scope Fidelity Check

### コミットとタスク番号のマッピング不整合
- Task 1-4の実装変更が想定コミットに乗っていない（6d66571に複数タスク変更が混在）
- 4e91620 / ae87471 が evidence ファイルのみで、対象ソース変更を含まない

### スコープ外変更の混入
- 6d66571 に `server/src/app.ts` / `server/src/routes/internal-*.ts` / `package-lock.json` が混在
- b060b94 に Task 8無関係の evidence（Task 5/6）が混在

### 再発防止メモ
- タスク単位コミット前に `git show --name-only <hash>` で「想定ファイルのみ」を必須確認
- evidence/notepad 更新は実装コミットと分離し、専用コミットへ分ける

## [2026-03-07] upload-parser helper extraction regression

### 事象
- `/api/upload/preview` が正常系でも 400 を返し、`upload-route.test.ts` と `upload-inventory-flow.test.ts` の preview 系テストが失敗。

### 根本原因
- `upload-parser-helpers.ts` の `SuggestedPreviewMapping` 型変更漏れで、`suggestedByType[uploadType].mapping` 参照先が不整合になり、マッピング検証が常に null 化。
