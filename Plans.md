# Plans.md — DeadStockSolution

> 詳細設計は [plan.md](./plan.md) を参照

## Sprint: コード品質改善リファクタリング

### Phase 1: サーバー大規模ファイル分割 [P]
- [x] T001: `drug-master-service.ts` (1004行) を分割 `cc:DONE` (2026-02-25)
  - `drug-master-parser-service.ts`, `drug-master-sync-service.ts`, `drug-master-lookup-service.ts` に分離 + ファサード
- [x] T002: `matching-service.ts` (734行) を分割 `cc:DONE` (2026-02-25)
  - `matching-score-service.ts`, `matching-filter-service.ts` に分離 + ファサード
- [x] T003: `admin.ts` ルート (700行) を分割 `cc:DONE` (2026-02-25)
  - `admin-pharmacies.ts`, `admin-logs.ts`, `admin-stats.ts`, `admin-utils.ts` に分離 + ファサード
- [x] T004: `drug-master.ts` ルート (706行) を分割 `cc:DONE` (2026-02-25)
  - `drug-master-crud.ts`, `drug-master-sync.ts` に分離 + ファサード
- [x] T005: `upload.ts` ルート (516行) を分割 `cc:DONE` (2026-02-25)
  - `upload-validation.ts`, `upload-parser.ts` に分離 + ファサード

### Phase 2: クライアント大規模ページ分割 [P]
- [x] T006: `AccountPage.tsx` (867行) をコンポーネント分割 `cc:DONE` (2026-02-25)
  - `components/account/` に AccountInfoForm, BusinessHoursSettings, WithdrawSection + types.ts
- [x] T007: `AdminDrugMasterPage.tsx` (747行) をコンポーネント分割 `cc:DONE` (2026-02-25)
  - `admin/components/` に DrugMasterStatsCards, SearchFilter, Table, DetailModal, EditModal
- [x] T008: `DashboardPage.tsx` (476行) をコンポーネント分割 `cc:DONE` (2026-02-25)
  - `components/dashboard/` に DashboardNextAction, Notices, StatusCards + types.ts
- [x] T009: `Header.tsx` (393行) をコンポーネント分割 `cc:DONE` (2026-02-25)
  - `components/header/` に AppUpdatesPopover, RequestModal

### Phase 3: サーバーログ整理
- [x] T010: DB スクリプトの `console.log` を構造化ログに置換 `cc:DONE` (2026-02-25)
  - 4ファイル19箇所を logger.* に完全置換

---

## 📦 アーカイブ

> 完了済みスプリントは `.claude/memory/archive/` に移動済み

- [医薬品マスター管理機能スプリント](.claude/memory/archive/Plans-completed-sprint-drug-master.md) — Phase 1-6 全完了 + Backlog (23タスク, archived 2026-02-25)
