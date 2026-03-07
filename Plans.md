# Plans.md — DeadStockSolution

> 詳細設計は [plan.md](./plan.md) を参照

## 🔴 進行中のタスク

（なし）

## 🟡 未着手のタスク

## Sprint: インフラ・DX改善 v0.0.10
> **目的**: Pre-commit hooks・モニタリング・依存関係管理・バンドル最適化・Lighthouse CI・CSP強化の6軸でインフラ・開発体験を底上げ

### Phase 1: Pre-commit Hooks [infra]
- [x] T201: Husky + lint-staged 導入 `cc:完了` [P]
  - husky v9 インストール、pre-commit hook 設定
  - lint-staged で staged files に ESLint + TypeScript チェック実行
  - npm scripts に `prepare` スクリプト追加
- [x] T202: コミットメッセージ lint 導入 `cc:完了` [P]
  - commitlint + @commitlint/config-conventional インストール
  - commit-msg hook で Conventional Commits 強制
  - commitlint.config.cjs 作成、.husky/commit-msg 作成 (2026-03-07)

### Phase 2: モニタリング強化 [monitoring]
- [x] T203: Sentry 統合 (サーバー) `cc:完了`
  - @sentry/node インストール、app.ts に初期化コード追加
  - error-handler ミドルウェアで Sentry.captureException 呼び出し
  - 環境変数 SENTRY_DSN 追加 (.env.example 更新)
- [x] T204: Sentry 統合 (クライアント) `cc:完了`
  - @sentry/react インストール、main.tsx に初期化コード追加
  - ErrorBoundary で Sentry レポート
  - 環境変数 VITE_SENTRY_DSN 追加
- [x] T205: ヘルスチェック拡充 `cc:完了`
  - 既存 /api/health に DB 接続確認・レスポンスタイム計測追加
  - /api/health/ready (readiness) エンドポイント追加
  - テスト追加

### Phase 3: 依存関係管理 [security]
- [x] T206: Dependabot 設定 `cc:完了` [P]
  - .github/dependabot.yml 作成 (npm, github-actions)
  - 週次チェック、auto-merge for patch updates
- [x] T207: npm audit CI ブロック強化 `cc:完了` [P]
  - CI で moderate 以上の脆弱性をブロック (現在 high のみ)
  - audit 結果をPR コメントに投稿する step 追加

### Phase 4: バンドル分析 [performance]
- [x] T208: vite-bundle-analyzer 導入 `cc:完了` [P]
  - rollup-plugin-visualizer インストール
  - npm script `analyze:client` 追加
  - CI でバンドルサイズレポート生成 (build 時)
- [x] T209: バンドルサイズ budget 設定 `cc:完了`
  - vite.config.ts に rollupOptions.output.manualChunks 最適化
  - CI でサイズ閾値チェック (警告のみ、初回)

### Phase 5: Lighthouse CI [performance]
- [x] T210: Lighthouse CI 導入 `cc:完了`
  - @lhci/cli ^0.14.0 インストール (devDependencies)
  - lighthouserc.cjs 作成 (staticDistDir: ./client/dist, numberOfRuns: 1)
  - .github/workflows/lighthouse.yml 追加 (PR トリガー, timeout 10min)
  - lighthouse スクリプト追加 (build:client && lhci autorun)
  - .gitignore に .lighthouseci/ 追加 (2026-03-07)

### Phase 6: CSP 強化 [security]
- [x] T211: Content Security Policy 拡充 `cc:完了`
  - Helmet CSP directives に report-uri / report-to, baseUri, formAction, upgradeInsecureRequests 追加
  - connectSrc に Sentry DSN ドメイン動的追加
  - Report-To ヘッダーミドルウェア追加 (CSP_REPORT_URI 環境変数制御)
- [x] T212: セキュリティヘッダー監査 `cc:完了`
  - Permissions-Policy ヘッダー追加 (camera=(self), microphone=(), geolocation=(), payment=())
  - Referrer-Policy を strict-origin-when-cross-origin に変更
  - セキュリティヘッダーテスト追加 (5テスト) (2026-03-07)

---

## 📦 アーカイブ

> 完了済みスプリントは `.claude/memory/archive/` に移動済み

- [医薬品マスター管理機能スプリント](.claude/memory/archive/Plans-completed-sprint-drug-master.md) — Phase 1-6 全完了 + Backlog (23タスク, archived 2026-02-25)
- [2026-02 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-02.md) — T001-T040: コード品質改善 / システム堅牢化 / 統合通知 / コード簡素化 (40タスク, archived 2026-03-01)
- [2026-03 スプリント群](.claude/memory/archive/Plans-completed-sprints-2026-03.md) — T041-T100: パフォーマンス改善 / タイムライン / 認証強化 / UX改善 / 統計 / 薬品マスター自動更新 (60タスク, archived 2026-03-02)
- [v0.0.8 + リファクタリング](.claude/memory/archive/Plans-completed-sprints-2026-03-v008-refactor.md) — T101-T114 + Wave 1-6 リファクタリング (archived 2026-03-07)
- [v0.0.9](.claude/memory/archive/Plans-completed-sprints-2026-03-v009.md) — T115-T127: セキュリティ・テスト・UX (archived 2026-03-07)
