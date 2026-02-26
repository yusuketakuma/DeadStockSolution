# 医療システム向けデザイン言語（2026-02-25整理）

## 目的
- ログインを起点に、認証画面のUI/UXを医療業務に適した一貫したデザインへ統一する。
- 根拠は一次情報（標準・公的ガイド）に限定し、実装へ落とし込む。

## リサーチ要点（一次ソース）
1. **可読性・操作性の最低基準**
- WCAG 2.2（W3C）を基準に、コントラスト・フォーカス可視化・フォーム入力支援を担保する。
- 参照: https://www.w3.org/TR/WCAG22/

2. **医療サービス文脈での言葉と案内**
- NHS Service Manualは、医療サービスでは平易で不安を煽らない文言、入力前後の期待値提示を重視している。
- 参照: https://service-manual.nhs.uk/

3. **患者安全に影響するユーザビリティ**
- HealthIT.gov の SAFER Guides は、EHR/医療ITでの入力ミス・認知負荷・確認不足が安全課題になり得る点を示す。
- 参照: https://www.healthit.gov/topic/safety/safer-guides

4. **認証UXの実務基準**
- NIST SP 800-63B は、認証での利用者負担と安全性のバランスを示し、分かりやすいエラー提示や過剰な入力負担回避が重要。
- 参照: https://pages.nist.gov/800-63-4/sp800-63b.html

5. **ヘルスリテラシー配慮**
- CDC Clear Communication Index は、重要情報を短く、行動に直結する文章にする原則を示す。
- 参照: https://www.cdc.gov/ccindex/index.html

## 採用したデザイン言語
### 1. Visual Tokens
- 背景・面・境界線・文字色・状態色をCSS変数化し、警告/成功の意味づけを統一。
- 影・角丸・余白を定義し、画面間の認知負荷を下げる。
- プリセットを事前定義（`clinical-calm` / `clinical-contrast` / `neutral-business` / `high-legibility`）。

### 2. Layout Rules
- 認証画面を「主操作（フォーム）」と「安全運用の補助情報（サイド）」に分離。
- モバイルでは1カラム化し、入力優先の順序を維持。

### 3. Interaction Rules
- エラー/成功通知は共通 `StatusAlert` で視覚表現を統一。
- 入力補助文（次に何をすべきか）を各フォーム直下に配置。
- タブ切替時は状態を明示的にリセットして誤入力を防ぐ。

## 実装マッピング
- デザイントークン: `client/src/styles/design-language.css`
- 全画面適用ラッパー: `client/src/components/ui/AppScreen.tsx`
- 共通レイアウト: `client/src/components/ui/AuthPageLayout.tsx`
- 共通状態通知: `client/src/components/ui/StatusAlert.tsx`
- 共通プルダウン: `client/src/components/ui/AppSelect.tsx`
- 共通プルダウンメニュー: `client/src/components/ui/AppDropdownMenu.tsx`
- 共通フィールド: `client/src/components/ui/AppField.tsx`
- 共通フォームコントロール: `client/src/components/ui/AppControl.tsx`
- 共通データパネル: `client/src/components/ui/AppDataPanel.tsx`
- 共通KPIカード: `client/src/components/ui/AppKpiCard.tsx`
- 共通モーダルシェル: `client/src/components/ui/AppModalShell.tsx`
- 共通カード: `client/src/components/ui/AppCard.tsx`
- 共通アラート: `client/src/components/ui/AppAlert.tsx`
- 共通ボタン: `client/src/components/ui/AppButton.tsx`
- 共通テーブル: `client/src/components/ui/AppTable.tsx`
- 共通ローディング:
  - 全画面/領域ローダー: `client/src/components/ui/PageLoader.tsx`
  - 行内ローダー: `client/src/components/ui/InlineLoader.tsx`
  - ローディング付きボタン: `client/src/components/ui/LoadingButton.tsx`
- アプリ全体適用ポイント:
  - `client/src/components/Layout.tsx`（`app-theme` + `AppScreen`）
  - `client/src/main.tsx`（デザイン言語CSSを最終読み込み）
- 適用画面:
  - `client/src/pages/LoginPage.tsx`
  - `client/src/pages/RegisterPage.tsx`
  - `client/src/pages/PasswordResetPage.tsx`
  - `useLayout=true` の全保護画面（`Layout` 経由で統一スタイル適用）

## 今後の拡張
- 同トークンを `Header/Sidebar` へ段階適用し、アプリ全体の配色・状態表現を統一する。
- フォーム共通部品（ラベル + 補助文 + エラー）をさらに抽象化し、全入力画面へ展開する。
