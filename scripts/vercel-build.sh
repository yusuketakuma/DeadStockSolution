#!/usr/bin/env sh
set -eu

START_DIR="$(pwd)"

if [ -d "$START_DIR/client" ] && [ -d "$START_DIR/server" ]; then
  ROOT_DIR="$START_DIR"
elif [ -d "$START_DIR/../client" ] && [ -d "$START_DIR/../server" ]; then
  ROOT_DIR="$(cd "$START_DIR/.." && pwd)"
else
  echo "workspace layout not found"
  exit 1
fi

CLIENT_DIR="$ROOT_DIR/client"

# Seed test pharmacy accounts if configured (idempotent upsert)
if [ -n "${TEST_PHARMACY_SEED_JSON:-}" ]; then
  echo "[vercel-build] Seeding test pharmacy accounts..."
  npx --prefix "$ROOT_DIR" tsx "$ROOT_DIR/server/src/db/seed-test-pharmacy-accounts.ts" || echo "[vercel-build] Warning: test pharmacy seeding failed (non-fatal)"
fi

# Playwright accounts are only needed in non-production environments (preview/development)
if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "[vercel-build] Seeding Playwright verification accounts..."
  npx --prefix "$ROOT_DIR" tsx "$ROOT_DIR/server/src/db/seed-playwright-accounts.ts" || echo "[vercel-build] Warning: Playwright account seeding failed (non-fatal)"
else
  echo "[vercel-build] Skipping Playwright account seeding (production)"
fi

# Sync VERSION → package.json (ensures app version matches)
node "$ROOT_DIR/scripts/sync-version.mjs"

# Build client (Vite + SWC)
(
  cd "$CLIENT_DIR"
  npm run build
)

# Prune server devDependencies for smaller serverless function
npm prune --prefix "$ROOT_DIR" --workspace=server --omit=dev --no-audit --no-fund 2>/dev/null || true

if [ "$START_DIR" != "$CLIENT_DIR" ]; then
  rm -rf "$START_DIR/dist"
  cp -R "$CLIENT_DIR/dist" "$START_DIR/dist"
fi
