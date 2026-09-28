# AGENTS.md

## Project Overview
薬局向けデッドストック管理システム。薬局間の在庫マッチングと厚生労働省の薬価基準データ連携を提供する。
在庫アップロード、マッチング候補自動生成、提案ワークフロー管理、通知・タイムライン、統計ダッシュボードを一つの画面で扱える。

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + React Bootstrap
- **Backend**: Express 5 + TypeScript + Drizzle ORM
- **Database**: Vercel Postgres (Neon)
- **Deploy**: Vercel (serverless)
- **Monorepo**: npm workspaces (`client/`, `server/`)
- **Test**: Vitest 4 + Supertest (server), Vitest + @testing-library/react (client)

## Key Commands
```bash
# Development
npm run dev:server          # Start backend (tsx watch)
npm run dev:client          # Start frontend (Vite)

# Build & Lint
npm run build:server        # tsc build
npm run build:client        # Vite build
npm run lint                # ESLint (both workspaces)
npm run typecheck            # TypeScript check (both workspaces)

# Test
npm run test                # All tests (server + client)
npm run test:server         # Server tests only
npm run test:client         # Client tests only
npm run test:integration:server  # PGlite integration tests
npm run test:perf:server    # Performance regression tests
npm run test:coverage       # Coverage report (both)

# Run single test file
cd server && npx vitest run src/test/some-file.test.ts
cd client && npx vitest run src/__tests__/some-file.test.ts

# Database
cd server && npx drizzle-kit generate   # Generate migration
cd server && npx drizzle-kit push       # disposable/local DB only; shared or production DB requires explicit approval

# Deploy (branch-gated; explicit human release gate)
npm run deploy:preview      # preview branch only
npm run deploy:prod         # main branch only
```

Plan-only and review-only requests stay read-only. Preserve unrelated dirty
changes and synthetic-only test data; do not infer production readiness from a
local build or deploy command.

## Architecture

### Backend (`server/src/`)
- **app.ts** — Express app setup; registers 31+ route modules via `app.use('/api/...', router)`. Global middleware: CORS, Helmet, compression, rate limiting, CSRF, auth, error handling.
- **routes/** — Express route handlers (one file per feature domain)
- **services/** — Business logic layer (called by routes)
- **db/schema.ts** — Single-file Drizzle ORM schema (all tables, enums, indexes, relations)
- **middleware/** — Auth (JWT), upload processing, etc.
- **Serverless entry**: `server/api/index.ts` (Vercel)

### Frontend (`client/src/`)
- **routes/route-config.tsx** — Central route metadata array (`ROUTE_META`) with lazy-loaded components. Routes typed as `PublicRouteMeta` or `ProtectedRouteMeta` (adminOnly, useLayout flags).
- **App.tsx** — Context providers (Auth, Timeline, Notification, Toast) + Suspense + route rendering
- **pages/** — Route-level page components
- **components/** — Reusable UI components
- **api/client.ts** — Axios-based API client
- **contexts/** — React contexts (auth, etc.)

### Data Flow
Routes → Services → Drizzle ORM → Vercel Postgres. Auth via JWT middleware. Frontend uses axios with auth token interceptor.

## Test Architecture
- **Server**: 232+ test files in `server/src/test/`. Route tests use supertest + mocked services. Service tests are pure unit tests.
- **Integration**: PGlite-based snapshot DDL generation (`server/src/test/integration/helpers/test-db.ts`)
- **Coverage thresholds**: Lines 95%, Functions 95%, Branches 86%
- **Performance**: bcrypt mocked in tests, `vi.useFakeTimers` for async optimization

## Conventions
- Language: Japanese for UI text and comments, English for code identifiers
- Database: All schema in single file `server/src/db/schema.ts`
- Auth: JWT-based (jsonwebtoken); middleware in `server/src/middleware/`
- API: REST; all routes registered in `server/src/app.ts`
- Frontend routing: React Router DOM v6 with lazy loading
- Styling: React Bootstrap + Bootstrap 5
- Git: `main` for production, `preview` for staging, feature branches for development
- Deploy: Vercel auto-deploy on main/preview only (`vercel.json` gating)

## Important Notes
- Environment variables: see `server/.env.example` and README.md (detailed env var reference)
- Vercel serverless entry: `server/api/index.ts`
- Excel/CSV parsing for MHLW pharmaceutical data integration (read-excel-file)
- 包装単位マスターは PMDA 添付文書情報XML から自動取込み (`DRUG_PACKAGE_SOURCE_URL`)
- Performance baseline: `npm run test:perf:update:server` to update, `npm run test:perf:server` to check

## Playwright Audits

Playwright を使った監査・改善実装を行うときは、毎回 ad-hoc に進めず、次を固定ルールとして扱うこと。

- source of truth はローカルに入っている Playwright CLI。まず `npx playwright --help` と `npx playwright test --list`、既存 `playwright.config.*` を確認する
- 記憶で CLI 機能を決め打ちしない。`test` / `show-report` / `codegen` / `show-trace` / `merge-reports` / `clear-cache` / `install --with-deps` と、`--debug` / `--headed` / `--ui` / `--project` / `--workers` / `--last-failed` / `--list` / `--trace` / `--update-snapshots` の可否は実環境で確認する
- 既存 config・reporter・auth state・testIdAttribute・project matrix を尊重し、置き換えではなく拡張を優先する
- 監査は「動くか」ではなく「壊れ方・使いづらさ・backend/frontend 不整合・設計臭まで拾う」前提で行う
- locator は `role` / `text` / `test id` 優先。`codegen` は locator 偵察用であり、生の生成コードは commit しない
- auto-wait と web-first assertions を優先し、`sleep` や hydration 待ちのごまかしを入れない
- hydration 不良、console error、page error、network failure、service worker 起因の観測欠落はテスト都合ではなくプロダクト不具合候補として扱う
- 必要に応じて visual comparison、screenshot masking / stylePath、ARIA snapshots、axe、device / locale / timezone / colorScheme / offline / permissions / JS disabled / reduced motion、Clock、APIRequestContext、Chromium coverage、component testing を使う
- 監査結果は必ずファイルに残す。標準成果物は `audits/playwright-audit-report.md` と `artifacts/playwright-audit/` 配下
- 修正可能な問題は監査だけで終わらせず、最小変更で実装し、proof test まで追加する
- 終了前に、関連 Playwright tests、影響範囲の unit/component tests、lint、typecheck、build を回し、pre-existing failure と今回起因を分けて報告する

長い実行プロンプトは repo ルートの `PROMPT_PLAYWRIGHT_AUDIT_MASTER.md` を使うこと。毎回の task prompt には URL・認証・優先フロー・既知の pain point だけを渡す。

Codex CLI の定型例:

```bash
cat PROMPT_PLAYWRIGHT_AUDIT_MASTER.md | codex exec --cd . --sandbox workspace-write --output-last-message audits/codex-final.md -
```

## Devin Wiki

`.devin/wiki.md` が存在する場合、Devin Cloud がこのリポジトリ用に生成した wiki へのリンクである。
アーキテクチャ、モジュール配置、ドメイン用語などプロジェクトレベルの質問に答える前にまず読み、
その後で実コードと照合する。無い場合は `~/.local/share/devin/cli/wiki/*/meta.json` の
`repo_identifier` を `git remote get-url origin` 由来の `host/owner/repo` と照合し、一致する
ディレクトリの `wiki.md` を参照する。`devin-wiki-sync` を実行するとリンクが更新される。
wiki は概要把握の補助であり、正本は常にこのリポジトリのコードとドキュメントとする。

## Semantic code search (jevgrep) — 積極的な利用

- `jg` をコード理解・実装箇所の発見・挙動調査・影響範囲の把握・リファクタリングの初期探索に積極的に使う。場所や関係が未確定な探索では、広範な `rg` や手当たり次第のファイル読取りより先に自然言語で検索する。
- 全体調査では、質問に関係する主要なコード領域を横断する検索、または領域ごとの検索を行う。安全確認済みの実ソースを対象とし、単一の小さなサンプル検索だけで全体探索を代替しない。新たな責務・呼出関係が不明になったら追加検索するが、同じ疑問への十分な結果は再利用する。
- `jg` の結果で候補を絞り、実ファイルを直接読み、`rg`/LSP で正確な参照・文字列・呼出元を確認する。既知のファイルの読取りや正確なシンボル検索、単純な局所修正では直接 `rg`/read を使ってよい。
- 外部送信は下記の継続承認と保護条件に従う。機密混在なら安全なサブツリーまたは確認済みファイル群のコピーを使う。利用不能・認証/通信エラー・安全に送信できない場合は理由を示してローカル探索へ進み、検索結果の不完全さを隠さない。
- 調査報告では `jg` の対象領域と重要な未探索範囲を簡潔に示す。結果は探索の手掛かりであり、正しさ・網羅性・テスト成功の証明にはしない。

## Semantic code search (jevgrep) — 外部送信の継続承認

- ユーザー承認（2026-09-28）: 全リポジトリで、コード探索・理解・動作確認のために `jg` がソースコードと検索質問を設定済み provider および Jevgrep の処理サービスへ外部送信することを許可する。非公開リポジトリのコードも対象とし、この範囲では都度の確認を不要とする。
- この条項を jevgrep の外部送信に関する明示承認として扱う。一般的な外部送信の事前承認条項についても、この範囲の承認は充足済みとする。
- PHI/PII・認証情報・secret・本番/実データ・送信権限のない第三者資料は対象外。実行前に検索対象を確認し、これらを含むファイルを除外する。混在する場合は安全なサブディレクトリまたは確認済みファイルの一時コピーを検索する。
- 必要に応じてリポジトリ全体を検索してよい。`--hidden` / `--no-ignore` / `--include-dependencies` 等も、拡張される対象の安全性を確認した上で利用できる。`--include-sensitive` によって上記の送信禁止情報を送ってはならない。既定の除外機能だけを安全性の保証としない。
- この承認は jevgrep による検索に限定する。他の外部送信、公開、push、PR、merge、deploy、本番変更、契約・課金プランの変更は別の承認範囲とする。検索結果は参照情報として扱い、変更前に実ソースを確認する。
