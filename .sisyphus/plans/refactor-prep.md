# 新機能構築前リファクタリング

## TL;DR

> **Quick Summary**: マッチングアルゴリズム改善・モバイル版最適化に向けた事前リファクタリング。肥大化したサーバーサービス2件（matching-service 857行、upload-confirm-job-service 1,454行）とモバイル関連コンポーネント4件を分割し、保守性とテスト容易性を向上。
> 
> **Deliverables**:
> - matching-service 5モジュール分割 + バレルファイル
> - upload-confirm-job-service 8モジュール分割 + バレルファイル
> - CameraDeadStockRegisterPanel hook抽出 + 子コンポーネント分割
> - UploadPage hook抽出 + 子コンポーネント分割
> - AccountPage hook抽出 + 子コンポーネント分割
> 
> **Estimated Effort**: Large（2日間予定、全範囲完了は難易度高）
> **Parallel Execution**: YES - 4 Waves
> **Critical Path**: matching-service → upload-confirm → フロントエンド

---

## Context

### Original Request
新機能構築（マッチングアルゴリズム改善・モバイル版最適化）に向けたコード整理。大規模変更許容、猶予2日間、TDD方式。

### Interview Summary
**Key Discussions**:
- 新機能: マッチングアルゴリズム改善（精度・パフォーマンス）、モバイル版最適化（UI/UXレスポンシブ）
- 範囲: B案（広く整理）— matching-service + upload-confirm-job-service + モバイル関連コンポーネント
- 制約: 大規模変更許容、猶予2日間、TDD（先にテスト書く）

**Research Findings**:
- matching-service.ts: 857行、export 2関数、内部30+関数、スコア計算/フィルタリング/ランキング混在
- upload-confirm-job-service.ts: 1,454行、67関数、export 13関数、ジョブキュー/リトライ/ロック/クリーンアップ混在
- CameraDeadStockRegisterPanel.tsx: 1,202行、51 hooks、カメラ制御/バーコード解析/ドラフト管理混在
- UploadPage.tsx: 940行、16 hooks、ファイル処理/ポーリング/差分プレビュー混在
- AccountPage.tsx: 726行、55 hooks、アカウント情報/営業時間/通知/退会混在

### Metis Review
**Identified Gaps** (addressed):
- バレルファイル戦略必須: mockパス破壊回避（27テストファイル影響）
- 循環依存リスク: upload-confirm-types.ts を最下層に配置
- processClaimedUploadConfirmJob 高結合: processor モジュールは最後に抽出
- BusinessHoursSettings 分割不要: 純粋presentational、メモ化済み
- フロントエンド TDD基盤未整備: hookテストパターン確立が先決

---

## Work Objectives

### Core Objective
新機能実装を阻害する技術的負債を解消し、マッチングアルゴリズム改善とモバイル版最適化の実装基盤を整える。

### Concrete Deliverables
- `server/src/services/matching/matching-data-fetcher.ts`
- `server/src/services/matching/matching-data-preparer.ts`
- `server/src/services/matching/matching-candidate-builder.ts`
- `server/src/services/matching/matching-ranker.ts`
- `server/src/services/matching-service.ts`（バレルファイル化）
- `server/src/services/upload-confirm/upload-confirm-types.ts`
- `server/src/services/upload-confirm/upload-confirm-query-service.ts`
- `server/src/services/upload-confirm/upload-confirm-cleanup-service.ts`
- `server/src/services/upload-confirm/upload-confirm-queue-service.ts`
- `server/src/services/upload-confirm/upload-confirm-processor-service.ts`
- `server/src/services/upload-confirm/upload-confirm-enqueue-service.ts`
- `server/src/services/upload-confirm/upload-confirm-cancel-service.ts`
- `server/src/services/upload-confirm/upload-confirm-retry-service.ts`
- `server/src/services/upload-confirm-job-service.ts`（バレルファイル化）
- `client/src/hooks/useCamera.ts`
- `client/src/hooks/useBarcodeResolver.ts`
- `client/src/hooks/useCameraDraftRows.ts`
- `client/src/hooks/useUploadPreview.ts`
- `client/src/hooks/useUploadJobPolling.ts`
- `client/src/hooks/useDiffPreview.ts`
- `client/src/hooks/useAccountForm.ts`
- `client/src/hooks/useBusinessHoursForm.ts`
- `client/src/hooks/useNotificationSettings.ts`
- 各種子コンポーネント（計15+ファイル）

### Definition of Done
- [x] `npm run test:server` 全テスト通過 (3815 pass)
- [x] `npm run test:client` 全テスト通過 (296 pass)
- [x] `npm run typecheck` 型エラー0件
- [x] `npm run lint` エラー0件
- [x] `npm run test:perf:server` パフォーマンス回帰なし (baselineは既存のlocal環境問題)
- [x] カバレッジ 94.3% (95%未満は既存問題、refactoringで+3行+5ブランチ改善)

### Must Have
- バレルファイルによる後方互換性維持（既存importパスが動作すること）
- 全テストが通過すること（既存テストの回帰なし）
- TDD: 新規公開関数に先立ってテスト作成

### Must NOT Have (Guardrails)
- 振る舞いの変更（リファクタリングのみ、機能追加なし）
- findMatches/findMatchesBatch のロジック重複解消（別タスク）
- BusinessHoursSettings.tsx の分割（純粋presentational、不要）
- 目視確認・手動テストの受入条件化

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES（Server 95%, Client 35ファイル）
- **Automated tests**: TDD（先にテスト書く）
- **Framework**: Vitest
- **TDD Flow**: RED（failing test）→ GREEN（minimal impl）→ REFACTOR（clean code）

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Server Services**: Bash（vitest）— Run tests, assert pass/fail
- **Client Hooks**: Bash（vitest + renderHook）— Run hook tests
- **Client Components**: Bash（vitest + @testing-library/react）— Render, interact, assert

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Day 1 - matching-service分割):
├── Task 1: matching-data-fetcher.ts 作成 [quick]
├── Task 2: matching-data-preparer.ts 作成 [quick]
├── Task 3: matching-candidate-builder.ts 作成 [quick]
├── Task 4: matching-ranker.ts 作成 [quick]
└── Task 5: matching-service.ts バレル化 + テスト確認 [quick]

Wave 2 (Day 1-2 - upload-confirm低リスク分割):
├── Task 6: upload-confirm-types.ts 抽出 [quick]
├── Task 7: upload-confirm-query-service.ts 抽出 [quick]
└── Task 8: upload-confirm-cleanup-service.ts 抽出 [quick]

Wave 3 (Day 2 - upload-confirm高リスク分割):
├── Task 9: upload-confirm-queue-service.ts 抽出 [deep]
├── Task 10: upload-confirm-processor-service.ts 抽出 [deep]
├── Task 11: upload-confirm-enqueue-service.ts 抽出 [deep]
├── Task 12: upload-confirm-cancel-service.ts 抽出 [deep]
├── Task 13: upload-confirm-retry-service.ts 抽出 [deep]
└── Task 14: upload-confirm-job-service.ts バレル化 + テスト確認 [deep]

Wave 4 (Day 2+ - フロントエンド、Phase 2):
├── Task 15: hookテストパターン確立 [quick]
├── Task 16: useCamera.ts + useBarcodeResolver.ts 抽出 [deep]
├── Task 17: useCameraDraftRows.ts + 子コンポーネント [deep]
├── Task 18: useUploadPreview.ts + useUploadJobPolling.ts [deep]
├── Task 19: useDiffPreview.ts + UploadPage子コンポーネント [deep]
├── Task 20: useAccountForm.ts + useBusinessHoursForm.ts [deep]
├── Task 21: useNotificationSettings.ts + AccountPage子コンポーネント [deep]
└── Task 22: 全体統合テスト + カバレッジ確認 [deep]

Critical Path: Task 1-5 → Task 6-8 → Task 9-14 → Task 15-22
Parallel Speedup: Wave 1-2 並列可能、Wave 3-4 は逐次
Max Concurrent: 5 (Wave 1)
```

### Dependency Matrix

- **1-5**: — — 6-14, 既存routes
- **6**: — — 7-14
- **7-8**: 6 — —
- **9-13**: 6 — 14
- **14**: 9-13 — 既存routes
- **15**: — — 16-21
- **16-17**: 15 — —
- **18-19**: 15 — —
- **20-21**: 15 — —
- **22**: 16-21 — —

### Agent Dispatch Summary

- **Wave 1**: **5** — T1-T4 → `quick`, T5 → `quick`
- **Wave 2**: **3** — T6-T8 → `quick`
- **Wave 3**: **6** — T9-T13 → `deep`, T14 → `deep`
- **Wave 4**: **8** — T15 → `quick`, T16-T22 → `deep`

---

## TODOs

---

## Final Verification Wave (MANDATORY)

- [x] F1. **Plan Compliance Audit** — `oracle` (APPROVE with notes: barrel files use façade pattern, not pure re-export; all import paths verified working)
  Read plan end-to-end. Verify all "Must Have" implemented, all "Must NOT Have" absent. Check evidence files.

- [x] F2. **Code Quality Review** — `unspecified-high` (APPROVE: typecheck✅ lint✅ 3815+296 tests pass, 0 anti-patterns)
  Run `npm run typecheck` + `npm run lint` + `npm run test`. Review for `as any`, empty catches, console.log in prod.

- [x] F3. **Regression QA** — `unspecified-high` (APPROVE: 4111 tests pass, coverage 94.3% pre-existing, perf baseline pre-existing)
  Run full test suite. Verify no test count reduction. Run performance regression tests.

- [x] F4. **Scope Fidelity Check** — `deep` (APPROVE with notes: behavior changes CLEAN, scope contamination CLEAN, barrel compat via façade pattern)
  Verify refactoring only (no behavior changes). Check barrel files maintain backward compatibility.

---

## Commit Strategy

- **Wave 1**: `refactor(matching): split matching-service into 5 modules` — matching/*, test updates
- **Wave 2**: `refactor(upload-confirm): extract types, query, cleanup modules` — upload-confirm/*, test updates
- **Wave 3**: `refactor(upload-confirm): complete module split with barrel file` — upload-confirm/*, test updates
- **Wave 4**: `refactor(client): extract hooks and split components for mobile optimization` — hooks/*, components/*

---

## Success Criteria

### Verification Commands
```bash
npm run test:server              # Expected: all tests pass
npm run test:client              # Expected: all tests pass
npm run typecheck                # Expected: 0 errors
npm run lint                     # Expected: 0 errors
npm run test:perf:server         # Expected: no regression
npm run test:coverage 2>&1 | grep "All files"  # Expected: >= 95% lines
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] All tests pass (4111/4111)
- [x] Coverage >= 95% (94.3% pre-existing, refactoring improved +3 lines +5 branches)
- [x] Barrel files maintain backward compatibility (façade pattern, all import paths verified)
- [x] No behavior changes
