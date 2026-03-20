# 医薬品在庫検索機能 設計書

## 概要

複数薬剤を同時に検索し、在庫を持つ薬局を一覧表示する独立機能。[InventorySearchPage](/Users/yusuke/DeadStockSolution/client/src/pages/InventorySearchPage.tsx) で提供し、既存の [InventoryBrowsePage](/Users/yusuke/DeadStockSolution/client/src/pages/InventoryBrowsePage.tsx) の一覧参照とは分離する。

## 現在の導線

1. 薬剤師が [InventorySearchForm](/Users/yusuke/DeadStockSolution/client/src/components/inventory/InventorySearchForm.tsx) で薬剤チップを追加する。
2. `グループ内のみ`、`営業中のみ`、`お気に入り優先` を必要に応じて指定する。
3. `在庫を検索` を押すと `POST /api/inventory/inventory-search` を実行する。
4. 結果はサマリカードとマトリクスで表示する。
5. サマリカードの `マッチング候補を確認` から [MatchingPage](/Users/yusuke/DeadStockSolution/client/src/pages/MatchingPage.tsx) を `targetPharmacyId` 付きで開き、既存の提案作成フローに入る。

## API 契約

### リクエスト

`POST /api/inventory/inventory-search`

```json
{
  "drugKeys": [
    {
      "drugMasterId": 123,
      "genericName": "ロキソプロフェンナトリウム",
      "specification": "60mg"
    }
  ],
  "filters": {
    "groupOnly": false,
    "openOnly": false,
    "favoritePriority": false
  },
  "coordinates": null
}
```

### レスポンス

```json
{
  "summary": [
    {
      "pharmacyId": 2,
      "pharmacyName": "相手薬局",
      "matchedCount": 1,
      "totalDrugs": 1,
      "totalYakka": 100,
      "distance": 1.5,
      "businessStatus": {
        "isOpen": true,
        "message": "09:00〜18:00",
        "isConfigured": true
      },
      "isFavorite": true,
      "isGroupMember": false
    }
  ],
  "matrix": {
    "columns": [
      {
        "genericName": "ロキソプロフェンナトリウム",
        "specification": "60mg",
        "columnLabel": "ロキソプロフェンナトリウム 60mg"
      }
    ],
    "rows": [
      {
        "pharmacyId": 2,
        "pharmacyName": "相手薬局",
        "cells": [
          {
            "available": true,
            "items": [
              {
                "drugName": "ロキソプロフェンNa錠60mg「サワイ」",
                "manufacturer": "サワイ",
                "yakkaUnitPrice": 5.7,
                "quantity": 120,
                "unit": "錠"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

## サーバ設計

- 検索バリデーションは [validators.ts](/Users/yusuke/DeadStockSolution/server/src/utils/validators.ts) の `inventorySearchSchema` が担当する。
- 検索本体は [inventory-search-service.ts](/Users/yusuke/DeadStockSolution/server/src/services/inventory-search-service.ts) の `searchInventoryAvailability()` が担当する。
- `favoritePriority` は同充足数時の並び替えに反映する。
- `groupOnly` は自薬局と同じグループに属する薬局へ絞る。
- 非アクティブ薬局と blocked 関係の薬局は除外する。
- `openOnly` は営業時間ステータスで絞る。

## クライアント設計

- [useInventorySearch](/Users/yusuke/DeadStockSolution/client/src/hooks/useInventorySearch.ts) が検索 API 呼び出しと状態管理を担当する。
- [InventorySearchPage](/Users/yusuke/DeadStockSolution/client/src/pages/InventorySearchPage.tsx) がフォーム、サマリカード、マトリクスを束ねる。
- [InventoryBrowsePage](/Users/yusuke/DeadStockSolution/client/src/pages/InventoryBrowsePage.tsx) は従来どおり `GET /api/inventory/browse` の一覧参照を担当する。
- [PharmacySummaryCards](/Users/yusuke/DeadStockSolution/client/src/components/inventory/PharmacySummaryCards.tsx) は検索結果からマッチング導線を提供する。
- [MatchingPage](/Users/yusuke/DeadStockSolution/client/src/pages/MatchingPage.tsx) は医薬品在庫検索由来の query を受け取った場合、自動で 1 回だけ候補検索を行う。

## テスト対象

- [inventory-search-service.test.ts](/Users/yusuke/DeadStockSolution/server/src/test/inventory-search-service.test.ts)
- [inventory-search.test.ts](/Users/yusuke/DeadStockSolution/server/src/test/inventory-search.test.ts)
- [InventorySearchForm.test.tsx](/Users/yusuke/DeadStockSolution/client/src/test/components/InventorySearchForm.test.tsx)
- [InventorySearchPage.test.tsx](/Users/yusuke/DeadStockSolution/client/src/test/components/InventorySearchPage.test.tsx)
- [InventoryBrowsePage.test.tsx](/Users/yusuke/DeadStockSolution/client/src/test/components/InventoryBrowsePage.test.tsx)
- [PharmacySummaryCards.test.tsx](/Users/yusuke/DeadStockSolution/client/src/test/components/PharmacySummaryCards.test.tsx)
- [matching-page-groups.test.tsx](/Users/yusuke/DeadStockSolution/client/src/test/e2e/matching-page-groups.test.tsx)
