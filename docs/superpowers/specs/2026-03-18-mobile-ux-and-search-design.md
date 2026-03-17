# Mobile UX Gesture + Search Enhancement Design

> Date: 2026-03-18
> Status: Draft
> Version: v0.0.16

## Overview

2つの独立した機能を同時並行で実装する:
- **機能A**: モバイルジェスチャーUX（中程度）
- **機能B**: 検索AND検索 + ベストプラクティス適用

---

## 機能A: モバイルジェスチャーUX

### 方針

外部ライブラリを追加せず、**Touch API ベースのカスタムフック**で実装する。
理由: バンドルサイズ抑制、プロジェクトの React Bootstrap 基盤との整合性、依存ゼロ。

### A-1: プルトゥリフレッシュ

**対象画面**: DeadStockListPage, MatchingPage, AlertListPage, ProposalsPage, InventoryBrowsePage

**実装**:
- `usePullToRefresh(onRefresh: () => Promise<void>)` カスタムフック
- Touch start/move/end イベントでスクロール位置が最上部の場合のみ発動
- 引っ張り量に応じたインジケーター表示（回転アイコン）
- 閾値: 60px 以上で発動
- `<PullToRefresh>` ラッパーコンポーネントとして提供
- モバイルのみ発動（`window.matchMedia('(max-width: 991.98px)')` で判定、既存の `APP_RESPONSIVE_MOBILE_QUERY` を再利用）
- **`overscroll-behavior-y: contain`** をスクロールコンテナに設定し、ブラウザネイティブのプルトゥリフレッシュと競合しないようにする
- touchmove ハンドラは `requestAnimationFrame` でスロットルし、レイアウトスラッシングを防止

**UX**:
```
[通常状態] → 下に引っ張る → [インジケーター表示] → 閾値超え → [リリースで更新]
                                                    → 閾値未満 → [キャンセル]
```

### A-2: リストアイテムスワイプアクション

**対象画面と操作**:

| 画面 | 左スワイプ | 右スワイプ |
|------|-----------|-----------|
| マッチング候補 | 拒否（赤） | 承認（緑） |
| 通知リスト | 既読にする（青） | — |
| 提案リスト | 詳細を見る（青） | — |

**実装**:
- `useSwipeAction(options)` カスタムフック
- `<SwipeableListItem>` コンポーネント
  - スワイプ方向に応じた背景色+アイコンを表示
  - スワイプ閾値: アイテム幅の20%（最小60px、最大100px）で確定、それ未満でスナップバック
  - `transform: translateX()` + `transition` でアニメーション
  - タッチ中は `will-change: transform` で GPU アクセラレーション
- 水平スクロールとの競合防止: 角度判定（水平 ±30度以内のみスワイプ認識）

**Props**:
```typescript
interface SwipeableListItemProps {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftContent?: ReactNode;   // 左スワイプ時に右側に表示される背景
  rightContent?: ReactNode;  // 右スワイプ時に左側に表示される背景
  threshold?: number;        // デフォルト: アイテム幅の20%（最小60px、最大100px）
  children: ReactNode;
}
```

### A-3: ページ間スワイプナビゲーション

**対象**: MobileBottomNav の5タブ間（Home, Matching, Proposals, Alerts, Groups）

**実装**:
- `usePageSwipe(routes: string[], currentIndex: number)` カスタムフック
- メインコンテンツエリアで左右スワイプを検出
- 左スワイプ → 次のタブ、右スワイプ → 前のタブ
- React Router `useNavigate()` でページ遷移
- エッジ（最初/最後のタブ）ではバウンスエフェクト

**競合回避の設計**:

SwipeableListItem とページスワイプの競合は多層で解決する:

1. **CSS `touch-action` 制御**: SwipeableListItem に `touch-action: pan-y` を設定し、水平スワイプをブラウザのデフォルトナビゲーション（Android の戻る/進む）から分離
2. **イベントバブリング制御**: SwipeableListItem が水平スワイプを検出した場合、カスタムフラグ `data-swipe-active` を設定。ページスワイプフックはこのフラグが立っている間は無視
3. **スワイプ開始位置**: 画面端20px以内から始まるスワイプはページスワイプ候補としない（ブラウザのback/forward gestureとの競合回避）
4. **最小移動距離**: ページスワイプは最低120pxの水平移動 + 300ms以内の完了で発動（誤爆防止）

```
Touch start
  ├── SwipeableListItem 内 → data-swipe-active=true → リストアイテムスワイプ
  ├── 画面端20px以内 → 無視（ブラウザジェスチャーに委譲）
  └── その他の領域 → ページスワイプ判定（120px + 300ms 閾値）
```

### A-4: ピンチズーム詳細表示

**対象**: 薬品詳細モーダル、提案詳細ページの薬品情報カード

**実装**:
- `usePinchZoom()` カスタムフック
- 2本指タッチで `scale` を計算、`transform: scale()` 適用
- 最小 1x、最大 3x
- ダブルタップでトグル（1x ↔ 2x）
- ズーム中はパン（ドラッグ移動）対応
- ズームコンテナに `overflow: auto` を設定し、拡大時にコンテンツがはみ出てもスクロールで到達可能にする
- リセットボタン（×アイコン）を表示し、ズーム状態からワンタップで1xに戻れるようにする

---

## 機能B: 検索機能拡張

### B-1: スペース区切りAND検索

**現状**: 検索クエリを単一の文字列として LIKE 検索
**改善**: スペースで分割し、各トークンをAND条件で結合

**ロジック**:
```
入力: "アムロジピン サワイ"
  ↓ スペース分割
トークン: ["アムロジピン", "サワイ"]
  ↓ 各トークンにカナ正規化
トークン0: { original: "アムロジピン", hiragana: "あむろじぴん", katakana: "アムロジピン" }
トークン1: { original: "サワイ", hiragana: "さわい", katakana: "サワイ" }
  ↓ SQL条件生成
WHERE
  (drugName ILIKE '%アムロジピン%' OR drugName ILIKE '%あむろじぴん%'
   OR genericName ILIKE '%アムロジピン%' OR genericName ILIKE '%あむろじぴん%'
   OR manufacturer ILIKE '%アムロジピン%' OR manufacturer ILIKE '%あむろじぴん%')
  AND
  (drugName ILIKE '%サワイ%' OR drugName ILIKE '%さわい%'
   OR genericName ILIKE '%サワイ%' OR genericName ILIKE '%さわい%'
   OR manufacturer ILIKE '%サワイ%' OR manufacturer ILIKE '%さわい%')
```

**実装箇所**:
- `server/src/utils/search-utils.ts`（新規）に `buildTokenizedSearchConditions()` 関数を追加
- 全検索エンドポイントで統一利用:
  - `/search/drugs` — drugName 検索（deadStockItems テーブル）
  - `/search/drug-master` — drugName + genericName + manufacturer 検索（drugMaster テーブル）
  - `/inventory/browse` — drugName 検索（deadStockItems テーブル。manufacturer は deadStockItems に存在しないため対象外）
  - `/admin/drug-master/` — drugName + genericName + manufacturer + yjCode 検索（drugMaster テーブル）
  - `/dead-stock/` — drugName 検索（deadStockItems テーブル。現在検索未実装のため新規追加）

**注意**: `deadStockItems` テーブルには `manufacturer` カラムが存在しない。manufacturer 検索は `drugMaster` テーブルを持つエンドポイントのみで有効。将来的に deadStockItems → drugMaster の JOIN で manufacturer 検索を拡張可能だが、パフォーマンス影響があるため現時点ではスコープ外とする。

### B-2: ベストプラクティス適用

#### a) ILIKE 統一（大文字小文字無視）

現在 `like()` と `ilike()` が混在 → 全検索エンドポイントを `ilike()` に統一。
英字の薬品コード（YJコード等）で大文字小文字を区別しないようにする。

#### b) manufacturer フィールドを検索対象に追加

現在 drugName + genericName のみ → manufacturer も検索対象に追加。
「サワイ」「第一三共」等のメーカー名でヒットするようになる。

#### c) 検索ユーティリティの共通化

各エンドポイントで重複していた検索条件構築ロジックを `buildTokenizedSearchConditions()` に集約:

```typescript
// server/src/utils/search-utils.ts (新規)
export function buildTokenizedSearchConditions(
  query: string,
  columns: AnyColumn[],
): SQL | undefined {
  const tokens = tokenizeQuery(query);  // 半角+全角スペース分割 + 空文字除去 + 最大5トークン
  if (tokens.length === 0) return undefined;

  const tokenConditions = tokens.map(token => {
    const kanaVariants = buildKanaVariants(token); // ひらがな/カタカナ/正規化
    const columnConditions = columns.flatMap(col =>
      kanaVariants.map(variant => ilike(col, `%${escapeLikeWildcards(variant)}%`))
    );
    return or(...columnConditions);  // 1トークン: いずれかのカラム × いずれかのカナ
  });

  return and(...tokenConditions);  // トークン間はAND
}
```

#### d) 全角/半角英数字の正規化

`normalizeKana()` に全角英数字→半角変換を追加。
例: `１０ｍｇ` → `10mg` で検索可能に。

#### e) 全角スペースのトークン区切り対応

`tokenizeQuery()` は半角スペース（U+0020）と全角スペース（U+3000）の両方をトークン区切りとして扱う。日本語IMEでは全角スペースが入力されやすいため。

#### f) トークン数制限

DoS防止のため最大5トークンに制限。6個目以降は無視。

#### g) ILIKE パフォーマンスに関する注意

`ILIKE '%term%'` は先頭ワイルドカードのためB-treeインデックスを使用できない（現状の `LIKE` も同様）。現在のデータ量（数万件規模）では問題ないが、将来的にパフォーマンス劣化が見られた場合は `pg_trgm` 拡張のGINインデックス導入を検討する。

### B-3: フロントエンド改善

- 検索ボックスのプレースホルダーを更新: `"薬品名 メーカー名で検索"` のようにスペース区切りが使えることを示唆
- SearchInput コンポーネントの suggestion API もトークン検索対応（フロントエンドは生の検索文字列をそのまま送信、トークン分割はサーバー側で処理）

---

## 変更対象ファイル

### 機能A（ジェスチャー）

| ファイル | 変更内容 |
|---------|---------|
| `client/src/hooks/usePullToRefresh.ts` | 新規: Pull-to-Refresh フック |
| `client/src/hooks/useSwipeAction.ts` | 新規: スワイプアクションフック |
| `client/src/hooks/usePageSwipe.ts` | 新規: ページ間スワイプフック |
| `client/src/hooks/usePinchZoom.ts` | 新規: ピンチズームフック |
| `client/src/components/gesture/PullToRefresh.tsx` | 新規: ラッパーコンポーネント |
| `client/src/components/gesture/SwipeableListItem.tsx` | 新規: スワイプ可能リストアイテム |
| `client/src/styles/sections/gesture.css` | 新規: ジェスチャーUI用スタイル |
| `client/src/pages/DeadStockListPage.tsx` | PullToRefresh 適用 |
| `client/src/pages/MatchingPage.tsx` | PullToRefresh + SwipeableListItem 適用 |
| `client/src/pages/AlertListPage.tsx` | PullToRefresh + SwipeableListItem 適用 |
| `client/src/pages/ProposalsPage.tsx` | PullToRefresh + SwipeableListItem 適用 |
| `client/src/pages/InventoryBrowsePage.tsx` | PullToRefresh 適用 |
| `client/src/components/Layout.tsx` | ページスワイプ統合 |

### 機能B（検索）

| ファイル | 変更内容 |
|---------|---------|
| `server/src/utils/search-utils.ts` | 新規: 検索条件構築ユーティリティ |
| `server/src/utils/kana-utils.ts` | 全角半角正規化追加 |
| `server/src/routes/search.ts` | 共通ユーティリティに移行 |
| `server/src/routes/inventory.ts` | 共通ユーティリティに移行 |
| `server/src/routes/drug-master-crud.ts` | 共通ユーティリティに移行 |
| `server/src/routes/dead-stock.ts` | 検索条件更新 |
| `client/src/components/SearchInput.tsx` | プレースホルダー更新 |

### テスト

| ファイル | 内容 |
|---------|------|
| `server/src/test/utils/search-utils.test.ts` | 新規: トークン検索ユニットテスト |
| `server/src/test/utils/kana-utils.test.ts` | 全角半角正規化テスト追加 |
| `client/src/__tests__/hooks/usePullToRefresh.test.ts` | 新規 |
| `client/src/__tests__/hooks/useSwipeAction.test.ts` | 新規 |
| `client/src/__tests__/hooks/usePageSwipe.test.ts` | 新規 |
| `client/src/__tests__/hooks/usePinchZoom.test.ts` | 新規 |
| `client/src/__tests__/components/gesture/SwipeableListItem.test.tsx` | 新規 |
| `client/src/__tests__/components/gesture/PullToRefresh.test.tsx` | 新規 |

---

## 非スコープ（YAGNI）

- PostgreSQL Full-Text Search (tsvector/tsquery) — 日本語FTSはpg_bigm等の拡張が必要、Neonでの利用制限あり。ILIKE + トークンAND検索で十分な精度が得られる
- 検索履歴の保存 — 現時点では不要
- ファジー検索（Levenshtein距離） — 入力ミス補正は将来検討
- ハプティクスフィードバック — ブラウザサポートが限定的
- ロングプレスメニュー — スコープ外（レベル3）
- 3Dタッチ — iOS限定でWeb未対応

---

## 実装順序

機能BとAは独立しているため並行実装可能。

**機能B（検索）**: 2フェーズ
1. B-1 + B-2: サーバー側検索ロジック（共通ユーティリティ + 全エンドポイント統一）
2. B-3: フロントエンド検索UX更新

**機能A（ジェスチャー）**: 4フェーズ
1. A-1: PullToRefresh（基盤フック + 5画面適用）
2. A-2: SwipeableListItem（3画面適用）
3. A-3: ページ間スワイプ
4. A-4: ピンチズーム
