# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
cd server && npx drizzle-kit push       # Push schema to DB

# Deploy (branch-gated)
npm run deploy:preview      # preview branch only
npm run deploy:prod         # main branch only
```

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
- Sub-agent role compatibility: Available roles are `implementer`, `claude_implementer`, `claude_reviewer`

## Task Completion Notification
When you complete a task, send this push notification:

```bash
curl -X POST https://api.getmoshi.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"token": "qGli1ov22jEY3PEtuI5qGXPJegjvRrFD", "title": "Done", "message": "Brief summary"}'
```
