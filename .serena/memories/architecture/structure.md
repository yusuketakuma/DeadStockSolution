# Codebase structure

## Top-level
- `client/`: frontend app
- `server/`: backend API and schedulers
- `scripts/`: deployment/quality/OpenAPI scripts
- `docs/`: operational and remediation docs

## Frontend (`client/src`)
- `pages/`: route-level screens
- `components/`: reusable UI + feature components
- `api/`: API client layer
- `contexts/`: auth/notification/timeline/toast providers
- `hooks/`, `utils/`, `types/`, `styles/`, `routes/`
- Entry: Vite app (dev via `npm run dev:client`)

## Backend (`server/src`)
- `app.ts`: Express app/middleware/routes wiring
- `server.ts`: process entrypoint + scheduler boot/shutdown
- `routes/`: REST endpoints
- `services/`: business logic, schedulers, logging, integrations
- `db/`: schema/migrations/DB utilities
- `middleware/`, `config/`, `utils/`, `types/`, `test/`

## Runtime entrypoints
- Backend dev: `npm run dev:server`
- Backend prod runtime: `npm run build:server` then `npm run start --workspace=server`
- Frontend dev: `npm run dev:client`
- Frontend preview runtime: `npm run build:client` then `npm run preview --workspace=client`