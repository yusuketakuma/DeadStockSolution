# tasks/todo.md

## 現在の目標（Goal）
- [x] P2 backlog の残件（DNS pinning テスト、matching refresh retry/stale テスト、upload confirm enqueue失敗時の可用性対策）を実装・検証し、回帰を固定化する

## 完了条件（DoD）
- [x] 要件がすべて実装済み
- [x] verifier: typecheck PASS
- [x] verifier: lint PASS（プロジェクト方針に従う）
- [x] verifier: test PASS（必要範囲）
- [x] 広範レビュー（品質/セキュリティ/性能/テスト）P1=0
- [x] “次に進めるなら” が空
- [x] 変更サマリ/リスク/残課題を記録

---

## タスク一覧（Implement all -> Verify -> Wide Review）

### A. 実装（ここを一気に完了）
- [x] TASK-A1: `createPinnedDnsLookup` を追加し、host mismatch / family filter / all mode / round-robin をテスト化（area=network-utils）
- [x] TASK-A2: scheduler 側の source-fetch dispatcher wiring をテスト化（area=drug-master-scheduler, drug-package-scheduler）
- [x] TASK-A3: matching refresh の stale reclaim / retry progression をテスト化（area=matching-refresh-service）
- [x] TASK-A4: upload confirm enqueue 失敗時の sync fallback（env-gated）を実装しテスト化（area=upload-parser）
- [x] NOTE: 実装後に SIMPLIFY を実施（既存実装に沿う最小差分・過剰抽象化なし）

### B. 最後にまとめて検証（verifier）
- [x] TASK-B1: typecheck（`npm run typecheck`）
- [x] TASK-B2: lint（`npm run lint`）
- [x] TASK-B3: test / build（`npm run test --workspace=server -- src/test/network-utils-coverage.test.ts src/test/matching-refresh-service-coverage.test.ts src/test/upload-route.test.ts src/test/drug-master-scheduler-coverage.test.ts src/test/drug-package-scheduler-coverage.test.ts`、`npm run build:server && npm run build:client`）
- [x] TASK-B4: 証跡（本ファイルと作業ログに記録）

### C. 広範レビュー（後段でまとめて）
- [x] TASK-C1: quality_reviewer（最小差分で既存パターン準拠）
- [x] TASK-C2: security_auditor（env-gated fallbackで既定挙動は維持）
- [x] TASK-C3: perf_sleuth（追加はテスト中心、本番経路は限定変更）
- [x] TASK-C4: test_auditor（P2指摘の回帰テストを追加）

### D. レビュー指摘の修正（必要なら）
- [x] TASK-D1: P1修正なし（新規P1指摘なし）
- [x] TASK-D2: 必要テスト追加済み

### E. 最終検証（verifier）
- [x] TASK-E1: 再typecheck/lint/test/build 実施
- [x] TASK-E2: DoD確認

---

## 変更サマリ
- DNS pinning の直接 lookup テスト（host mismatch/family/all/round-robin）と scheduler wiring テストを追加。
- matching refresh の stale reclaim / retry progression の回帰テストを追加。
- upload confirm enqueue 失敗時の sync fallback（`UPLOAD_CONFIRM_FALLBACK_SYNC_ON_ENQUEUE_ERROR`）を実装し、APIレスポンスをテストで固定。

## リスク / 注意点
- fallback は同期処理になるため、リクエスト待ち時間が増える可能性がある（既定は無効、明示有効時のみ動作）。
- 作業ツリーに unrelated changes が多いため、コミット時は対象ファイルを厳密に限定する必要がある。

## “次に進めるなら”（残すのは禁止。残すなら必ずタスク化）
- （なし）
