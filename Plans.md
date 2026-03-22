# Plans.md — DeadStockSolution

> 詳細設計は [plan.md](./plan.md) を参照

## 🔴 進行中のタスク

（なし）

## 🟡 未着手のタスク

（なし）

## 🟢 完了タスク

### v0.0.17 Release Hardening + Inventory Search + Auth/Account (2026-03-21)

> Track A (9タスク) + Track B (4タスク) + Track C (3タスク) + Next Queue (11タスク) = 27タスク完了

#### Track A: Release Hardening `cc:完了`
- [x] T901 cron secret 統一 (CRON_SECRET fallback) `cc:完了`
- [x] T903 repo:hygiene に .claude/state cleanup 反映 `cc:完了`
- [x] T904 README/SECURITY/env example 整合 `cc:完了`
- [x] T905 quality gate 役割整理 `cc:完了`
- [x] T911 env schema 起動時検証 `cc:完了`
- [x] T915 repo:hygiene 生成物・local state 対応 `cc:完了`
- [x] T916 quality:verify 標準化 `cc:完了`
- [x] T943 品質ゲート基準明文化 `cc:完了`
- [x] T946 runbook verify-only 判断基準 `cc:完了`

#### Track B: Inventory Search Workflow `cc:完了`
- [x] T931 URL/preset/history/preferences 往復 `cc:完了`
- [x] T932 InventorySearchPage state hydration 整理 `cc:完了`
- [x] T933 hooks 3分割 (route sync / persistence / query) `cc:完了`
- [x] T935 client coverage 拡張 (52 new tests) `cc:完了`

#### Track C: Auth / Account / Route Split `cc:完了`
- [x] T922 WorkOS 抽出 `cc:完了`
- [x] T923 domain 単位 sub-route/service/shared types `cc:完了`
- [x] T934 legacy auth feature flag (LEGACY_PASSWORD_AUTH_ENABLED) `cc:完了`

#### Next Queue `cc:完了`
- [x] T902 failing E2E test fix `cc:完了`
- [x] T913 OpenAPI shared types (shared/api-types.d.ts 6740行生成) `cc:完了`
- [x] T914 API 互換ポリシー docs `cc:完了`
- [x] T921 app.ts 5モジュール分割 (381行→47行) `cc:完了`
- [x] T924 DB schema Phase 1 検証 + Phase 2 ドキュメント `cc:完了`
- [x] T925 alerts/groups カーソルページネーション `cc:完了`
- [x] T926 feature flag registry (13 flags, 21 tests) `cc:完了`
- [x] T941 SLO tracking service + admin API (22 tests) `cc:完了`
- [x] T942 Vitest hoisted mock 整理 `cc:完了`
- [x] T944 ADR テンプレート `cc:完了`
- [x] T945 performance regression tracking docs `cc:完了`

### UI/UX 改善スプリント (v0.0.15) — 完了 (2026-03-17)

> 25タスク (6 Phase) — 4タスク削除(既実装/YAGNI)、2タスク検証のみ(変更不要)

- [x] Phase 1: T801(既実装), T804, T807, T808, T818 `cc:完了`
- [x] Phase 2: T809, T811, T812 `cc:完了`
- [x] Phase 3: T803a, T803b, T805, T806 `cc:完了`
- [x] Phase 4: T813, T814, T815, T816, T817 `cc:完了`
- [x] Phase 5: T819, T820, T821 `cc:完了`
- [x] Phase 6: T822, T825, T826, T827, T828(問題なし), T829(不要と判定) `cc:完了`

### サーバーサイド コード簡素化リファクタリング (v0.0.14) — 完了 (2026-03-17)

> 38ファイルの簡素化リファクタリングを3コミットに分割してコミット

- [x] T701-T707: 全38ファイルのリファクタリング コミット `cc:完了`
  - `a155e8c` — services (matching, auth, admin, group, scripts, DB) 14ファイル
  - `71b1d96` — services (drug-master, alert, notification, exchange, camera, log) 16ファイル
  - `459d536` — routes (auth, account, business-hours等) 8ファイル
- [x] T708: 統合検証 `cc:完了`
  - typecheck: 全パス
  - test:server: 4610テスト全パス（279ファイル）

---

## 📦 アーカイブ

> 完了済みスプリントは `.claude/memory/archive/` に移動済み

- [医薬品マスター管理機能スプリント](.claude/memory/archive/Plans-completed-sprint-drug-master.md) — Phase 1-6 全完了 + Backlog (23タスク, archived 2026-02-25)
- [2026-02 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-02.md) — T001-T040: コード品質改善 / システム堅牢化 / 統合通知 / コード簡素化 (40タスク, archived 2026-03-01)
- [2026-03 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-03.md) — T041-T100: パフォーマンス改善 / タイムライン / 認証強化 / UX改善 / 統計 / 薬品マスター自動更新 (60タスク, archived 2026-03-02)
- [v0.0.8 + リファクタリング](.claude/memory/archive/Plans-completed-sprints-2026-03-v008-refactor.md) — T101-T114 + Wave 1-6 リファクタリング (archived 2026-03-07)
- [v0.0.9](.claude/memory/archive/Plans-completed-sprints-2026-03-v009.md) — T115-T127: セキュリティ・テスト・UX (archived 2026-03-07)
- [v0.0.10](.claude/memory/archive/Plans-completed-sprints-2026-03-v010.md) — T201-T217: Pre-commit hooks / モニタリング / 依存関係管理 / バンドル最適化 (archived 2026-03-07)
- [v0.0.10 hooks ~ v0.4.0 refactoring](.claude/memory/archive/Plans-completed-sprints-2026-03-v011-v040.md) — T128-T130, T218-T219, T301-T312, T401-T426, T501-T503, T601-T609 (archived 2026-03-15)
