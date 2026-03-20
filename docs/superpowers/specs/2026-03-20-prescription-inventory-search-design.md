# 処方せん在庫検索機能 設計書

## 概要

処方せんに記載された複数薬剤を同時検索し、在庫がある薬局をマトリクス表示で一覧する機能。後発医薬品のメーカー違いを一般名ベースで自動集約し、薬価が安い順に表示する。

既存の InventoryBrowsePage をアップデートして実装する。新規ページは作成しない。

## ユースケース

1. 患者が処方せんを持参 → 在庫不足の薬剤がある
2. 薬剤師が不足薬剤をチップ形式で検索リストに追加（サジェスション選択 or バーコードスキャン）
3. 「在庫を検索」で全薬局（またはグループ内）の在庫をマトリクス表示
4. 全品目揃う薬局を優先表示、サマリカードで即座に把握
5. 必要に応じてワンタップで提案送信

## 設計決定

| 項目 | 決定 | 理由 |
|------|------|------|
| 表示形式 | サマリカード + マトリクス表（常時） | 薬剤1つでも統一UI |
| 薬剤入力 | チップ形式（サジェスション選択）+ バーコード | 確実な薬剤特定 + 高速入力 |
| 後発品マッチ | genericName + specification で自動集約 | 手動登録不要、スケーラブル |
| 同一成分表示 | マトリクス1列にまとめ、セル内にメーカー名・薬価・数量列挙 | 列の爆発を防止 |
| ソート基準 | 品目充足数 → 薬価合計（安い順）→ 距離 | 全部揃う安い薬局が最優先 |
| 配置 | InventoryBrowsePage アップデート | 既存ページ活用、ページ増やさない |
| 既存UI | 既存の単一キーワード検索は廃止し、チップ形式に統一 | シンプルな統一UI |
| スコープ外 | 調剤実績ベース在庫推定 | 将来検討 |

## アーキテクチャ

### データフロー

```
[クライアント]
InventoryBrowsePage
  └─ 薬剤チップ追加（サジェスション or バーコード）
  └─ フィルタ設定（グループ内/営業中/お気に入り優先）
  └─ 「在庫を検索」ボタン
       │
       ▼
POST /api/inventory/prescription-search
  body: {
    drugKeys: [
      { genericName: "ロキソプロフェンナトリウム", specification: "60mg", drugMasterId: 123 },
      { genericName: "レバミピド", specification: "100mg", drugMasterId: 456 }
    ],
    filters: {
      groupOnly: boolean,
      openOnly: boolean,
      favoritePriority: boolean
    },
    coordinates: {              // 距離計算用（オプション）
      latitude: number | null,
      longitude: number | null
    }
  }

  制約:
  - drugKeys: 最大10件
  - genericName: 最大200文字
  - specification: 最大100文字
  - バリデーション: prescriptionSearchSchema (server/src/utils/validators.ts に追加)
       │
       ▼
[サーバー]
prescription-search-service.ts
  1. 薬剤解決（drugKeys → 在庫検索対象の特定）:
     a. drugKeys.drugMasterId が指定されている場合:
        → drugMaster から genericName + specification で同一成分の全 drugMasterId を収集
     b. genericName が NULL の drugMaster がある場合:
        → drugEquivalences テーブルでテキストベース検索
          (drugMaster.drugName → drugEquivalences.drugNameA/B → 逆引きで drugMaster)
     c. どちらもヒットしない場合:
        → drugName 正規化マッチング（既存 matching-score-service の prepareDrugName 流用）

  2. 在庫照合（二重パス）:
     a. 主パス: drugMasterId IN (...) で deadStockItems を検索
     b. 補助パス: drugMasterId が NULL の deadStockItems は drugName 正規化マッチで照合
        ※ deadStockItems.drugMasterId は nullable のため、両パスが必要

  3. フィルタ適用:
     - groupOnly: 自薬局が所属する全グループのメンバー薬局の和集合に絞る
       (薬局が複数グループに所属する場合、いずれかのグループを共有する薬局すべてを含む)
     - openOnly: businessHours で営業中の薬局に絞る
     - favoritePriority: pharmacyRelationships WHERE relationshipType = 'favorite'
       AND pharmacyId = 自薬局ID → targetPharmacyId が対象薬局のものを上位ソート
  4. ブロック薬局除外（既存 buildBlockedPairSet + isBlockedPair from matching-data-preparer.ts 流用、
     または inventory.ts:343-359 の notExists サブクエリパターン流用）
  5. 薬局ごとのスコア計算:
     - 品目充足数（降順）
     - 薬価合計（昇順、各品目の最安メーカーで計算）
       ※ Drizzle ORM の numeric 型は string で返却されるため、parseFloat() で数値変換してから算術演算すること
     - 距離（昇順、Haversine計算。coordinates 未送信時は距離=null でソート末尾）
  6. レスポンス返却（薬局上限50件）
       │
       ▼
[レスポンス]
{
  summary: [
    {
      pharmacyId: number,
      pharmacyName: string,
      matchedCount: number,     // 充足品目数
      totalDrugs: number,       // 検索品目数
      totalYakka: number,       // 最安合計薬価
      distance: number | null,
      businessStatus: { isOpen, message, isConfigured },
      isFavorite: boolean,
      isGroupMember: boolean
    }
  ],
  matrix: {
    columns: [
      { genericName: "ロキソプロフェンナトリウム", specification: "60mg" }
    ],
    rows: [
      {
        pharmacyId: number,
        pharmacyName: string,
        cells: [
          {
            available: true,
            items: [
              {
                drugName: "ロキソプロフェンNa錠60mg「サワイ」",
                manufacturer: "サワイ",
                yakkaUnitPrice: 5.7,   // number（サービス層で parseFloat 済み）
                quantity: 120,
                unit: "錠"
              },
              {
                drugName: "ロキソプロフェンNa錠60mg「日医工」",
                manufacturer: "日医工",
                yakkaUnitPrice: 5.9,   // number（サービス層で parseFloat 済み）
                quantity: 30,
                unit: "錠"
              }
            ]
          },
          {
            available: false,
            items: []
          }
        ]
      }
    ]
  }
}
```

### genericName データ品質のフォールバック

drugMaster.genericName が NULL の場合のフォールバック戦略:

1. **第1優先**: genericName + specification で完全一致グルーピング
2. **第2優先**: genericName が NULL → drugEquivalences テーブルでテキストベース検索
   - drugEquivalences は drugNameA / drugNameB（自由テキスト）で同等品ペアを保持
   - 検索フロー: drugMaster.drugName → drugEquivalences.drugNameA で検索 → drugNameB を取得 → drugMaster.drugName = drugNameB で逆引き（逆方向も同様）
   - equivalenceType: 'brand_generic'（先発↔後発）, 'generic_generic'（後発↔後発）
3. **第3優先**: どちらもヒットしない → drugName の正規化マッチング（既存 matching-score-service の prepareDrugName + Jaccard 係数流用、スコア閾値 0.70 以上を同一成分とみなす）

### 前提条件と事前確認

実装前に以下を確認する:

1. **genericName 充填率**: `SELECT COUNT(*) FILTER (WHERE generic_name IS NOT NULL) * 100.0 / COUNT(*) FROM drug_master` を実行。80%未満の場合はマイグレーションで薬価基準データから genericName を補完する
2. **deadStockItems.drugMasterId 充填率**: 同様に確認。NULL が多い場合は補助パス（drugName テキストマッチ）の重要度が上がる
3. **pharmacies の座標充填率**: latitude/longitude が NULL の薬局は距離計算不可

### 距離計算

- リクエストの coordinates フィールドで自薬局の緯度経度を送信（pharmacies テーブルの値をクライアントから送信）
- coordinates が未指定または pharmacies.latitude/longitude が NULL の場合、distance = null
- 計算方式: Haversine 公式（既存 matching-candidate-builder.ts の距離計算ロジック流用）
- distance が null の薬局はソートで末尾に配置

### チップの内部状態

サジェスション選択またはバーコードスキャンで確定した薬剤チップは以下の状態を保持:

```typescript
interface DrugChip {
  drugMasterId: number;         // サジェスションで選択した drugMaster.id
  genericName: string | null;   // 一般名（NULL の場合あり）
  specification: string | null; // 規格
  displayLabel: string;         // UI表示用（例: "ロキソプロフェン60mg"）
}
```

/search/drug-master のレスポンスに genericName フィールドを追加し、チップ生成時に取得する。

## UI 設計

### 検索エリア

```
┌─────────────────────────────────────────────────┐
│ 🔍 薬品名を入力...              [📷 スキャン]    │
│                                                 │
│ [ロキソプロフェン60mg ×] [レバミピド100mg ×]      │
│                                                 │
│ ☑ グループ内のみ  ☑ 営業中のみ  ☑ お気に入り優先  │
│                                                 │
│              [ 在庫を検索 ]                       │
└─────────────────────────────────────────────────┘
```

- 検索バー: 既存 SearchInput を拡張。サジェスション選択で薬剤をチップ追加
- サジェスション: /search/drug-master エンドポイント使用（genericName + specification 付き）
- バーコード: 既存 BarcodeScanButton → camera/resolve → 薬剤チップ追加
- チップ: 薬剤の一般名 + 規格を表示。× で削除
- フィルタ: チェックボックス3つ（グループ内のみ/営業中のみ/お気に入り優先）
- 検索ボタン: チップが1つ以上ある時のみ活性化

### サマリカード

```
┌─ すべて揃う薬局 ─────────────────────────────────┐
│ ┌────────────────────────────────────────┐       │
│ │ ○○薬局  ⭐                            │       │
│ │ 2/2品目  合計薬価 ¥310  徒歩5分        │       │
│ │ 🟢 営業中（18:00まで）      [提案する]  │       │
│ └────────────────────────────────────────┘       │
├─ 一部揃う薬局 ───────────────────────────────────┤
│ □□薬局  1/2品目  車10分  🔴 本日休業             │
└──────────────────────────────────────────────────┘
```

- 「すべて揃う薬局」と「一部揃う薬局」でセクション分け
- 各カード: 薬局名、充足数/検索数、合計薬価（最安計算）、距離、営業状態
- お気に入りマーク、グループメンバーマーク表示
- 「提案する」ボタン: 検索薬剤リストを ProposalPage に引き継ぎ

### マトリクス表

```
┌──────────┬───────────────────┬──────────────────┐
│          │ロキソプロフェン60mg│ レバミピド100mg   │
├──────────┼───────────────────┼──────────────────┤
│○○薬局    │ ✅ サワイ ¥5.7    │ ✅ ¥9.8          │
│⭐ 2/2   │    120錠          │    50錠          │
│          │   日医工 ¥5.9     │                  │
│          │    30錠           │                  │
├──────────┼───────────────────┼──────────────────┤
│□□薬局    │ ✅ サワイ ¥5.7    │ ❌ なし           │
│   1/2    │    60錠           │                  │
└──────────┴───────────────────┴──────────────────┘
```

- スティッキーヘッダー: スクロールしても薬剤列名が固定
- スティッキー左列: 薬局名が固定
- セル内: メーカー名 + 薬価 + 数量（薬価安い順）
- 在庫なし: ❌ 赤背景でハイライト
- モバイル: 横スクロール対応

### モバイル表示

- サマリカードは縦並びでそのまま表示
- マトリクス表は横スクロール（薬局列固定、薬剤列スクロール）
- 薬剤が多い場合はスワイプで確認

## 変更対象ファイル

### バックエンド（新規）

| ファイル | 内容 |
|---------|------|
| `server/src/services/prescription-search-service.ts` | 処方せん検索ビジネスロジック |

### バックエンド（変更）

| ファイル | 変更内容 |
|---------|---------|
| `server/src/routes/inventory.ts` | `POST /inventory/prescription-search` エンドポイント追加 |
| `server/src/routes/search.ts` | `/search/drug-master` のレスポンスに `id`（→ チップの drugMasterId）, `genericName`, `specification` 追加 |

### フロントエンド（変更）

| ファイル | 変更内容 |
|---------|---------|
| `client/src/pages/InventoryBrowsePage.tsx` | マトリクス表示に全面改修 |
| `client/src/components/SearchInput.tsx` | チップ形式の薬剤追加対応 |

### フロントエンド（新規）

| ファイル | 内容 |
|---------|------|
| `client/src/components/inventory/PrescriptionSearchForm.tsx` | 検索フォーム（チップ + フィルタ + バーコード） |
| `client/src/components/inventory/PharmacySummaryCards.tsx` | サマリカード一覧 |
| `client/src/components/inventory/InventoryMatrix.tsx` | マトリクス表 |
| `client/src/components/inventory/InventoryMatrixCell.tsx` | マトリクスセル（メーカー・薬価・数量） |

## テスト方針

### サーバー（ユニットテスト）

- `prescription-search-service.test.ts`:
  - 後発品グルーピング（genericName + specification 一致）
  - フィルタ（groupOnly, openOnly, favoritePriority）
  - ソート（充足数 → 薬価 → 距離）
  - ブロック薬局除外
  - drugKeys 上限バリデーション
- `inventory.test.ts` 追加: POST /prescription-search の統合テスト（正常系、バリデーション、認証）

### サーバー（PGlite 統合テスト）

- `prescription-search-integration.test.ts`:
  - genericName NULL → drugEquivalences テキストマッチ → 正規化マッチのフォールバックチェーン
  - deadStockItems.drugMasterId = NULL の在庫が補助パスで検出されること
  - マルチグループ所属時の groupOnly フィルタ
  - フィクスチャ: drugMaster + drugEquivalences + deadStockItems + pharmacies + groupMembers

### クライアント

- `InventoryBrowsePage.test.tsx`: マトリクス表示、フィルタ切替、提案送信遷移
- `PrescriptionSearchForm.test.tsx`: チップ追加/削除、バーコード連携
- `InventoryMatrix.test.tsx`: セル表示、スティッキーヘッダー

## エッジケース

| ケース | 対応 |
|--------|------|
| genericName が NULL | drugEquivalences テキストマッチ → drugName 正規化マッチにフォールバック |
| 検索結果0件 | 「在庫が見つかりませんでした」表示 + フィルタ緩和の提案 |
| 薬剤1つだけで検索 | マトリクス1列で表示（UIは統一） |
| 薬剤10品目（上限） | API で最大10件制限。UI でも10件超の追加を防止 |
| 同一成分で規格違い | specification で区別（別列） |
| グループ未所属で「グループ内のみ」 | フィルタ非活性化 + ツールチップ説明 |
| deadStockItems.drugMasterId が NULL | 補助パスで drugName テキストマッチにフォールバック |
| 座標未設定の薬局 | distance = null、ソートで末尾配置 |
| 同一薬局が複数グループに所属 | グループ和集合で重複除去（DISTINCT） |
| レスポンスサイズ | 薬局上限50件（充足スコア上位） |

## スコープ外（将来検討）

- 調剤実績ベースの在庫推定
- 処方せんOCR読み取り
- リアルタイム在庫同期（WebSocket）
- 検索履歴の保存・再利用
