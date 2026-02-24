# 医薬品マスター管理機能 実装計画

## 概要
現在Excelアップロードで個別に薬品情報を登録しているが、管理者ページ内の「医薬品マスター管理」をSSoT（Single Source of Truth）とする。厚生労働省の薬価基準収載品目リストから自動取得し、GS1コード・YJコードを含む全包装単位に対応する。

---

## Phase 1: データベーススキーマ設計

### 新規テーブル

#### 1. `drug_master` — 医薬品マスター本体
| カラム | 型 | 説明 |
|--------|------|------|
| id | serial PK | |
| yj_code | text UNIQUE NOT NULL | YJコード（12桁、薬価基準収載医薬品コード） |
| drug_name | text NOT NULL | 品名（例: アムロジピン錠5mg「サワイ」） |
| generic_name | text | 一般名（成分名） |
| specification | text | 規格（例: 5mg1錠） |
| unit | text | 単位（錠, mL, g 等） |
| yakka_price | real NOT NULL | 現行薬価 |
| manufacturer | text | メーカー名 |
| category | text | 区分（内用薬/外用薬/注射薬/歯科用薬剤） |
| therapeutic_category | text | 薬効分類番号 |
| is_listed | boolean DEFAULT true | 薬価基準収載中 |
| listed_date | text | 収載日 |
| transition_deadline | text | 経過措置期限（削除予定品の猶予期限） |
| deleted_date | text | 削除日（削除済みの場合） |
| created_at | timestamp | |
| updated_at | timestamp | |

インデックス: `yj_code` (unique), `drug_name` (検索用), `is_listed`, `(is_listed, drug_name)`

#### 2. `drug_master_packages` — 包装単位マスター
| カラム | 型 | 説明 |
|--------|------|------|
| id | serial PK | |
| drug_master_id | integer FK → drug_master.id | |
| gs1_code | text | GS1コード（14桁、販売包装単位） |
| jan_code | text | JANコード（13桁） |
| hot_code | text | HOTコード（9〜13桁） |
| package_description | text | 包装説明（例: 100錠(10錠×10)PTP） |
| package_quantity | real | 包装内数量 |
| package_unit | text | 包装単位 |
| created_at | timestamp | |
| updated_at | timestamp | |

インデックス: `drug_master_id`, `gs1_code`, `jan_code`, `hot_code`

#### 3. `drug_master_price_history` — 薬価改定履歴
| カラム | 型 | 説明 |
|--------|------|------|
| id | serial PK | |
| yj_code | text NOT NULL | |
| previous_price | real | 改定前薬価 |
| new_price | real | 改定後薬価 |
| revision_date | text NOT NULL | 改定日 |
| revision_type | text NOT NULL | 種別: price_revision / new_listing / delisting / transition |
| created_at | timestamp | |

インデックス: `yj_code`, `revision_date`

#### 4. `drug_master_sync_logs` — 同期ログ
| カラム | 型 | 説明 |
|--------|------|------|
| id | serial PK | |
| sync_type | text NOT NULL | manual / auto |
| source_description | text | データソースの説明 |
| status | text NOT NULL | running / success / failed / partial |
| items_processed | integer DEFAULT 0 | |
| items_added | integer DEFAULT 0 | |
| items_updated | integer DEFAULT 0 | |
| items_deleted | integer DEFAULT 0 | |
| error_message | text | |
| started_at | timestamp | |
| completed_at | timestamp | |
| triggered_by | integer FK → pharmacies.id | 実行した管理者 |

**ファイル変更:**
- `server/src/db/schema.ts` — 4テーブル追加
- `server/drizzle/` — 新しいマイグレーションファイル生成（`npx drizzle-kit generate`）

---

## Phase 2: サーバーサイド — 医薬品マスターサービス

### `server/src/services/drug-master-service.ts`

#### 機能:
1. **厚生労働省データ取得・パース**
   - MHLW薬価基準収載品目リスト（Excel/CSV）をダウンロード・パース
   - 取得先URL: `https://www.mhlw.go.jp/topics/[year]/04/tp[date]-01.html` 系
   - Excel形式（.xlsx）のパース（既存の`read-excel-file`ライブラリを流用）
   - CSVパースも対応

2. **手動アップロード対応**
   - 管理者がMHLWサイトからダウンロードしたExcel/CSVを直接アップロード
   - フォーマット自動検出（MHLW標準フォーマット対応）

3. **同期処理** (`syncDrugMaster()`)
   - パースしたデータとDBの差分を計算
   - 新規品目 → INSERT + 価格履歴に「new_listing」記録
   - 薬価変更 → UPDATE + 価格履歴に「price_revision」記録
   - 削除品目 → is_listed=false + 価格履歴に「delisting」記録
   - 経過措置品目 → transition_deadline更新
   - バッチ処理（500件ずつ）
   - 同期ログに結果を記録

4. **コード検索** (`lookupByCode()`, `searchByName()`)
   - YJコード、GS1コード、JANコード、HOTコードからの検索
   - 薬品名での部分一致検索（ひらがな/カタカナ変換対応）

5. **薬価取得** (`getYakkaPrice()`)
   - コードまたは薬品名から現行薬価を取得
   - dead_stock_items登録時のyakka_unit_price自動補完に使用

---

## Phase 3: サーバーサイド — 管理者APIエンドポイント

### `server/src/routes/drug-master.ts`

| メソッド | パス | 機能 |
|----------|------|------|
| GET | `/admin/drug-master` | 医薬品マスター一覧（ページネーション・検索） |
| GET | `/admin/drug-master/stats` | 統計情報（総数、収載中数、削除済数、最終同期日） |
| GET | `/admin/drug-master/:yjCode` | 医薬品詳細（包装単位・価格履歴含む） |
| POST | `/admin/drug-master/sync` | 手動同期（アップロードされたファイルからDB更新） |
| GET | `/admin/drug-master/sync-logs` | 同期ログ一覧 |
| PUT | `/admin/drug-master/:yjCode` | 個別編集（管理者による手動修正） |
| POST | `/admin/drug-master/upload-packages` | 包装単位データ一括登録（GS1/JAN/HOTコード） |

### `server/src/routes/search.ts` への追加

| メソッド | パス | 機能 |
|----------|------|------|
| GET | `/search/drug-master` | 医薬品マスターからのサジェスト検索（一般ユーザー向け） |

**登録元:**
- `server/src/app.ts` — drug-masterルートの登録

---

## Phase 4: アップロードフローとの統合

### `server/src/services/data-extractor.ts` の拡張

1. **drug_code → 医薬品マスター照合**
   - Excelアップロード時、`drug_code`列がある場合にdrug_masterと照合
   - YJコード、GS1コード、JANコードいずれかでマッチ
   - マッチした場合:
     - `yakka_unit_price`が空なら医薬品マスターの薬価を自動補完
     - `drug_name`が空なら医薬品マスターの品名を自動補完
     - `unit`が空なら医薬品マスターの単位を自動補完

2. **drug_name → 医薬品マスター照合**
   - drug_codeがない場合、drug_nameでファジーマッチ
   - 完全一致 → 自動補完
   - 部分一致（閾値以上） → 候補として返す

3. **dead_stock_items / used_medication_items にdrug_master_idカラム追加**
   - 医薬品マスターとの紐付けFK（nullable、後方互換性のため）
   - マッチング精度向上に利用

---

## Phase 5: クライアントサイド — 管理者UI

### `client/src/pages/admin/AdminDrugMasterPage.tsx`

#### レイアウト:
1. **ヘッダー部**
   - 統計カード: 総品目数 / 収載中 / 経過措置中 / 削除済 / 最終同期日時

2. **操作部**
   - 「ファイルから同期」ボタン → ファイル選択ダイアログ
   - 「URLから取得」ボタン → MHLW URLを指定して自動取得（将来拡張）
   - 「包装単位データ登録」ボタン → GS1/JANコードCSVアップロード

3. **検索・フィルター部**
   - テキスト検索（品名/YJコード/成分名）
   - フィルター: 収載状態（全て/収載中/経過措置中/削除済）
   - フィルター: 区分（内用薬/外用薬/注射薬/歯科用薬剤）

4. **一覧テーブル**
   - カラム: YJコード, 品名, 成分名, 規格, 薬価, 単位, メーカー, 状態
   - ページネーション
   - 行クリック → 詳細モーダル

5. **詳細モーダル**
   - 基本情報の表示・編集
   - 包装単位一覧（GS1コード, JANコード, 包装説明）
   - 薬価改定履歴タイムライン

6. **同期ログセクション**
   - 直近の同期ログ5件表示
   - 詳細: 処理件数/追加/更新/削除/エラー

### ルーティング追加:
- `client/src/App.tsx` — `/admin/drug-master` ルート追加
- `client/src/components/Sidebar.tsx` — 管理者メニューに「医薬品マスター」リンク追加

---

## Phase 6: 既存検索機能の拡張

### `server/src/routes/search.ts`

- 既存の`/search/drugs`エンドポイントを拡張
- dead_stock_items のdrug_nameだけでなく、drug_masterからも候補を返す
- drug_masterの品名がマッチした場合、薬価情報も付与

---

## 実装順序

1. **Phase 1**: スキーマ追加 + マイグレーション生成
2. **Phase 2**: drug-master-service.ts（パーサー + 同期ロジック）
3. **Phase 3**: API エンドポイント
4. **Phase 5**: 管理者UI（基本一覧 + 検索 + 同期機能）
5. **Phase 4**: アップロードフロー統合（drug_master_id紐付け + 自動補完）
6. **Phase 6**: 検索機能拡張

---

## ファイル変更一覧

### 新規ファイル
- `server/src/services/drug-master-service.ts`
- `server/src/routes/drug-master.ts`
- `client/src/pages/admin/AdminDrugMasterPage.tsx`
- `server/drizzle/0001_*.sql` (自動生成)

### 変更ファイル
- `server/src/db/schema.ts` — 4テーブル追加 + dead_stock_items/used_medication_itemsにdrug_master_id追加
- `server/src/app.ts` — drug-masterルート登録
- `server/src/routes/admin.ts` — stats にマスター関連統計追加
- `server/src/routes/search.ts` — drug_masterからの検索追加
- `server/src/services/data-extractor.ts` — マスター照合ロジック追加
- `server/src/routes/upload.ts` — アップロード時のマスター照合
- `server/src/types/index.ts` — 新規型定義
- `client/src/App.tsx` — ルート追加
- `client/src/components/Sidebar.tsx` — サイドバーリンク追加
