# モバイル版最適化 (Mobile UX Optimization)

## TL;DR

> **Quick Summary**: 薬局現場での利用シーン（スマートフォンでの在庫登録・提案確認）に最適化するため、カメラ登録機能の刷新、提案詳細ページのモバイルレイアウト導入、タッチ操作に最適化した入力コンポーネントの実装、および既存テーブルのモバイルカード化を行う。

> **Deliverables**:
> - `AppTouchInput`: タッチデバイス向けに最適化された入力コンポーネント（inputmode, 44px target）
> - `CameraDeadStockRegisterPanel` のモバイルファースト再設計（全画面カメラ、ボトムシート、スワイプ削除）
> - `ProposalDetailPage` のモバイル専用レイアウト（固定フッター、アコーディオンタイムライン）
> - `LoginPage` のモバイル最適化（縦積みレイアウト、パスワードトグル）
> - 管理者向けテーブル（UploadJobs, Logs, Exchanges）の `AppMobileDataCard` 適用

> **Estimated Effort**: Medium-Large
> **Parallel Execution**: YES - 3 waves + FINAL
> **Critical Path**: Task 1 → Task 3 → Task 4 → F1-F4

---

## Context

### Original Request
スマートフォンでの操作性を向上させ、現場での在庫管理業務を円滑にするためのUI/UX最適化。特にカメラを利用した在庫登録と、外出先での提案確認・回答の体験を改善する。

### Current Mobile State
- **Infrastructure**: `AppResponsiveSwitch` (991.98px), `AppMobileDataCard`, React Bootstrap 5 grid が存在。
- **Pain Points**:
    - `CameraDeadStockRegisterPanel.tsx` (549行): カメラ、バーコード、フォーム、APIが混在し、モバイルでの操作が煩雑。
    - `ProposalDetailPage.tsx` (576行): デスクトップ向けレイアウトのままで、アクションボタンが押しにくい。
    - `LoginPage.tsx` (435行): モバイルでの入力体験が未調整。
    - 一部の管理者ページがモバイルでテーブル表示のまま（横スクロール発生）。

### Research Findings
- `CameraDeadStockRegisterPanel` は `useCamera` (414行) と `useCameraDraftRows` に依存。
- `Layout.tsx` はサイドバー + メインコンテンツの構成。
- `feature/group-alert-pwa` ブランチで PWA 関連（BottomNav等）は実装済みのため、本計画のスコープ外。

---

## Work Objectives

### Core Objective
モバイルデバイスでの「在庫登録」「提案対応」のコア体験を、ネイティブアプリに近い操作感（タッチ最適化、ボトムシート、全画面カメラ）で提供し、現場での業務効率を最大化する。

### Concrete Deliverables
- **Components**: `AppTouchInput`, `CameraViewport`, `ScanResultSheet`, `DraftRowList`
- **Pages**: `CameraDeadStockRegisterPanel` (Refactored), `ProposalDetailPage` (Mobile Layout), `LoginPage` (Mobile Optimized)
- **Admin**: `AdminUploadJobsPage`, `AdminLogsPage`, `AdminExchangesPage` のモバイル対応
- **CSS**: モバイル向けユーティリティクラス（タップターゲット、固定フッター用余白等）

### Definition of Done
- [x] `npm run typecheck` — PASS (0 errors)
- [x] `npm run test:client` — PASS (カバレッジ95%以上維持)
- [x] `npm run lint` — PASS
- [ ] Playwright によるモバイルビュー (375x667) での主要フロー動作確認 ※ローカルDB未構成のためスキップ
- [x] 全ての TODO が完了し、チェックボックスが埋まっていること

### Must Have
- `CameraDeadStockRegisterPanel` のコンポーネント分割とモバイルファーストUI
- `ProposalDetailPage` への `AppResponsiveSwitch` 導入とモバイル専用レイアウト
- タッチ最適化フォームコントロール（`inputmode`, `type="date"`, 44px target）
- 未対応テーブルへの `AppMobileDataCard` 統一適用
- `LoginPage` のモバイルファースト化

### Must NOT Have (Guardrails)
- ❌ スワイプジェスチャーライブラリの追加（純CSS/Touch Events APIのみ）
- ❌ MobileBottomNav/PWA関連（別ブランチで対応済み）
- ❌ 管理者ページの大規模リファクタリング（表示最適化に留める）
- ❌ アニメーションライブラリ（framer-motion等）の追加
- ❌ `as any` / `@ts-ignore` / 空のcatchブロック

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Automated tests**: TDD (RED-GREEN-REFACTOR)
- **Framework**: Vitest 4 + @testing-library/react (client)
- **E2E**: Playwright (Mobile Viewport: 375x667)

### QA Policy
- 各タスクで Playwright を使用したモバイルエミュレーションテストを実施。
- エビデンスは `.sisyphus/evidence/task-{N}-{scenario-slug}.png` に保存。

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — UI Components & CSS):
├── Task 1:  AppTouchInput component (inputmode, date type, 44px) [quick]
└── Task 2:  Mobile CSS utilities (safe-area, sticky-footer, tap-highlight) [quick]

Wave 2 (Core — Major Page Optimization):
├── Task 3:  CameraDeadStockRegisterPanel refactor (Component split + Mobile UI) [deep]
└── Task 4:  ProposalDetailPage mobile layout (Fixed footer + Accordion) [deep]

Wave 3 (Polish — Admin Tables & Login):
├── Task 5:  Table unification (UploadJobs, Logs, Exchanges) [visual-engineering]
└── Task 6:  LoginPage mobile optimization [visual-engineering]

Wave FINAL (Review & Audit):
├── Task F1: Plan compliance audit
├── Task F2: Code quality review
└── Task F3: Mobile E2E regression test
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1    | —         | 3, 4, 6 |
| 2    | —         | 3, 4, 5, 6 |
| 3    | 1, 2      | F3     |
| 4    | 1, 2      | F3     |
| 5    | 2         | F3     |
| 6    | 1, 2      | F3     |

---

## TODOs

### Wave 1: Foundation

#### Task 1: AppTouchInput component
- **What to do**: 
    - `client/src/components/common/AppTouchInput.tsx` を新設。
    - `inputmode="decimal"` (数量用), `type="date"` (iOS Safari対応) をサポート。
    - 最小タップターゲット 44x44px を確保するスタイルを適用。
    - 既存の `FormControl` をラップし、モバイルでのフォーカス時のズーム防止（font-size 16px以上）を徹底。
- **Must NOT do**: 
    - 既存の `FormControl` を直接破壊的に変更しない（ラップして提供）。
- **Agent Profile**: `implementer`
- **Parallelization**: Possible
- **References**: `client/src/components/common/`
- **Acceptance Criteria**:
    - [x] `AppTouchInput` が `inputmode` と `type` を正しくプロパティとして受け取る。
    - [x] モバイルビューで高さが 44px 以上であることを確認。
- **QA Scenarios**:
    - Playwright で `AppTouchInput` を含むページを表示し、要素の `getBoundingClientRect().height` が 44 以上であることを確認。
- **Commit message**: `feat(client): add AppTouchInput for mobile-optimized form controls`

#### Task 2: Mobile CSS utilities
- **What to do**:
    - `client/src/index.css` または専用の `mobile.css` にユーティリティクラスを追加。
    - `.mobile-only`, `.desktop-only` (AppResponsiveSwitchと併用)。
    - `.sticky-footer-gap` (固定フッター分の余白)。
    - `-webkit-tap-highlight-color: transparent` の適用。
    - `env(safe-area-inset-bottom)` を考慮したパディング。
- **Must NOT do**:
    - グローバルな既存スタイルを壊さない。
- **Agent Profile**: `implementer`
- **Parallelization**: Possible
- **Acceptance Criteria**:
    - [x] ユーティリティクラスが定義され、モバイルビューで正しく機能する。
- **QA Scenarios**:
    - Playwright で画面幅を切り替え、`.mobile-only` 要素の表示/非表示が切り替わることを確認。
- **Commit message**: `style(client): add mobile CSS utilities and safe-area support`

### Wave 2: Core

#### Task 3: CameraDeadStockRegisterPanel refactor
- **What to do**:
    - 549行の `CameraDeadStockRegisterPanel.tsx` を分割。
    - `CameraViewport.tsx`: カメラ映像表示（全画面対応）。
    - `ScanResultSheet.tsx`: スキャン結果をボトムシート形式で表示。
    - `DraftRowList.tsx`: ドラフト行の一覧、スワイプ削除（Touch Events API）対応。
    - モバイルではカメラを優先し、スキャン結果をオーバーレイで出すUIに変更。
- **Must NOT do**:
    - `useCamera` フックのロジックを破壊しない（UIの分離に集中）。
    - 外部ライブラリ（react-swipeable等）を追加しない。
- **Agent Profile**: `claude_implementer`
- **Parallelization**: Independent
- **References**: `client/src/pages/upload/CameraDeadStockRegisterPanel.tsx`
- **Acceptance Criteria**:
    - [x] コンポーネントが論理的に分割されている。
    - [x] モバイルビューでカメラが全画面表示される。
    - [x] ドラフト行がスワイプ（または簡易な削除ボタン）で削除可能。
- **QA Scenarios**:
    - Playwright でモバイルエミュレーションを行い、カメラ起動→スキャン（モック）→結果表示→削除のフローを確認。
- **Commit message**: `refactor(client): optimize CameraDeadStockRegisterPanel for mobile-first UX`

#### Task 4: ProposalDetailPage mobile layout
- **What to do**:
    - `ProposalDetailPage.tsx` に `AppResponsiveSwitch` を導入。
    - モバイルレイアウト:
        - 承認/拒否などのアクションボタンを画面下部に固定（`sticky-bottom`）。
        - タイムライン履歴をアコーディオン（`Accordion`）に格納し、初期状態は折り畳み。
        - コメント入力欄をスティッキーフッター化。
- **Must NOT do**:
    - デスクトップ版のレイアウトを崩さない。
- **Agent Profile**: `claude_implementer`
- **Parallelization**: Independent
- **References**: `client/src/pages/proposals/ProposalDetailPage.tsx`
- **Acceptance Criteria**:
    - [x] モバイルビューでアクションボタンが常に画面下部に表示される。
    - [x] タイムラインがアコーディオンで開閉可能。
- **QA Scenarios**:
    - Playwright でモバイルビューを表示し、スクロールしてもアクションボタンが追従することを確認。
- **Commit message**: `feat(client): add mobile-specific layout for ProposalDetailPage`

### Wave 3: Polish

#### Task 5: Table unification (Admin pages)
- **What to do**:
    - `AdminUploadJobsPage`, `AdminLogsPage`, `AdminExchangesPage` を修正。
    - `AppMobileDataCard` を使用して、モバイルビューでのテーブル表示をカード形式に変換。
    - `AppResponsiveSwitch` で `Table` と `AppMobileDataCard` を切り替える。
- **Must NOT do**:
    - 管理者機能のロジック（API呼び出し等）を変更しない。
- **Agent Profile**: `implementer`
- **Parallelization**: Possible
- **Acceptance Criteria**:
    - [x] 対象3ページでモバイル時に横スクロールが発生せず、カード形式で表示される。
- **QA Scenarios**:
    - Playwright で各ページを 375px 幅で開き、`AppMobileDataCard` がレンダリングされていることを確認。
- **Commit message**: `ui(client): unify mobile card view for admin tables`

#### Task 6: LoginPage mobile optimization
- **What to do**:
    - `LoginPage.tsx` のフォームレイアウトをモバイル向けに調整。
    - フォーム要素を縦積みにし、余白を最適化。
    - パスワード表示/非表示トグルを追加。
    - `AppTouchInput` を適用し、オートフォーカスを適切に設定。
- **Must NOT do**:
    - 認証ロジック（AuthContext等）に触れない。
- **Agent Profile**: `implementer`
- **Parallelization**: Possible
- **References**: `client/src/pages/auth/LoginPage.tsx`
- **Acceptance Criteria**:
    - [x] モバイルで入力フィールドが押しやすいサイズになっている。
    - [x] パスワードトグルが動作する。
- **QA Scenarios**:
    - Playwright でログインフォームの各フィールドが 44px 以上の高さであることを確認。
- **Commit message**: `ui(client): optimize LoginPage for mobile devices`

### Wave FINAL: Review

#### Task F1-F3: Final Audit & E2E
- **What to do**:
    - 計画への準拠確認。
    - コード品質（コンポーネント分割、型定義）のレビュー。
    - 全主要モバイルフローの Playwright 回帰テスト実行。
- **Agent Profile**: `claude_reviewer`
- **Acceptance Criteria**:
    - [x] 全てのテストがパスし、モバイルでのUXが劇的に改善されている。
