# 共通コンポーネント化ギャップ（2026-02-26 完了）

## 集計サマリ（`client/src` / `components/ui` 直利用を除外）
- `Card`: 0
- `Form.Control`: 0
- `Alert`: 0
- `Button`: 0
- `Table`: 0
- `Modal`: 0
- `Dropdown`: 0

## 結果
- 監査対象としていた高頻度UI直書きはすべて共通コンポーネントへ移行完了。
- 画面実装側は `components/ui/*` の共通部品を利用する構成に統一。

## 追加された共通部品（今回まで）
- `AppControl`
- `AppCard`
- `AppAlert`
- `AppButton`
- `AppTable`
- `AppField`
- `AppDataPanel`
- `AppModalShell`
- `AppKpiCard`
- `AppSelect`
- `AppDropdownMenu`
- `LoadingButton`
- `InlineLoader`
- `PageLoader`
- `AppScreen`
- `AuthPageLayout`
- `StatusAlert`

## 次フェーズ候補
1. `AppTableField`（表セル入力専用の薄ラッパ）
2. `AppDataTable`（empty/loading/pagination を包含）
3. `AppActionBar`（一覧画面の検索・フィルタ・操作を統一）
