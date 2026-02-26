# 汎用デザインプリセット（インターネット調査ベース）

作成日: 2026-02-25

## 目的
- 新規画面を追加するときに、毎回ゼロから見た目を決めずに済むようにする。
- 医療システム以外にも流用できる「汎用」プリセットを先に持っておく。

## 参照した一次情報（2026-02-25確認）
- WCAG 2.2（アクセシビリティの基準）  
  https://www.w3.org/TR/WCAG22/
- WCAG 2.2 Understanding: Focus Appearance (Minimum)  
  https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance-minimum.html
- USWDS Design Tokens（運用系画面でのトークン設計）  
  https://designsystem.digital.gov/design-tokens/
- USWDS Accessibility guidance（フォーカス/キーボード運用）  
  https://designsystem.digital.gov/components/
- NHS Service Manual（医療文脈での平易な表現と設計）  
  https://service-manual.nhs.uk/
- CDC Plain Language（医療文脈でも有効な読みやすさ原則）  
  https://www.cdc.gov/health-literacy/php/develop-materials/plain-language-thesaurus-for-health-communications.html
- NIST SP 800-63B（認証体験の実務基準）  
  https://pages.nist.gov/800-63-4/sp800-63b.html
- Material Design（カラーロールの考え方）  
  https://m3.material.io/styles/color

## 事前定義したプリセット
- `clinical-calm`:
  - 低刺激で長時間運用向け
  - 現在のデフォルト
- `clinical-contrast`:
  - 文字/境界/フォーカスの差を強める
  - 高照度・視認性重視向け
- `neutral-business`:
  - 医療外の業務アプリにも流用しやすい中立配色
- `high-legibility`:
  - 高可読性（文字/境界/フォーカス）を重視
  - 高齢ユーザー・夜勤運用・入力ミス低減に向く

## 事前実装した共通ルール（汎用）
- 最小操作領域: 入力/ボタン系の最小高さを `44px` に統一
- フォーカス可視化: `:focus-visible` で高コントラストのアウトラインを強制
- 動きの抑制: `prefers-reduced-motion: reduce` に追従
- プリセット切替: `body[data-design-preset]` で全画面トークンを一括上書き

## 実装
- プリセット定義:
  - `client/src/design/genericDesignPresets.ts`
- 適用フック（App起動時に body に preset を設定）:
  - `client/src/App.tsx`
- CSS変数上書き:
  - `client/src/styles/design-language.css`

## 使い方（将来）
1. `localStorage[dss.design-preset]` にプリセットIDを保存
2. ページ再読み込みで body の `data-design-preset` に反映
3. 画面全体のトークンが自動切替
