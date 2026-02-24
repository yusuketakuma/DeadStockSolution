# CLAUDE.md — DeadStockSolution

## Project Overview
薬局向けデッドストック（不動在庫）管理システム。薬局間の在庫マッチングと厚生労働省の薬価基準データ連携を提供する。

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + React Bootstrap
- **Backend**: Express 5 + TypeScript + Drizzle ORM
- **Database**: Vercel Postgres (Neon)
- **Deploy**: Vercel (serverless)
- **Monorepo**: npm workspaces (`client/`, `server/`)

## Key Commands
```bash
# Development
npm run dev:server          # Start backend dev server
npm run dev:client          # Start frontend dev server

# Build
npm run build:server        # Build backend
npm run build:client        # Build frontend

# Test
npm run test                # Run all tests
npm run test:server         # Server tests only
npm run test:client         # Client tests (Vitest)

# Database
cd server && npx drizzle-kit generate   # Generate migration
cd server && npx drizzle-kit push       # Push schema to DB

# Deploy
npm run deploy:preview      # Preview deployment
npm run deploy:prod         # Production deployment
```

## Architecture
```
client/src/
  pages/           # Page components (route-level)
  components/      # Reusable UI components
  api/client.ts    # API client (axios-based)
  contexts/        # React contexts (auth, etc.)
  App.tsx           # Routes definition

server/src/
  routes/          # Express route handlers
  services/        # Business logic
  db/schema.ts     # Drizzle ORM schema (single file)
  middleware/       # Express middleware (auth, etc.)
  utils/           # Utilities
  app.ts           # Express app setup
  server.ts        # Entry point
```

## Conventions
- Language: Japanese for UI text and comments, English for code identifiers
- Database: Drizzle ORM with Vercel Postgres; all schema in `server/src/db/schema.ts`
- Auth: JWT-based (jsonwebtoken); middleware in `server/src/middleware/`
- API: REST; routes registered in `server/src/app.ts`
- Frontend routing: React Router DOM v6
- Styling: React Bootstrap + Bootstrap 5
- Git: main branch for production; feature branches for development
- Deploy: Vercel auto-deploy on main/preview branches (vercel.json gating)

## Important Notes
- Environment variables: see `server/.env.example`
- Never commit `.env` files
- Vercel serverless entry: `server/api/index.ts`
- Excel/CSV parsing for MHLW pharmaceutical data integration
