# DeadStockSolution overview

## Purpose
DeadStockSolution is an operational system for pharmacies to reduce dead stock by enabling cross-pharmacy inventory exchange. It centralizes inventory upload, matching suggestions, proposal workflow, notifications, and admin operations.

## Primary problem solved
- Reduce near-expiry / stagnant inventory loss
- Replace manual phone/FAX/mail exchange coordination
- Prevent missed proposal responses via centralized status tracking
- Improve operational decisions with dashboarded risk/exchange metrics

## Tech stack
- Monorepo: npm workspaces (`server/`, `client/`)
- Frontend: React 18 + TypeScript + Vite + React Router + React Bootstrap/Bootstrap
- Backend: Express 5 + TypeScript
- DB/ORM: Vercel Postgres (Neon) + Drizzle ORM
- Testing: Vitest (+ Testing Library on client, Supertest on server)
- Lint/typecheck: ESLint 9 + TypeScript strict mode
- Deploy: Vercel (preview/production flow)