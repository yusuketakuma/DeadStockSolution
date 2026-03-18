# Mobile UX + Search Enhancement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モバイルジェスチャーUX、AND検索+インクリメンタルサーチ、フィルター/ソート/バーコード検索を一括実装する (v0.0.15)

**Architecture:** サーバー側検索ユーティリティを共通化した上で、フロントエンドにTouch APIベースのジェスチャーフック群、react-queryベースのインクリメンタルサーチ、BottomSheetコンポーネントを追加。ページ横断でDeadStockListPage, InventoryBrowsePage, MatchingPage等に統合する。

**Tech Stack:** React 18 + TypeScript, Express 5 + Drizzle ORM (ilike), カスタムTouch APIフック, @use-gesture/react (A-4のみ), React Router useSearchParams

**Spec:** `docs/superpowers/specs/2026-03-18-mobile-ux-and-search-design.md`

---

## Phase 1: サーバー検索リライト (B-1 + B-2)

### Task 1: kana-utils 全角半角正規化追加

**Files:**
- Modify: `server/src/utils/kana-utils.ts`
- Modify: `server/src/test/utils/kana-utils.test.ts`

- [ ] **Step 1: 全角英数→半角変換のテストを追加**

```typescript
// kana-utils.test.ts に追加
describe('fullWidthAlphanumToHalfWidth', () => {
  it('converts full-width alphanumeric to half-width', () => {
    expect(fullWidthAlphanumToHalfWidth('１０ｍｇ')).toBe('10mg');
  });
  it('converts full-width uppercase', () => {
    expect(fullWidthAlphanumToHalfWidth('Ａ１')).toBe('A1');
  });
  it('leaves half-width unchanged', () => {
    expect(fullWidthAlphanumToHalfWidth('10mg')).toBe('10mg');
  });
  it('leaves kana unchanged', () => {
    expect(fullWidthAlphanumToHalfWidth('アムロジピン')).toBe('アムロジピン');
  });
});

describe('halfWidthAlphanumToFullWidth', () => {
  it('converts half-width to full-width', () => {
    expect(halfWidthAlphanumToFullWidth('10mg')).toBe('１０ｍｇ');
  });
});
```

- [ ] **Step 2: テスト実行 → FAIL 確認**
Run: `cd server && npx vitest run src/test/utils/kana-utils.test.ts`

- [ ] **Step 3: fullWidthAlphanumToHalfWidth / halfWidthAlphanumToFullWidth 実装**

```typescript
// kana-utils.ts に追加
export function fullWidthAlphanumToHalfWidth(str: string): string {
  return str.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );
}

export function halfWidthAlphanumToFullWidth(str: string): string {
  return str.replace(/[!-~]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0xFEE0)
  );
}
```

`normalizeKana()` を更新して全角英数→半角変換も実行するようにする。

- [ ] **Step 4: テスト実行 → PASS 確認**
- [ ] **Step 5: コミット** `feat(search): add full-width/half-width alphanumeric normalization to kana-utils`

---

### Task 2: search-utils.ts 新規作成 (トークン化AND検索)

**Files:**
- Create: `server/src/utils/search-utils.ts`
- Create: `server/src/test/utils/search-utils.test.ts`

- [ ] **Step 1: テスト作成**

```typescript
// search-utils.test.ts
import { describe, it, expect } from 'vitest';
import { tokenizeQuery, buildKanaVariants, buildTokenizedSearchConditions } from '../../utils/search-utils';

describe('tokenizeQuery', () => {
  it('splits on half-width space', () => {
    expect(tokenizeQuery('アムロジピン サワイ')).toEqual(['アムロジピン', 'サワイ']);
  });
  it('splits on full-width space U+3000', () => {
    expect(tokenizeQuery('アムロジピン\u3000サワイ')).toEqual(['アムロジピン', 'サワイ']);
  });
  it('returns empty for blank input', () => {
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery('   ')).toEqual([]);
  });
  it('limits to 5 tokens', () => {
    expect(tokenizeQuery('a b c d e f g')).toHaveLength(5);
  });
  it('filters 1-char non-digit tokens', () => {
    expect(tokenizeQuery('ア サワイ')).toEqual(['サワイ']);
  });
  it('keeps 1-char digit tokens', () => {
    expect(tokenizeQuery('5 サワイ')).toEqual(['5', 'サワイ']);
  });
  it('removes duplicate tokens', () => {
    expect(tokenizeQuery('サワイ サワイ')).toEqual(['サワイ']);
  });
});

describe('buildKanaVariants', () => {
  it('includes original, hiragana, katakana', () => {
    const variants = buildKanaVariants('サワイ');
    expect(variants).toContain('サワイ');
    expect(variants).toContain('さわい');
  });
  it('includes full-width and half-width for alphanumeric', () => {
    const variants = buildKanaVariants('5mg');
    expect(variants).toContain('5mg');
    expect(variants).toContain('５ｍｇ');
  });
  it('deduplicates variants', () => {
    const variants = buildKanaVariants('漢字');
    // Kanji has no kana conversion, all variants are same
    expect(new Set(variants).size).toBe(variants.length);
  });
});

describe('buildTokenizedSearchConditions', () => {
  // SQL condition structure tests — verify return type is SQL | undefined
  it('returns undefined for empty query', () => {
    expect(buildTokenizedSearchConditions('', [])).toBeUndefined();
  });
  it('returns SQL for valid query with columns', () => {
    // This test verifies the function doesn't throw; actual SQL is integration-tested
    const result = buildTokenizedSearchConditions('アムロジピン サワイ', [/* mock columns */]);
    expect(result).toBeDefined();
  });
});
```

注: `buildTokenizedSearchConditions` のSQL出力はDrizzleカラム型に依存するため、完全なSQL検証はルートテストのintegrationで行う。ユニットテストはtokenizeQueryとbuildKanaVariantsに集中。

- [ ] **Step 2: テスト実行 → FAIL 確認**
- [ ] **Step 3: search-utils.ts 実装**

```typescript
// server/src/utils/search-utils.ts
import { SQL, ilike, or, and, type AnyColumn } from 'drizzle-orm';
import {
  normalizeKana, katakanaToHiragana, hiraganaToKatakana,
  fullWidthAlphanumToHalfWidth, halfWidthAlphanumToFullWidth,
} from './kana-utils';
import { escapeLikeWildcards } from './request-utils';

const MAX_TOKENS = 5;
const MIN_TOKEN_LENGTH = 2;

export function tokenizeQuery(query: string): string[] {
  const tokens = query
    .split(/[\s\u3000]+/)        // half-width + full-width space
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .filter(t => t.length >= MIN_TOKEN_LENGTH || /^\d+$/.test(t));
  return [...new Set(tokens)].slice(0, MAX_TOKENS);
}

export function buildKanaVariants(token: string): string[] {
  const normalized = normalizeKana(token);
  const hiragana = katakanaToHiragana(normalized);
  const katakana = hiraganaToKatakana(normalized);
  const halfWidth = fullWidthAlphanumToHalfWidth(token);
  const fullWidth = halfWidthAlphanumToFullWidth(token);
  return [...new Set([token, normalized, hiragana, katakana, halfWidth, fullWidth])];
}

export function buildTokenizedSearchConditions(
  query: string,
  columns: AnyColumn[],
): SQL | undefined {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0 || columns.length === 0) return undefined;

  const tokenConditions = tokens.map(token => {
    const variants = buildKanaVariants(token);
    const colConditions = columns.flatMap(col =>
      variants.map(v => ilike(col, `%${escapeLikeWildcards(v)}%`))
    );
    return or(...colConditions)!;
  });

  return tokenConditions.length === 1 ? tokenConditions[0] : and(...tokenConditions);
}
```

- [ ] **Step 4: テスト実行 → PASS 確認**
- [ ] **Step 5: コミット** `feat(search): add tokenized AND search utility with kana variants`

---

### Task 3: 検索エンドポイント統一 (7箇所)

**Files:**
- Modify: `server/src/routes/search.ts` (drugs, drug-master, pharmacies)
- Modify: `server/src/routes/inventory.ts` (browse + dead-stock search追加)
- Modify: `server/src/routes/drug-master-crud.ts`
- Modify: `server/src/services/camera-dead-stock-service.ts`

- [ ] **Step 1: 既存の検索テストを実行してベースライン確認**
Run: `cd server && npx vitest run --reporter=verbose 2>&1 | grep -E '(PASS|FAIL|Tests)' | tail -5`

- [ ] **Step 2: search.ts — buildKanaLikeTerms を buildTokenizedSearchConditions に置き換え**

各エンドポイントで `buildTokenizedSearchConditions(q, [対象カラム])` を使用:
- `/drugs`: `[deadStockItems.drugName]`
- `/drug-master`: `[drugMaster.drugName, drugMaster.genericName, drugMaster.manufacturer]`
- `/pharmacies`: `[pharmacies.name]`

- [ ] **Step 3: inventory.ts — browse エンドポイントの検索を更新**

`buildTokenizedSearchConditions(search, [deadStockItems.drugName])` に置き換え。

- [ ] **Step 4: inventory.ts — dead-stock エンドポイントに検索パラメータ追加**

`req.query.search` を受け取り、`buildTokenizedSearchConditions` でフィルタリング。

- [ ] **Step 5: drug-master-crud.ts — 検索条件を統一ユーティリティに移行**

`buildTokenizedSearchConditions(search, [drugMaster.drugName, drugMaster.genericName, drugMaster.manufacturer])` + YJコード検索はalphanumeric判定で分岐維持。

- [ ] **Step 6: camera-dead-stock-service.ts — buildManualSearchWhere を更新**

- [ ] **Step 7: 全サーバーテスト実行**
Run: `cd server && npx vitest run`
Expected: 4610+ tests PASS（ILIKE変更でcase-sensitivity関連のテストがFAILした場合は更新）

- [ ] **Step 8: コミット** `refactor(search): unify all search endpoints with tokenized AND search`

---

## Phase 2: フロントエンド検索UX (B-3)

### Task 4: SearchChips + SearchInput 改善

**Files:**
- Create: `client/src/components/search/SearchChips.tsx`
- Create: `client/src/__tests__/components/search/SearchChips.test.tsx`
- Modify: `client/src/components/SearchInput.tsx` (プレースホルダー更新 + SearchChips 統合。SearchInput自体はリネームせず、チップ表示と trailing icon スロットを追加)

- [ ] **Step 1: SearchChips テスト作成**

```typescript
// SearchChips.test.tsx
describe('SearchChips', () => {
  it('renders tokens as badges', () => { ... });
  it('calls onRemove with token when × clicked', () => { ... });
  it('renders nothing when tokens is empty', () => { ... });
  it('horizontally scrolls when chips overflow', () => { ... });
});
```

- [ ] **Step 2: テスト実行 → FAIL 確認**

- [ ] **Step 3: SearchChips コンポーネント実装**

```typescript
interface SearchChipsProps {
  tokens: string[];
  onRemove: (token: string) => void;
  maxTokenWarning?: boolean;  // 5トークン超過時の警告表示
}
```

チップ行は `overflow-x: auto` で水平スクロール可能。5トークン超過時は「最大5キーワードまで検索できます」メッセージ表示。

- [ ] **Step 4: SearchInput のプレースホルダー更新 + trailing icon スロット追加**

`"薬品名 メーカー名で検索（スペース区切りで絞り込み）"`。SearchInput に `trailingIcon?: ReactNode` prop を追加（バーコードボタン用スロット）。

- [ ] **Step 5: 検索結果の空状態メッセージ + 結果件数表示コンポーネント追加**

`SearchResultStatus` コンポーネント: 「12件見つかりました」/ 「該当する薬品が見つかりません」/ フィルタ活性時は「フィルタを解除するか、キーワードを変えてお試しください」+ フィルタ解除ボタン。結果取得中は `opacity: 0.6` フェード（200ms以内完了ならスキップ）。

- [ ] **Step 6: テスト実行 → PASS**
Run: `cd client && npx vitest run`

- [ ] **Step 7: コミット** `feat(search): add SearchChips, result status, and updated SearchInput`

---

## Phase 3: インクリメンタルサーチ (B-4)

### Task 5: useIncrementalSearch フック

**Files:**
- Create: `client/src/hooks/useIncrementalSearch.ts`
- Create: `client/src/__tests__/hooks/useIncrementalSearch.test.ts`

- [ ] **Step 1: テスト作成**

デバウンス動作、AbortController、minChars、Enter即時実行、URL sync (replace: true) をカバー。

- [ ] **Step 2: テスト実行 → FAIL**
- [ ] **Step 3: useIncrementalSearch 実装**

react-queryの `useQuery` をベースに構築（既存の `useApiQuery` パターンを活用）。
`queryKey` にデバウンス済みクエリを含め、react-queryのキャッシュ・dedup・stale-while-revalidateを活用。
`useSearchParams` で URL 同期（`replace: true` でhistory汚染防止）。

- [ ] **Step 4: テスト実行 → PASS**
- [ ] **Step 5: コミット** `feat(search): add useIncrementalSearch hook with debounce and URL sync`

### Task 6: 3画面にインクリメンタルサーチ統合

**Files:**
- Modify: `client/src/pages/DeadStockListPage.tsx` (検索バー新規追加)
- Modify: `client/src/pages/InventoryBrowsePage.tsx` (useIncrementalSearch移行)
- Modify: `client/src/pages/admin/AdminDrugMasterPage.tsx` (useIncrementalSearch移行)

- [ ] **Step 1: DeadStockListPage に検索バー + useIncrementalSearch 追加**

既存の `useApiQuery` を `useIncrementalSearch` に統合。ページ状態をカスタムフック `useDeadStockListState` に集約して肥大化を防止。

- [ ] **Step 2: InventoryBrowsePage を useIncrementalSearch に移行**

既存の SearchInput + handleSearch パターンを置き換え。Enter/ボタンは即時実行として共存。

- [ ] **Step 3: AdminDrugMasterPage を useIncrementalSearch に移行**

フィルタ（status/category）変更時も再検索をトリガー。

- [ ] **Step 4: 全クライアントテスト実行**
Run: `cd client && npx vitest run`

- [ ] **Step 5: コミット** `feat(search): integrate incremental search into 3 pages`

---

## Phase 4: Pull-to-Refresh (A-1)

### Task 7: usePullToRefresh フック

**Files:**
- Create: `client/src/hooks/usePullToRefresh.ts`
- Create: `client/src/__tests__/hooks/usePullToRefresh.test.ts`

- [ ] **Step 1: テスト作成**

Touch event simulation (touchstart/touchmove/touchend)、scrollTop=0 判定、閾値80px、isRefreshing guard、reduced-motion、cleanup。

- [ ] **Step 2: テスト実行 → FAIL**
- [ ] **Step 3: usePullToRefresh 実装**

`{ passive: false }` で touchmove 登録、`requestAnimationFrame` スロットル、`overscroll-behavior-y: contain` をrefに設定、disabled条件（シートopen/input focus時）。

- [ ] **Step 4: テスト実行 → PASS**
- [ ] **Step 5: コミット** `feat(gesture): add usePullToRefresh hook`

### Task 8: PullToRefresh コンポーネント + 5画面適用

**Files:**
- Create: `client/src/components/gesture/PullToRefresh.tsx`
- Create: `client/src/styles/sections/gesture.css`
- Create: `client/src/__tests__/components/gesture/PullToRefresh.test.tsx`
- Modify: 5 page files (mobile branch only)

- [ ] **Step 1: PullToRefresh コンポーネント作成**

3ステートインジケーター (Pulling → Refreshing → Complete)。`prefers-reduced-motion` 対応。`aria-live="polite"` で完了通知。

- [ ] **Step 2: gesture.css 作成**

モーショントークン (`--dl-duration-fast: 150ms`, `--dl-duration-normal: 300ms`, `--dl-ease-standard`)。`@media (prefers-reduced-motion: reduce)` でアニメーション無効化。

- [ ] **Step 3: 5画面に PullToRefresh 適用 (mobile branch)**

各ページの `AppResponsiveSwitch` mobile ブランチ内でのみ `<PullToRefresh>` ラップ。MatchingPage は `searched === true` 時のみ有効化。

- [ ] **Step 4: テスト実行**
- [ ] **Step 5: コミット** `feat(gesture): add PullToRefresh component and apply to 5 pages`

---

## Phase 5: SwipeableListItem (A-2)

### Task 9: useSwipeAction フック

**Files:**
- Create: `client/src/hooks/useSwipeAction.ts`
- Create: `client/src/__tests__/hooks/useSwipeAction.test.ts`

- [ ] **Step 1: テスト作成**

角度判定（±30度）、速度ゲーティング、閾値（幅の20%）、touch-action: pan-y、will-change スコープ。

- [ ] **Step 2: テスト実行 → FAIL**
- [ ] **Step 3: useSwipeAction 実装**
- [ ] **Step 4: テスト実行 → PASS**
- [ ] **Step 5: コミット** `feat(gesture): add useSwipeAction hook with velocity gating`

### Task 10: SwipeableListItem + Undo トースト + 3画面適用

**Files:**
- Create: `client/src/components/gesture/SwipeableListItem.tsx`
- Create: `client/src/__tests__/components/gesture/SwipeableListItem.test.tsx`
- Modify: MatchingPage, AlertListPage, ProposalsPage (mobile branch)

- [ ] **Step 1: SwipeableListItem コンポーネント作成**

Undo トースト内蔵（5秒遅延実行。ページ遷移時は即commit）。背景アクションエリア 48x48dp 最小。peek アフォーダンス（カードエッジ 3px 色表示）。

- [ ] **Step 2: SwipeCoachingOverlay 作成**

`client/src/components/gesture/SwipeCoachingOverlay.tsx` — 初回利用時のみ表示。localStorage キー = `swipe-coaching-{userId}`（共有デバイス対応）。半透明背景 + 矢印アニメーション。

- [ ] **Step 3: 3画面の mobile ブランチに SwipeableListItem 適用**

`SwipeableListItem > AppMobileDataCard` のDOM構造。既存のアクションボタンは維持（プログレッシブエンハンスメント）。

- [ ] **Step 4: テスト実行**
- [ ] **Step 5: コミット** `feat(gesture): add SwipeableListItem with undo toast and coaching overlay`

---

## Phase 6: フィルター/ソートシート (C-1 + C-2)

### Task 11: BaseBottomSheet + MobileFilterSheet

**Files:**
- Create: `client/src/components/mobile/BaseBottomSheet.tsx`
- Create: `client/src/components/mobile/MobileFilterSheet.tsx`
- Create: `client/src/styles/sections/mobile-sheets.css`
- Create: `client/src/__tests__/components/mobile/MobileFilterSheet.test.tsx`

- [ ] **Step 1: BaseBottomSheet プリミティブ作成**

`position: fixed`, ドラッグハンドル, バックドロップ, `max-height: 60vh`, focus trap, `aria-modal`, swipe-to-dismiss, open/close アニメーション。ScanResultSheet とは独立（後で統合可能）。

- [ ] **Step 2: MobileFilterSheet コンポーネント作成**

BaseBottomSheet を拡張。リセット/適用ボタン。アクティブフィルタ数バッジ。

- [ ] **Step 3: usePullToRefresh に「シートopen時は無効」ガード追加**

- [ ] **Step 4: フィルタ件数プレビュー実装**

フィルタ変更時にデバウンス（300ms）でカウントクエリを実行し、「適用 (12件)」のように適用ボタンに件数を表示。

- [ ] **Step 5: 3画面にフィルタシート適用（mobile branch）**

DeadStockListPage: 期限フィルタ BottomSheet 化。
AdminDrugMasterPage: ステータス+カテゴリ BottomSheet 化。
検索バー横にフィルタアイコンボタン配置。

- [ ] **Step 5: テスト実行**
- [ ] **Step 6: コミット** `feat(mobile): add BaseBottomSheet and MobileFilterSheet for 3 pages`

### Task 12: MobileSortSheet

**Files:**
- Create: `client/src/components/mobile/MobileSortSheet.tsx`
- Modify: DeadStockListPage, InventoryBrowsePage

- [ ] **Step 1: MobileSortSheet コンポーネント作成**

BaseBottomSheet ベース。ラジオボタンリスト + チェックマーク。

- [ ] **Step 2: 2画面にソートシート適用**

DeadStockListPage: 薬品名順/期限日順/数量順/登録日順。
InventoryBrowsePage: 薬品名順/期限日順/薬局名順。

- [ ] **Step 3: テスト実行**
- [ ] **Step 4: コミット** `feat(mobile): add MobileSortSheet for DeadStockListPage and InventoryBrowsePage`

---

## Phase 7: バーコード検索連携 (C-3)

### Task 13: BarcodeScanButton

**Files:**
- Create: `client/src/components/mobile/BarcodeScanButton.tsx`
- Create: `client/src/__tests__/components/mobile/BarcodeScanButton.test.tsx`
- Modify: DeadStockListPage, InventoryBrowsePage

- [ ] **Step 1: BarcodeScanButton テスト作成**

```typescript
describe('BarcodeScanButton', () => {
  it('renders camera icon button', () => { ... });
  it('opens CameraViewport modal on tap', () => { ... });
  it('calls onScanResult with drug name after barcode resolve', () => { ... });
  it('shows error toast when drug not found', () => { ... });
  it('closes modal after successful scan', () => { ... });
});
```

- [ ] **Step 2: テスト実行 → FAIL 確認**

- [ ] **Step 3: BarcodeScanButton コンポーネント実装**

SearchInput の `trailingIcon` スロットに配置。タップ→CameraViewport モーダル起動。バーコード検出→useBarcodeResolver→薬品名解決→`onScanResult(drugName)` コールバック→検索バーにセット→インクリメンタルサーチ自動発動。エラー時トースト。

- [ ] **Step 4: テスト実行 → PASS**
- [ ] **Step 5: 2画面に BarcodeScanButton 統合**
- [ ] **Step 6: コミット** `feat(mobile): add barcode scan to search for DeadStockListPage and InventoryBrowsePage`

---

## Phase 8: ページ間スワイプ (A-3)

### Task 14: usePageSwipe フック

**Files:**
- Create: `client/src/hooks/usePageSwipe.ts`
- Create: `client/src/__tests__/hooks/usePageSwipe.test.ts`
- Modify: `client/src/components/Layout.tsx`
- Modify: `client/src/components/layout/MobileBottomNav.tsx` (NAV_ITEMS export)

- [ ] **Step 1: MobileBottomNav から NAV_ITEMS をエクスポート**

- [ ] **Step 2: usePageSwipe テスト作成**

5層除外ロジック（SwipeableListItem, .table-responsive, 画面端20px, Offcanvas/Modal/BottomSheet open, input focus）全てのケース + 速度ベース閾値。

- [ ] **Step 3: テスト実行 → FAIL**
- [ ] **Step 4: usePageSwipe 実装**

Layout.tsx の main content area にアタッチ。BaseBottomSheet の open 状態も除外条件に含める。

- [ ] **Step 5: テスト実行 → PASS**
- [ ] **Step 6: コミット** `feat(gesture): add page swipe navigation between bottom nav tabs`

---

## Phase 9: ピンチズーム (A-4)

### Task 15: @use-gesture/react + usePinchZoom

**Files:**
- Modify: `client/package.json` (`@use-gesture/react` 追加)
- Create: `client/src/hooks/usePinchZoom.ts`
- Create: `client/src/__tests__/hooks/usePinchZoom.test.ts`

- [ ] **Step 1: @use-gesture/react インストール**
Run: `cd client && npm install @use-gesture/react`

- [ ] **Step 2: usePinchZoom テスト作成**

```typescript
describe('usePinchZoom', () => {
  it('returns scale=1 initially', () => { ... });
  it('updates scale on pinch gesture', () => { ... });
  it('clamps scale between 1 and 3', () => { ... });
  it('toggles 1x/2x on double tap', () => { ... });
  it('resets to 1x when reset called', () => { ... });
});
```

- [ ] **Step 3: テスト実行 → FAIL 確認**

- [ ] **Step 4: usePinchZoom 実装**

ピンチ + パン + ダブルタップトグル (1x↔2x)。リセットボタン (position: fixed)。`overflow: auto` コンテナ。ブラウザネイティブ zoom は抑制しない。

- [ ] **Step 5: テスト実行 → PASS**
- [ ] **Step 6: 薬品詳細モーダル/提案詳細に適用**
- [ ] **Step 7: コミット** `feat(gesture): add pinch zoom for drug detail views`

---

## Phase 10: 統合検証 + リリース

### Task 16: 全テスト + typecheck + lint

- [ ] **Step 1: サーバーテスト全実行**
Run: `cd server && npx vitest run`
Expected: 全 PASS

- [ ] **Step 2: クライアントテスト全実行**
Run: `cd client && npx vitest run`
Expected: 全 PASS

- [ ] **Step 3: TypeScript チェック**
Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 4: Lint**
Run: `npm run lint`
Expected: エラーなし

- [ ] **Step 5: Plans.md 更新**

### Task 17: リリースコミット

- [ ] **Step 1: version bump + CHANGELOG**
- [ ] **Step 2: コミット** `chore: release v0.0.15`

---

## 依存関係グラフ

```
Phase 1 (B-1+B-2) ─→ Phase 2 (B-3) ─→ Phase 3 (B-4) ─┬→ Phase 6 (C-1+C-2) ─→ Phase 8 (A-3)
                                                         └→ Phase 7 (C-3)
Phase 4 (A-1) ─→ Phase 5 (A-2) ─→ Phase 8 (A-3)
Phase 9 (A-4): 独立、任意のタイミングで実行可能
```

**並行実行可能なペア:**
- Phase 1 と Phase 4 (サーバー検索 と Pull-to-Refresh)
- Phase 5 と Phase 3 (SwipeableListItem と インクリメンタルサーチ)
- Phase 6 と Phase 9 (フィルターシート と ピンチズーム)
- Phase 7 と Phase 8 (バーコード と ページスワイプ)
