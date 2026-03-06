# P1 Remediation Batch（実装計画テンプレ）

目的：レビューで出た P1 を **まとめて実装 → 最後に検証 → 広範レビュー** で潰す。

## 入力（例：今回の主要P1）
1) PendingSessionsList.tsx: onConfirm が実処理を呼ばない疑い
2) ownership-checker.ts: 未知resourceが fail-open
3) fts.ts: where 生SQL文字列補間経路
4) blob.ts: resolveBlobToken() がアカウントキー返却経路
5) require-sanitized-innerhtml.js: 判定抜け道
6) useWorkflowTransition.ts: 401即リダイレクトが再更新と競合
7) ErrorAnalysis.tsx: CSV式インジェクション対策不足
8) deploy-staging.yml: smoke-test パス不一致
(＋P2群)

## 進め方（固定）
Phase A: 実装を一気に完了
- heavy（codex）に投げるべき：
  - fail-open（認可） / SQL注入面 / 秘密情報露出 / lint rule 抜け道
- light（spark）に投げるべき：
  - staging workflow パス / alert UX など小規模
- test_writer：
  - 認可・注入・CSV・lint rule の回帰防止テスト（可能な範囲）
- 各実装の最後に SIMPLIFY パス（必須）

Phase B: 最後に検証（verifier）
- pnpm typecheck
- pnpm lint（方針：inventory drift の扱いを先に決める）
- 対象アプリの lint/test
- CI相当のスクリプト整合

Phase C: 広範レビュー（まとめて）
- quality/security/perf/test の4観点
- 指摘を reviewer が統合して優先度順に修正タスク化

Phase D: 指摘修正 → 最終検証 → Done

## DoD
- P1 = 0
- 検証 PASS
- “次に進めるなら” が空
