# ESLint 10 Upgrade Plan

## Background

Dependabot bumped `eslint` from `9.39.4` to `10.1.0`, but the PR broke CI and was reverted.
This document records the research findings and the step-by-step plan for a safe upgrade.

---

## Current State

### Config format

The project already uses **flat config** (`eslint.config.mjs` at the repo root).
ESLint 9's flat config is fully compatible with ESLint 10 — **no config format migration is required**.

```
/eslint.config.mjs   ← single flat config, covers client/ and server/
```

### Current versions (as of revert)

| Package | Version | ESLint 10 compatible? |
|---|---|---|
| `eslint` | 9.39.4 | — (current) |
| `@eslint/js` | 9.39.4 | needs `@eslint/js@10.x` |
| `typescript-eslint` | 8.57.1 | yes (`^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0`) |
| `eslint-plugin-react-hooks` | 7.0.1 (root) / 5.2.0 (client ws) | **no** (peer dep stops at `^9.0.0`) |
| `eslint-plugin-react-refresh` | 0.5.2 | yes (`^9 \|\| ^10`) |
| `globals` | 17.4.0 | yes (no eslint peer dep) |

---

## Breaking Changes in ESLint 10

### 1. Flat config is now mandatory

ESLint 10 removes the legacy `.eslintrc.*` loader entirely. This project already uses `eslint.config.mjs`, so **no action needed here**.

### 2. Node.js engine requirement raised

ESLint 10 requires **Node `^20.19.0 || ^22.13.0 || >=24`**. The project targets Node 24.14.1, so this is satisfied.

### 3. `jiti` is a required peer dependency

ESLint 10 added `jiti: '*'` as a peer dependency (used for loading TypeScript config files). `jiti` must be present at runtime.

### 4. `@eslint/js` major version bump

`@eslint/js` must be upgraded from `9.x` to `10.x` in lockstep with `eslint`.

---

## Plugin Compatibility Analysis

### eslint-plugin-react-hooks — **BLOCKER**

| Version | ESLint peer dep |
|---|---|
| 7.0.1 (current) | `^3 \|\| ^4 \|\| ^5 \|\| ^6 \|\| ^7 \|\| ^8 \|\| ^9` — **ESLint 10 not listed** |
| 7.1.0-canary (next) | `^3 ... \|\| ^10` — adds ESLint 10 support |

**Root cause of the CI failure**: `eslint-plugin-react-hooks@7.0.1` declares ESLint 10 as an incompatible peer, causing `npm install` (or `npm ci`) to produce peer dependency errors, which can break the lint step.

The canary tag `7.1.0-canary-9627b5a1-20260327` supports ESLint 10. A stable `7.1.0` release is not yet published; the `latest` tag is still `7.0.1`.

**Options**:
- Wait for `eslint-plugin-react-hooks@7.1.0` stable release.
- Use the canary version with `--legacy-peer-deps` override (not recommended for production CI).
- Pin with an `overrides` entry and accept the peer warning (medium risk).

### typescript-eslint — OK

`typescript-eslint@8.57.1` (and the latest `8.57.2`) already declares `eslint: "^8.57.0 || ^9.0.0 || ^10.0.0"`. No version bump needed; a minor patch to `8.57.2` is available but optional.

### eslint-plugin-react-refresh — OK

`eslint-plugin-react-refresh@0.5.2` declares `eslint: "^9 || ^10"`. No change needed.

### globals — OK

No eslint peer dependency. No change needed.

---

## Step-by-Step Migration Plan

### Phase 1 — Prerequisites (do now, unblocked)

1. **Verify CI Node version**
   `ci.yml` already uses `node-version: 24.14.1` which satisfies ESLint 10's engine requirement. No change needed.

2. **Install `jiti`** (new peer dep for ESLint 10)
   ```bash
   npm install --save-dev jiti
   ```
   Add `jiti` to root `devDependencies` in `package.json`.

### Phase 2 — Wait for react-hooks stable support

Monitor the `eslint-plugin-react-hooks` release page for version `7.1.0` stable (the canary already supports ESLint 10).

Check current state at any time:
```bash
npm info eslint-plugin-react-hooks dist-tags
```

### Phase 3 — Upgrade (once react-hooks 7.1.0 is stable)

Run the following as a single atomic change:

```bash
npm install --save-dev \
  eslint@^10.1.0 \
  "@eslint/js@^10.0.0" \
  eslint-plugin-react-hooks@^7.1.0
```

Verify that the `client` workspace does not have a stale `eslint-plugin-react-hooks@5.2.0` pinned separately:
```bash
npm ls eslint-plugin-react-hooks
```
If `client` still resolves to 5.x, add an `overrides` entry in root `package.json`:
```json
"overrides": {
  "eslint-plugin-react-hooks": "^7.1.0"
}
```

### Phase 4 — Validate

```bash
npm run lint          # must pass with zero errors
npm run typecheck     # unaffected, but run for safety
npm run test          # unaffected, but run for confidence
```

Check for new lint warnings introduced by ESLint 10's stricter rule defaults:
```bash
npm run lint 2>&1 | grep "warning\|error" | head -50
```

### Phase 5 — CI verification

Open a PR from a feature branch (not directly to `main` or `preview`).
The `lint-typecheck` job in CI must pass before merging.

---

## Estimated Effort

| Task | Effort |
|---|---|
| Install `jiti` | < 5 min |
| Wait for `react-hooks@7.1.0` stable | blocked on upstream (canary exists as of 2026-03-27) |
| Upgrade eslint + @eslint/js + react-hooks | 15 min |
| Local validation (lint + typecheck) | 10 min |
| PR + CI green | 30 min (CI time) |
| **Total active work** | **~1 hour** |

The main blocker is `eslint-plugin-react-hooks@7.1.0` not yet being stable.
No changes to `eslint.config.mjs` are expected since the project already uses flat config.

---

## Reference

- ESLint 10 migration guide: https://eslint.org/docs/latest/use/migrate-to-10.0.0
- react-hooks canary: `7.1.0-canary-9627b5a1-20260327` (peerDep includes `^10`)
- typescript-eslint ESLint 10 support: added in 8.x (no upgrade needed)
