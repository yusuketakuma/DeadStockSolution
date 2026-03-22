# Testing Conventions

## Canonical locations

- Client tests: `client/src/test/**`
- Server tests: `server/src/test/**`
- Shared test helpers: keep them under each package's `src/test/`

## Legacy locations

- Existing `client/src/**/__tests__/**` and `server/src/services/__tests__/**` are treated as legacy.
- When touching a legacy test substantially, prefer moving it into the canonical `src/test/**` tree instead of adding another sibling test.

## Naming

- Component/page tests: `<name>.test.tsx`
- Hook/util tests: `<name>.test.ts`
- Integration or end-to-end style UI tests: `src/test/e2e/**`

## Setup

- Client-wide setup remains `client/src/test/setup.ts`.
- Reusable render helpers should live alongside the canonical test tree, not inside feature-local `__tests__` directories.

## Migration rule

- Do not bulk-move the full legacy tree in one patch.
- Migrate opportunistically when the touched test already needs behavioral edits.
