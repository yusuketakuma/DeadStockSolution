# Archived: 医薬品マスター管理機能スプリント

> Archived on 2026-02-25

## Phase 1: データベーススキーマ設計
- [x] `cc:DONE` drug_master テーブル追加 (`server/src/db/schema.ts`)
- [x] `cc:DONE` drug_master_packages テーブル追加
- [x] `cc:DONE` drug_master_price_history テーブル追加
- [x] `cc:DONE` drug_master_sync_logs テーブル追加
- [x] `cc:DONE` マイグレーション生成 (`server/drizzle/0001_*.sql`)

## Phase 2: 医薬品マスターサービス
- [x] `cc:DONE` `drug-master-service.ts` — MHLW データ取得・パース (Excel/CSV対応)
- [x] `cc:DONE` `drug-master-service.ts` — 同期処理 (syncDrugMaster + syncPackageData)
- [x] `cc:DONE` `drug-master-service.ts` — コード検索・薬品名検索 (lookupByCode/searchDrugMaster)
- [x] `cc:DONE` `drug-master-service.ts` — 薬価取得 (lookupByCode/getDrugDetail内で提供)

## Phase 3: 管理者APIエンドポイント
- [x] `cc:DONE` `drug-master.ts` — CRUD エンドポイント (11エンドポイント)
- [x] `cc:DONE` `drug-master.ts` — 同期・アップロードエンドポイント
- [x] `cc:DONE` `app.ts` — ルート登録 (`/api/admin/drug-master`)

## Phase 4: 管理者UI
- [x] `cc:DONE` `AdminDrugMasterPage.tsx` — 統計カード・操作部 (910行)
- [x] `cc:DONE` `AdminDrugMasterPage.tsx` — 検索・フィルター・一覧テーブル
- [x] `cc:DONE` `AdminDrugMasterPage.tsx` — 詳細モーダル・編集モーダル・同期ログ
- [x] `cc:DONE` `App.tsx` — ルート追加 + サイドバーリンク

## Phase 5: アップロードフロー統合
- [x] `cc:DONE` `drug-master-enrichment.ts` — drug_master 照合ロジック (329行)
- [x] `cc:DONE` dead_stock_items / used_medication_items に drug_master_id 追加
- [x] `cc:DONE` アップロード時の自動補完（薬価・品名・単位）

## Phase 6: 検索機能拡張
- [x] `cc:DONE` `/api/search/drug-master` — drug_master からの候補返却
- [x] `cc:DONE` 薬価情報付与 (収載中品目のみ、YJコード対応)

## Backlog
- [x] `cc:DONE` MHLW URL自動取得 (`drug-master-scheduler.ts`)
- [x] `cc:DONE` 包装単位データの自動更新スケジューラ (`drug-package-scheduler.ts`)
