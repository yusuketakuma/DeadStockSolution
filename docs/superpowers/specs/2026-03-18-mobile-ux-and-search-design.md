# Mobile UX Gesture + Search Enhancement Design

> Date: 2026-03-18
> Status: Draft (Rev.2 — multi-angle review reflected)
> Version: v0.0.16

## Overview

2つの独立した機能を同時並行で実装する:
- **機能A**: モバイルジェスチャーUX（中程度）
- **機能B**: 検索AND検索 + ベストプラクティス適用

---

## 共通設計原則

### アクセシビリティ (a11y)

- **ジェスチャーはプログレッシブエンハンスメント**: すべてのスワイプ操作には必ずボタンフォールバックを用意する（WCAG 2.1 SC 2.5.1 準拠）。既存のアクションボタンは削除せず、スワイプは追加の操作手段として提供
- **`prefers-reduced-motion`**: すべてのジェスチャーアニメーションは `prefers-reduced-motion: reduce` を検出し、spatial movement を無効化（即座の状態変更 or 最小限のフェードに置き換え）
- **`aria-live` リージョン**: Pull-to-Refresh 完了時・スワイプアクション実行時に `aria-live="polite"` で状態変更を通知（例: 「リスト更新完了、12件」「マッチング拒否しました。5秒以内に取り消し可能」）

### パフォーマンス共通

- すべてのフックの `useEffect` は cleanup でリスナー除去 + `cancelAnimationFrame` を実行（React 18 StrictMode の double-mount 対応）
- `will-change: transform` はアクティブにスワイプ中のアイテムのみに ref/state で適用。リスト全体には適用しない（GPU メモリ節約）
- `touchmove` ハンドラで `preventDefault()` を使う場合は `{ passive: false }` を明示指定（モダンブラウザはデフォルト passive のため）

### ジェスチャーのディスカバビリティ

- **初回利用コーチング**: スワイプ対応画面に初めてアクセスした際、矢印アニメーション付きのオーバーレイヒントを表示（「左にスワイプして拒否、右にスワイプして承認」）。dismissable で、localStorage に表示済みフラグを保存
- **ビジュアルアフォーダンス**: SwipeableListItem のカードエッジにわずかな色のぞき見（peek）を常時表示し、スワイプ可能であることを視覚的に示唆

---

## 機能A: モバイルジェスチャーUX

### 方針

A-1〜A-3 は**Touch API ベースのカスタムフック**で実装（依存ゼロ）。
A-4（ピンチズーム）は `@use-gesture/react`（~4KB gzip）を使用。理由: ピンチ + パン + ダブルタップのエッジケース処理が複雑で、2コンポーネントのために自前実装するメンテコストに見合わない。

### A-1: プルトゥリフレッシュ

**対象画面**: DeadStockListPage, MatchingPage, AlertListPage, ProposalsPage, InventoryBrowsePage

**スクロールコンテナの特定**:
- デスクトップ（992px+）: `.page-scroll-area`（`overflow-y: auto`）
- モバイル（991.98px以下）: `document.documentElement`（body スクロール）
- フックは最も近いスクロール可能な祖先を `getComputedStyle` で探索するか、明示的に `scrollRef` を受け取る

**実装**:
- `usePullToRefresh(options: { onRefresh, scrollRef?, threshold? })` カスタムフック
- Touch start/move/end イベントでスクロール位置が最上部の場合のみ発動（iOS の負の `scrollTop` も考慮）
- 閾値: **80px** 以上で発動（薬局スタッフの手袋着用を考慮し、60px から引き上げ）
- `<PullToRefresh>` ラッパーコンポーネントとして提供
- モバイルのみ発動（既存の `APP_RESPONSIVE_MOBILE_QUERY` を再利用）
- **`overscroll-behavior-y: contain`** をスクロールコンテナに設定
- touchmove ハンドラは `requestAnimationFrame` でスロットル
- `{ passive: false }` で touchmove を登録（`preventDefault()` でネイティブ pull-to-refresh を抑制）
- **リフレッシュ中の二重実行防止**: `isRefreshing` フラグで実行中は新規リフレッシュを無視

**3つのビジュアルステート**:
```
1. [Pulling]    → インジケーター表示 + 引っ張り距離のフィードバック（アイコン回転角度）
2. [Refreshing] → スピナー持続表示 + "更新中..." テキスト
3. [Complete]   → 短い成功インジケーター（チェックマーク 500ms）→ 非表示
```

**ページ別 onRefresh コールバック**:

| ページ | コールバック | 注意 |
|--------|------------|------|
| DeadStockListPage | `refetch()` (useApiQuery) | react-query の in-flight チェック済み |
| MatchingPage | `handleSearch()` | **初回検索実行後のみ有効**（`searched === true` 時）。未検索時は pull-to-refresh を無効化 |
| AlertListPage | `fetchAlerts()` | 手動 useState ベース |
| ProposalsPage | `fetchProposals()` | 手動 useState ベース |
| InventoryBrowsePage | `refetch()` (useApiQuery) | react-query の in-flight チェック済み |

**ページネーションとの関係**: Pull-to-refresh は**現在のページを再取得**する。ページ番号はリセットしない。

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
  - **AppResponsiveSwitch の mobile ブランチ内でのみ使用**。desktop の `<tr>` 行には適用しない
  - DOM 構造: `SwipeableListItem > AppMobileDataCard`
  - スワイプ方向に応じた背景色+アイコンを表示（背景アクションエリアは最小 48x48dp タッチターゲット準拠）
  - スワイプ閾値: アイテム幅の20%（最小60px、最大100px）で確定、それ未満でスナップバック
  - **速度ゲーティング**: 低速スワイプ（< 0.3px/ms）はより長い距離（幅の30%）を要求。高速フリック（≥ 0.5px/ms）は幅の15%で確定
  - `transform: translateX()` + `transition` でアニメーション
  - `will-change: transform` はアクティブスワイプ中のアイテムのみに適用（ref ベース）
  - `touch-action: pan-y` を設定（水平スワイプをブラウザジェスチャーから分離）
- 水平スクロールとの競合防止: 角度判定（水平 ±30度以内のみスワイプ認識）

**破壊的アクションの Undo**:
- マッチング拒否・承認のスワイプ実行後、**Undo トースト（5秒間）**を表示
- アクションは Undo ウィンドウが閉じるまでサーバーに送信しない（楽観的 UI + 遅延実行）
- トースト: 「マッチングを拒否しました [取り消し]」
- `aria-live="assertive"` でスクリーンリーダーに通知

**Props**:
```typescript
interface SwipeableListItemProps {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftContent?: ReactNode;   // 左スワイプ時に右側に表示される背景
  rightContent?: ReactNode;  // 右スワイプ時に左側に表示される背景
  threshold?: number;        // デフォルト: アイテム幅の20%
  undoDuration?: number;     // Undo トースト表示秒数（デフォルト 5000ms、0 で無効）
  children: ReactNode;
}
```

### A-3: ページ間スワイプナビゲーション

**対象**: MobileBottomNav の5タブ間（Home, Matching, Proposals, Alerts, Groups）

**実装**:
- `usePageSwipe(currentIndex: number)` カスタムフック
- ルート配列は `MobileBottomNav` の `NAV_ITEMS` をエクスポートして再利用（重複排除）
- メインコンテンツエリアで左右スワイプを検出
- 左スワイプ → 次のタブ、右スワイプ → 前のタブ
- React Router `useNavigate()` でページ遷移
- エッジ（最初/最後のタブ）ではバウンスエフェクト
- **速度ベース閾値**: 最低120pxの水平移動 OR 0.5px/ms 以上の速度（時間制限は撤廃。500ms の遅いスワイプでも速度が十分なら発動）

**競合回避の設計（5層）**:

1. **CSS `touch-action` 制御**: SwipeableListItem に `touch-action: pan-y` を設定
2. **`data-swipe-active` フラグ**: SwipeableListItem が水平スワイプ検出時にセット → ページスワイプは無視
3. **画面端除外**: 画面端20px以内からのスワイプは無視（ブラウザの back/forward gesture に委譲）
4. **水平スクロールコンテナ除外**: `.table-responsive` や `overflow-x: auto` を持つ要素内のタッチはページスワイプ対象外
5. **モーダル/Offcanvas/フォーム除外**: Sidebar Offcanvas が開いている間（`sidebarOpen === true`）、モーダル表示中、input にフォーカス中はページスワイプを無効化

```
Touch start
  ├── SwipeableListItem 内 → data-swipe-active → リストスワイプ優先
  ├── .table-responsive 内 → 無視（水平スクロールに委譲）
  ├── 画面端20px以内 → 無視（ブラウザジェスチャーに委譲）
  ├── Offcanvas/Modal 表示中 → 無視
  ├── input/textarea フォーカス中 → 無視
  └── その他 → ページスワイプ判定（120px or 0.5px/ms）
```

**iOS Safari の制約**: iOS Safari の左端スワイプバック gesture は JS/CSS で抑制不可。画面端除外 + ドキュメントへの注記で対応。実機テストで検証必須。

### A-4: ピンチズーム詳細表示

**対象**: 薬品詳細モーダル、提案詳細ページの薬品情報カード

**実装**:
- `@use-gesture/react` の `usePinchGesture` + `useDragGesture` を使用
- 2本指タッチで `scale` を計算、`transform: scale()` 適用
- 最小 1x、最大 3x
- ダブルタップでトグル（1x ↔ 2x）
- ズーム中はパン（ドラッグ移動）対応
- ズームコンテナに `overflow: auto` を設定
- リセットボタンは **viewport に対して position: fixed** で表示（ズームしてもスクロールアウトしない）
- ブラウザネイティブのピンチズーム（`<meta viewport>` の `user-scalable`）は**抑制しない**（WCAG 1.4.4 準拠）

---

## 機能B: 検索機能拡張

### B-1: スペース区切りAND検索

**現状**: 検索クエリを単一の文字列として LIKE 検索
**改善**: スペースで分割し、各トークンをAND条件で結合

**ロジック**:
```
入力: "アムロジピン サワイ"
  ↓ 半角/全角スペース分割 + 空文字除去 + 最大5トークン + 最小2文字フィルタ
トークン: ["アムロジピン", "サワイ"]
  ↓ 各トークンにカナ正規化 + 全角半角正規化
トークン0: variants = ["アムロジピン", "あむろじぴん"] (+ original input)
トークン1: variants = ["サワイ", "さわい"] (+ original input)
  ↓ SQL条件生成（drugMaster テーブルの場合）
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
  - `/search/pharmacies` — name 検索（pharmacies テーブル。例: 「さくら 薬局」のAND検索）
  - `/inventory/browse` — drugName 検索（deadStockItems テーブル。manufacturer は存在しないため対象外）
  - `/admin/drug-master/` — drugName + genericName + manufacturer + yjCode 検索（drugMaster テーブル）
  - `/dead-stock/` — drugName 検索（deadStockItems テーブル。現在検索未実装のため新規追加）
  - `camera-dead-stock-service.ts` — drugMaster.drugName + genericName 検索（見落とし箇所、統一対象に追加）

**注意**: `deadStockItems` テーブルには `manufacturer` カラムが存在しない。manufacturer 検索は `drugMaster` テーブルを持つエンドポイントのみで有効。将来的に deadStockItems → drugMaster の JOIN で manufacturer 検索を拡張可能だが、パフォーマンス影響があるため現時点ではスコープ外とする。

### B-2: ベストプラクティス適用

#### a) ILIKE 統一（大文字小文字無視）

現在 `like()` と `ilike()` が混在 → 全検索エンドポイントを `ilike()` に統一。
英字の薬品コード（YJコード等）で大文字小文字を区別しないようにする。

**注意: これは動作変更**。現在 YJ コード検索で `f` は `F` にマッチしないが、ILIKE 統一後はマッチする。テストケースを更新すること。

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
  const tokens = tokenizeQuery(query);  // 半角+全角スペース分割 + 空文字除去 + 最大5トークン + 最小2文字
  if (tokens.length === 0) return undefined;

  const tokenConditions = tokens.map(token => {
    const kanaVariants = buildKanaVariants(token); // original + ひらがな + カタカナ + 全角半角正規化
    const columnConditions = columns.flatMap(col =>
      kanaVariants.map(variant => ilike(col, `%${escapeLikeWildcards(variant)}%`))
    );
    return or(...columnConditions);  // 1トークン: いずれかのカラム × いずれかのカナ
  });

  return and(...tokenConditions);  // トークン間はAND
}
```

**`buildKanaVariants` はオリジナル入力を含める**: `normalizeKana` → hiragana/katakana 変換に加え、元の入力文字列も `Set` に追加して重複排除。正規化で round-trip しないケースのフォールバック。

#### d) 全角/半角英数字の正規化

`normalizeKana()` に全角英数字→半角変換を追加。
例: `１０ｍｇ` → `10mg` で検索可能に。

**全角半角の非対称問題**: DB に `５ｍｇ`（全角）が格納されている場合、半角正規化した `5mg` では ILIKE マッチしない。対策として `buildKanaVariants` は**全角版と半角版の両方**をバリアントに含める。
例: 入力 `5mg` → variants = [`5mg`, `５ｍｇ`], 入力 `５ｍｇ` → variants = [`５ｍｇ`, `5mg`]

#### e) 全角スペースのトークン区切り対応

`tokenizeQuery()` は半角スペース（U+0020）と全角スペース（U+3000）の両方をトークン区切りとして扱う。日本語IMEでは全角スペースが入力されやすいため。

#### f) トークン数制限

DoS防止のため最大5トークンに制限。6個目以降は無視。
**UI フィードバック**: 6個目以降が無視された場合、検索結果上部に「最大5キーワードまで検索できます」の注意メッセージを表示。

#### g) 最小トークン長

1文字トークンは検索対象から除外（1文字の ILIKE は広範すぎてほぼ全件ヒットし、AND条件の効果を無効化する）。ただし数字1文字（`5` など）は規格番号の部分検索で有用なため除外しない。

#### h) ILIKE パフォーマンスに関する注意

`ILIKE '%term%'` は先頭ワイルドカードのためB-treeインデックスを使用できない（現状の `LIKE` も同様）。現在のデータ量（数万件規模）では問題ないが、将来的にパフォーマンス劣化が見られた場合は `pg_trgm` 拡張のGINインデックス導入を検討する（`manufacturer` カラムも含む）。

#### i) 既知の制約（長音記号）

長音記号 `ー`（U+30FC）はカタカナ→ひらがな変換で保持される。ユーザーが `コーワ` の代わりに `コオワ`（実母音展開）で検索した場合はマッチしない。これは日本語検索の既知の制約であり、現時点では対応しない。

### B-3: フロントエンド改善

- 検索ボックスのプレースホルダーを更新: `"薬品名 メーカー名で検索（スペース区切りで絞り込み）"` のように使い方を明示
- SearchInput コンポーネントの suggestion API もトークン検索対応（フロントエンドは生の検索文字列をそのまま送信、トークン分割はサーバー側で処理）
- **検索チップ表示**: 検索実行後、各トークンを個別のチップ（Badge）として表示。各チップに × ボタンで個別削除可能
- **エラー・空結果状態**: 検索結果0件時は「該当する薬品が見つかりません。キーワードを変えてお試しください」メッセージを表示

### B-4: インクリメンタルサーチ（リアルタイム結果更新）

**現状**: InventoryBrowsePage は Enter/ボタン押下で検索実行。AdminDrugMasterPage は Enter のみ。DeadStockListPage には検索自体がない。いずれもタイプ中にリスト結果がリアルタイム更新されない。

**改善**: タイプするたびにデバウンス後に結果を自動更新するインクリメンタルサーチを導入。

#### 設計

**`useIncrementalSearch` カスタムフック**:

```typescript
interface UseIncrementalSearchOptions {
  fetchFn: (query: string, page: number) => Promise<PaginatedResult>;
  debounceMs?: number;       // デフォルト 400ms
  minChars?: number;         // 検索開始最小文字数、デフォルト 2
  resetPageOnSearch?: boolean; // デフォルト true
}

interface UseIncrementalSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  results: T[];
  isSearching: boolean;      // デバウンス待ち or fetch 中
  pagination: PaginationInfo;
  clear: () => void;
}
```

**フロー**:
```
ユーザー入力
  ↓ onChange → setQuery()
  ↓ 400ms デバウンス（タイプ中はリセット）
  ↓ minChars チェック（2文字未満 → 全件表示に戻す）
  ↓ page を 1 にリセット
  ↓ fetchFn(query, 1) 実行
  ↓ AbortController で前回リクエストをキャンセル（race condition 防止）
  ↓ 結果をセット + isSearching = false
```

**キャンセル戦略**: 新しい入力が来たら前回の fetch を `AbortController.abort()` でキャンセル。サーバー側の不要なクエリ実行を防ぐ。

#### 対象画面と適用方法

| ページ | 現在 | インクリメンタルサーチ後 |
|--------|------|----------------------|
| InventoryBrowsePage | Enter/ボタンで検索 | タイプ中にリスト自動更新。Enter/ボタンも引き続き動作（即時実行） |
| AdminDrugMasterPage | Enter で検索 | タイプ中にリスト自動更新。フィルタ（status/category）変更時も即座に反映 |
| DeadStockListPage | 検索なし | **検索バーを新規追加** + インクリメンタルサーチ |

**Enter/ボタンとの共存**: インクリメンタルサーチ中でも Enter キーやボタン押下でデバウンスを待たず即時検索を実行する。ユーザーが「もう入力し終わった」と判断した場合のショートカット。

#### ローディングUX

- **インラインスピナー**: 検索バー右端に小さなスピナーアイコンを表示（`isSearching === true` 時）
- **結果エリアのフェード**: 新しい結果の取得中は現在のリストを `opacity: 0.6` にし、結果到着で `opacity: 1` に戻す（ちらつき防止のため、200ms 以内に完了した場合はフェードしない）
- **結果件数表示**: 「12件見つかりました」をリスト上部に表示

#### デバウンス最適化

| トークン数 | デバウンス | 理由 |
|-----------|-----------|------|
| 1トークン | 400ms | 入力中の可能性が高い |
| 2+トークン | 300ms | スペース入力 = 次のキーワードに移行、前のトークンは確定済み |

スペースが入力された時点で前のトークンは確定とみなし、デバウンスを短縮する。

#### サーバー側の考慮

- インクリメンタルサーチにより**リクエスト頻度が増加**する。対策:
  - フロントエンドの AbortController による不要リクエストキャンセル
  - サーバー側の既存レート制限（Express rate limiter）で過剰リクエストを防止
  - `minChars: 2` により1文字での全件スキャンを回避
  - 結果の `limit` はサジェスト用途なら 10 件、リスト更新なら既存のページサイズを維持

#### URL 同期

- 検索クエリを URL クエリパラメータ（`?search=...`）に反映
- ブラウザの戻る/進むで検索状態が復元される
- 共有可能なURL（例: `/inventory/browse?search=アムロジピン+サワイ`）
- `useSearchParams` (React Router) で実装

---

## 機能C: モバイルフィルター・ソート・バーコード検索

### C-1: モバイル用フィルターシート（BottomSheet）

**課題**: DeadStockListPage の期限フィルタ（ButtonGroup）やAdminDrugMasterPage のステータス/カテゴリフィルタはPC向けレイアウトのまま。モバイルでは画面幅を圧迫し、フィルタが折り返されて操作しにくい。

**対象画面**:

| ページ | 現在のフィルタ | BottomSheet 化 |
|--------|-------------|---------------|
| DeadStockListPage | 期限フィルタ（ButtonGroup: 全て/期限切れ/30日/60日/90日） | BottomSheet 内にラジオボタンリスト |
| InventoryBrowsePage | なし | BottomSheet でカテゴリ/期限フィルタを新規追加（将来拡張ポイント） |
| AdminDrugMasterPage | ステータス + カテゴリ（ドロップダウン×2） | BottomSheet 内にフィルタグループ |

**実装**:

`<MobileFilterSheet>` 汎用コンポーネント:
- 既存の `ScanResultSheet` のBottomSheet パターンを汎用化（`position: fixed`, ドラッグハンドル, `max-height: 60vh`）
- `AppResponsiveSwitch` の mobile ブランチでのみ表示
- デスクトップでは従来のインラインフィルタをそのまま維持
- フィルタ変更は即座に結果に反映（インクリメンタルサーチ B-4 と連携）

```typescript
interface MobileFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;          // フィルタコンテンツ
  activeFilterCount?: number;   // アクティブフィルタ数をバッジ表示
}
```

**トリガーUI**: 検索バー横にフィルターアイコンボタン（ファネルアイコン）。アクティブフィルタ数をバッジで表示。

```
[🔍 検索バー] [🔽 フィルタ (2)]
                    ↓ タップ
┌─────────────────────────────┐
│ ━━━ (ドラッグハンドル)       │
│ フィルタ                [×] │
│─────────────────────────────│
│ 期限                        │
│ ○ すべて  ● 30日以内        │
│ ○ 60日以内  ○ 90日以内      │
│ ○ 期限切れ                  │
│─────────────────────────────│
│ [リセット]    [適用 (12件)]  │
└─────────────────────────────┘
```

**適用ボタンの件数プレビュー**: フィルタ変更時にバックグラウンドで件数を取得し、「適用 (12件)」のように結果件数を表示。ユーザーが「このフィルタで何件あるか」を適用前に確認できる。

### C-2: モバイル用ソートActionSheet

**課題**: DeadStockListPage のソートは「期限順」トグルボタンのみ。モバイルでは複数ソート選択肢をActionSheet で提供するのが自然。

**対象画面**: DeadStockListPage, InventoryBrowsePage

**実装**:

`<MobileSortSheet>` コンポーネント（MobileFilterSheet を流用、軽量版）:
- ソートアイコンボタンをタップ → ActionSheet が下から展開
- 選択肢はラジオボタン（単一選択）
- 現在のソートにチェックマーク表示

| ページ | ソート選択肢 |
|--------|------------|
| DeadStockListPage | 薬品名順（デフォルト）/ 期限日が近い順 / 数量が少ない順 / 登録日が新しい順 |
| InventoryBrowsePage | 薬品名順（デフォルト）/ 期限日が近い順 / 薬局名順 |

```
[↕ ソート] タップ →
┌─────────────────────────────┐
│ ━━━                         │
│ 並び替え                    │
│─────────────────────────────│
│ ✓ 薬品名順                  │
│   期限日が近い順             │
│   数量が少ない順             │
│   登録日が新しい順           │
└─────────────────────────────┘
```

### C-3: バーコードスキャン → 検索連携

**課題**: 既存のカメラ機能（CameraViewport + useBarcodeResolver）は在庫登録用。在庫検索時にバーコードで薬品を特定する導線がない。手袋着用時にテキスト入力せずバーコードで直接検索できれば UX が大幅に向上する。

**対象画面**: InventoryBrowsePage, DeadStockListPage

**実装**:

検索バー横にバーコードアイコンボタンを配置:

```
[🔍 検索バー] [📷] [🔽 フィルタ]
                ↓ タップ
         カメラ起動（既存 CameraViewport 再利用）
                ↓ バーコード検出
         useBarcodeResolver でコード正規化
                ↓ GS1/JAN/YJコード → 薬品名解決
         検索バーに薬品名をセット + 自動検索実行
```

**フロー詳細**:
1. バーコードアイコンタップ → `CameraViewport` をモーダル表示（既存の fullscreen モード流用）
2. バーコード検出 → `useBarcodeResolver` で GS1/JAN コード正規化
3. 正規化されたコードで `/search/drug-master?q=<code>` を呼び出し、薬品名を取得
4. 薬品名を検索バーにセット → インクリメンタルサーチが自動発動
5. カメラモーダルを閉じ、結果リストを表示

**コード → 薬品名の解決**:
- YJコード: `drugMaster.yjCode` で完全一致検索
- GS1/JANコード: `drugMaster` に該当カラムがない場合、`drugName` のILIKE部分一致にフォールバック
- 該当薬品が見つからない場合: 「このバーコードに対応する薬品が見つかりません」トースト表示

**既存コードの再利用**:
- `CameraViewport`, `useCamera`, `useBarcodeResolver` はそのまま再利用
- 新規に必要なのは検索画面へのカメラ起動ボタンと結果→検索バーの連携ロジックのみ

---

## 変更対象ファイル

### 機能A（ジェスチャー）

| ファイル | 変更内容 |
|---------|---------|
| `client/src/hooks/usePullToRefresh.ts` | 新規: Pull-to-Refresh フック |
| `client/src/hooks/useSwipeAction.ts` | 新規: スワイプアクションフック |
| `client/src/hooks/usePageSwipe.ts` | 新規: ページ間スワイプフック |
| `client/src/hooks/usePinchZoom.ts` | 新規: ピンチズームフック（@use-gesture/react 使用） |
| `client/src/components/gesture/PullToRefresh.tsx` | 新規: ラッパーコンポーネント（3ステートインジケーター） |
| `client/src/components/gesture/SwipeableListItem.tsx` | 新規: スワイプ可能リストアイテム（Undo トースト内蔵） |
| `client/src/components/gesture/SwipeCoachingOverlay.tsx` | 新規: 初回利用コーチングオーバーレイ |
| `client/src/styles/sections/gesture.css` | 新規: ジェスチャーUI用スタイル（reduced-motion 対応含む） |
| `client/src/pages/DeadStockListPage.tsx` | PullToRefresh 適用（mobile ブランチ） |
| `client/src/pages/MatchingPage.tsx` | PullToRefresh + SwipeableListItem 適用（mobile ブランチ） |
| `client/src/pages/AlertListPage.tsx` | PullToRefresh + SwipeableListItem 適用（mobile ブランチ） |
| `client/src/pages/ProposalsPage.tsx` | PullToRefresh + SwipeableListItem 適用（mobile ブランチ） |
| `client/src/pages/InventoryBrowsePage.tsx` | PullToRefresh 適用（mobile ブランチ） |
| `client/src/components/Layout.tsx` | ページスワイプ統合（除外ロジック含む） |
| `client/src/components/layout/MobileBottomNav.tsx` | `NAV_ITEMS` のエクスポート追加 |
| `client/package.json` | `@use-gesture/react` 追加 |

### 機能B（検索）

| ファイル | 変更内容 |
|---------|---------|
| `server/src/utils/search-utils.ts` | 新規: 検索条件構築ユーティリティ |
| `server/src/utils/kana-utils.ts` | 全角半角正規化追加 + 双方向バリアント生成 |
| `server/src/routes/search.ts` | 共通ユーティリティに移行（drugs + drug-master + pharmacies） |
| `server/src/routes/inventory.ts` | 共通ユーティリティに移行（browse + dead-stock 検索追加） |
| `server/src/routes/drug-master-crud.ts` | 共通ユーティリティに移行 |
| `server/src/services/camera-dead-stock-service.ts` | 共通ユーティリティに移行（見落とし修正） |
| `client/src/hooks/useIncrementalSearch.ts` | 新規: インクリメンタルサーチフック（デバウンス + AbortController） |
| `client/src/components/SearchInput.tsx` | プレースホルダー更新 + 検索チップ表示 + onChange でインクリメンタルサーチ連携 |
| `client/src/pages/DeadStockListPage.tsx` | 検索バー新規追加 + useIncrementalSearch 統合 |
| `client/src/pages/InventoryBrowsePage.tsx` | useIncrementalSearch に移行（Enter/ボタンも共存） |
| `client/src/pages/admin/AdminDrugMasterPage.tsx` | useIncrementalSearch に移行（フィルタ変更時も即座反映） |

### 機能C（フィルター・ソート・バーコード）

| ファイル | 変更内容 |
|---------|---------|
| `client/src/components/mobile/MobileFilterSheet.tsx` | 新規: 汎用 BottomSheet フィルタコンポーネント（ScanResultSheet パターン流用） |
| `client/src/components/mobile/MobileSortSheet.tsx` | 新規: ソート ActionSheet コンポーネント |
| `client/src/components/mobile/BarcodeScanButton.tsx` | 新規: 検索バー横のバーコードスキャンボタン + カメラモーダル連携 |
| `client/src/styles/sections/mobile-sheets.css` | 新規: BottomSheet / ActionSheet スタイル |
| `client/src/pages/DeadStockListPage.tsx` | フィルタ BottomSheet 化 + ソート ActionSheet + バーコード検索ボタン |
| `client/src/pages/InventoryBrowsePage.tsx` | バーコード検索ボタン + ソート ActionSheet |
| `client/src/pages/admin/AdminDrugMasterPage.tsx` | フィルタ BottomSheet 化（mobile ブランチ） |

### テスト

| ファイル | 内容 |
|---------|------|
| `server/src/test/utils/search-utils.test.ts` | 新規: トークン検索ユニットテスト（下記テストケース参照） |
| `server/src/test/utils/kana-utils.test.ts` | 全角半角正規化テスト追加 |
| `client/src/__tests__/hooks/useIncrementalSearch.test.ts` | 新規: デバウンス・AbortController・minChars テスト |
| `client/src/__tests__/hooks/usePullToRefresh.test.ts` | 新規 |
| `client/src/__tests__/hooks/useSwipeAction.test.ts` | 新規 |
| `client/src/__tests__/hooks/usePageSwipe.test.ts` | 新規 |
| `client/src/__tests__/hooks/usePinchZoom.test.ts` | 新規 |
| `client/src/__tests__/components/gesture/SwipeableListItem.test.tsx` | 新規 |
| `client/src/__tests__/components/gesture/PullToRefresh.test.tsx` | 新規 |
| `client/src/__tests__/components/mobile/MobileFilterSheet.test.tsx` | 新規 |
| `client/src/__tests__/components/mobile/BarcodeScanButton.test.tsx` | 新規 |

**search-utils.test.ts 必須テストケース**:
- 空文字列、空白のみ、6+トークン（5に切り詰め確認）
- 全角スペース `\u3000` をトークン区切りとして認識
- SQL ワイルドカード含む入力: `%`, `_`
- 純粋な漢字入力（カナ変換効果なし）
- 混合入力: `アムロジピン錠5mg サワイ`
- 半角カタカナ + 濁点: `ｱﾑﾛｼﾞﾋﾟﾝ`
- 全角英数字正規化: `１０ｍｇ` → `10mg` + 逆方向
- YJコード検索: `2149017F1026`（ILIKE で大文字小文字無視の確認）
- 1文字トークンのフィルタリング（数字は許可）
- 後方互換: 単一トークンクエリが旧コードと同等の条件を生成

---

## 非スコープ（YAGNI）

- PostgreSQL Full-Text Search (tsvector/tsquery) — 日本語FTSはpg_bigm等の拡張が必要、Neonでの利用制限あり
- 検索履歴の保存 — 現時点では不要
- ファジー検索（Levenshtein距離） — 入力ミス補正は将来検討
- ロングプレスメニュー — スコープ外（レベル3）
- 3Dタッチ — iOS限定でWeb未対応
- deadStockItems → drugMaster JOIN による manufacturer 検索 — パフォーマンス影響大、将来検討
- 長音記号の母音展開（`ー` → 実母音） — 日本語検索の既知制約、将来検討
- スケルトンローディング — 別スプリントで検討（ジェスチャーとは独立）
- オフライン同期 — PWA 基盤は存在するが、本スプリントでは対象外

---

## 実装順序

機能A・B・Cは独立しているため並行実装可能。依存関係がある場合のみ直列化。

**機能B（検索）**: 3フェーズ
1. B-1 + B-2: サーバー側検索ロジック（共通ユーティリティ + 全7エンドポイント統一）
2. B-3: フロントエンド検索UX更新（チップ表示含む）
3. B-4: インクリメンタルサーチ（useIncrementalSearch フック + 3画面統合 + URL同期）

**機能A（ジェスチャー）**: 4フェーズ
1. A-1: PullToRefresh（基盤フック + 5画面適用 + コーチング）
2. A-2: SwipeableListItem（3画面適用 + Undo トースト）
3. A-3: ページ間スワイプ（5層競合回避）
4. A-4: ピンチズーム（@use-gesture/react）

**機能C（フィルター・ソート・バーコード）**: 3フェーズ
1. C-1: MobileFilterSheet（汎用 BottomSheet + 3画面適用）— B-4（インクリメンタルサーチ）完了後に着手（フィルタ変更→即時結果反映の連携が必要）
2. C-2: MobileSortSheet（2画面適用）— C-1 と並行可能
3. C-3: バーコードスキャン検索連携（2画面適用）— B-4 完了後に着手（検索バーへの自動入力→インクリメンタルサーチ連携）
