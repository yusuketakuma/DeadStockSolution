# 医薬品在庫検索機能 実装メモ

## 目的

複数薬剤の在庫検索を独立した [InventorySearchPage](/Users/yusuke/DeadStockSolution/client/src/pages/InventorySearchPage.tsx) で提供し、検索結果を既存のマッチング導線へ安全に接続する。従来の [InventoryBrowsePage](/Users/yusuke/DeadStockSolution/client/src/pages/InventoryBrowsePage.tsx) は全薬局在庫の一覧参照として残す。

## 現在の主要ファイル

- [inventory-search-service.ts](/Users/yusuke/DeadStockSolution/server/src/services/inventory-search-service.ts): 薬剤解決、在庫照合、フィルタ、薬局ソート。
- [inventory.ts](/Users/yusuke/DeadStockSolution/server/src/routes/inventory.ts): `POST /api/inventory/inventory-search`。
- [validators.ts](/Users/yusuke/DeadStockSolution/server/src/utils/validators.ts): `inventorySearchSchema`。
- [useInventorySearch.ts](/Users/yusuke/DeadStockSolution/client/src/hooks/useInventorySearch.ts): API 呼び出しと検索状態。
- [InventorySearchForm.tsx](/Users/yusuke/DeadStockSolution/client/src/components/inventory/InventorySearchForm.tsx): チップ入力、フィルタ、検索実行。
- [InventorySearchPage.tsx](/Users/yusuke/DeadStockSolution/client/src/pages/InventorySearchPage.tsx): 結果画面とマッチング遷移。
- [InventoryBrowsePage.tsx](/Users/yusuke/DeadStockSolution/client/src/pages/InventoryBrowsePage.tsx): `GET /api/inventory/browse` の一覧参照。
- [MatchingPage.tsx](/Users/yusuke/DeadStockSolution/client/src/pages/MatchingPage.tsx): `targetPharmacyId` を受け取って候補を絞り込む。

## 実装済み項目

- 処方せん検索の名称を在庫検索へ統一。
- 医薬品在庫検索を `InventoryBrowsePage` から独立ページに切り出し、`/inventory/search` へ配置。
- 旧 `prescription-search` route と型 alias を削除。
- `favoritePriority` を実際のソートへ反映。
- `groupOnly` を `useGroupMembership` と接続。
- 非アクティブ薬局を検索結果から除外。
- 医薬品在庫検索結果から proposal 一覧へ直接飛ばすのをやめ、既存のマッチング候補確認フローへ接続。
- `MatchingPage` の自動検索は query ごとに 1 回だけ実行し、失敗時の無限再試行を防止。

## 検証コマンド

- `npm run typecheck`
- `npm run lint`
- `npm run test --workspace=server -- src/test/inventory-search-service.test.ts src/test/inventory-search.test.ts src/test/inventory-route.test.ts`
- `npm run test --workspace=client -- src/test/components/InventorySearchForm.test.tsx src/test/components/InventorySearchPage.test.tsx src/test/components/InventoryBrowsePage.test.tsx src/test/components/InventoryMatrix.test.tsx src/test/components/PharmacySummaryCards.test.tsx src/test/e2e/matching-page-groups.test.tsx src/test/e2e/inventory.test.tsx src/test/e2e/dashboard.test.tsx`
- `npm run build`

## 注意点

- 後方互換性は不要な前提のため、旧 `prescription-search` 名は runtime code に残さない。
- 医薬品在庫検索からマッチングへ入る query は UI 用文言を含むため、絞り込み条件として必須なのは `targetPharmacyId` 側。
- proposal 作成契約は [exchange-proposals.ts](/Users/yusuke/DeadStockSolution/server/src/routes/exchange-proposals.ts) の既存 candidate 形式に従う。
