# Coding style and conventions

## Language and typing
- TypeScript is used across client/server.
- Both client and server enable `strict` mode in tsconfig.
- Server builds to CommonJS (`tsconfig.build.json`), client uses Vite/bundler settings.

## Linting rules in this repo
- ESLint flat config (`eslint.config.mjs`) with TypeScript ESLint recommended presets.
- React Hooks rules are enabled for client code.
- Several strict TS lint rules are intentionally relaxed in this project:
  - `@typescript-eslint/no-explicit-any`: off
  - `@typescript-eslint/no-unused-vars`: off
  - `@typescript-eslint/ban-ts-comment`: off
  - `@typescript-eslint/no-non-null-assertion`: off

## Code patterns observed
- Server route files are organized by domain and mounted in `server/src/app.ts`.
- `services/` hosts business logic and schedulers; routes stay as thin HTTP adapters.
- Client uses provider composition (`AuthProvider`, `NotificationProvider`, etc.) and route metadata.
- Common style in source files: single quotes, semicolons, explicit function boundaries.

## Naming/documentation conventions
- UI and many user-facing strings are Japanese.
- Code identifiers are English and domain-oriented.
- Comments are used selectively for operational context (e.g., scheduler start/stop, webhook raw-body rationale).