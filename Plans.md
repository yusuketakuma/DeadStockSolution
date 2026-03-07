# Plans.md — DeadStockSolution

> 詳細設計は [plan.md](./plan.md) を参照

## 🔴 進行中のタスク

## Sprint: Frontend Hooks抽出 v0.0.10

> **目的**: UploadPage.tsx（940行）の巨大コンポーネントを分割し、保守性・テスタビリティを向上

### Phase 1: ポーリングロジック抽出 [refactoring]

- [x] T128: useUploadJobPolling.ts 抽出 `cc:完了` (2026-03-07)
  - 抽出対象: ポーリングループ（391-508行）、waitForNextPoll関数
  - 状態: uploadJob, cancellingJob, uploadProgress
  - テスト要件: ポーリング成功/失敗/タイムアウト/キャンセル
  - 実績: フック作成完了、16テスト成功、UploadPage統合は別タスクで実施予定

### Phase 2: フォーム状態抽出 [refactoring]

- [ ] T129: useUploadForm.ts 抽出 `cc:計画済` (2026-03-07)
  - 抽出対象: uploadType, file, applyMode, deleteMissing, mapping, preview
  - テスト要件: 状態変更・バリデーション

### Phase 3: 差分サマリー抽出 [refactoring]

- [ ] T130: useDiffSummary.ts 抽出 `cc:計画済` (2026-03-07)
  - 抽出対象: diffSummary, acknowledgeDeleteImpact
  - テスト要件: 状態変更・削除影響確認

## 🟡 未着手のタスク

### v0.0.11 パフォーマンス改善スプリント

- [ ] **T218**: insertInBatches バッチサイズ最適化
  - 現状: 500件ずつ挿入（大規模アップロードでトランザクション長期化）
  - 提案: 動的バッチサイズ（1000-5000件）または COPY 使用検討
  - 優先度: Medium
  - 影響: 10万件以上のアップロード

- [ ] **T219**: detectHeaderRow スキャン最適化
  - 現状: 最大15行スキャン O(rows × headers × keywords)
  - 提案: 早期終了条件の追加
  - 優先度: Low
  - 影響: 軽微（初期行のみ）

---

## 📦 アーカイブ

> 完了済みスプリントは `.claude/memory/archive/` に移動済み

- [医薬品マスター管理機能スプリント](.claude/memory/archive/Plans-completed-sprint-drug-master.md) — Phase 1-6 全完了 + Backlog (23タスク, archived 2026-02-25)
- [2026-02 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-02.md) — T001-T040: コード品質改善 / システム堅牢化 / 統合通知 / コード簡素化 (40タスク, archived 2026-03-01)
- [2026-03 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-03.md) — T041-T100: パフォーマンス改善 / タイムライン / 認証強化 / UX改善 / 統計 / 薬品マスター自動更新 (60タスク, archived 2026-03-02)
- [v0.0.8 + リファクタリング](.claude/memory/archive/Plans-completed-sprints-2026-03-v008-refactor.md) — T101-T114 + Wave 1-6 リファクタリング (archived 2026-03-07)
- [v0.0.9](.claude/memory/archive/Plans-completed-sprints-2026-03-v009.md) — T115-T127: セキュリティ・テスト・UX (archived 2026-03-07)
- [v0.0.10](.claude/memory/archive/Plans-completed-sprints-2026-03-v010.md) — T201-T217: Pre-commit hooks / モニタリング / 依存関係管理 / バンドル最適化 / Lighthouse CI / CSP強化 / Sentry→OpenClaw autofix (17タスク, archived 2026-03-07)
