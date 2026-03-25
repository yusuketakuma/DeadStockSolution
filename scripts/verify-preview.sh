#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

run_step() {
  local label="$1"
  shift

  printf '[verify:preview] run: %s\n' "$label"
  "$@"
  printf '[verify:preview] ok: %s\n' "$label"
}

# CI runners occasionally need a rebuild to restore the correct Rollup binary.
run_step "rebuild rollup" npm rebuild rollup || true
run_step "lint" npm run lint
run_step "typecheck" npm run typecheck
run_step "test:server" npm run test:server
run_step "test:client" npm run test:client
run_step "test:integration:server" npm run test:integration:server
run_step "test:perf:server" npm run test:perf:server
run_step "openapi:check" npm run openapi:check
run_step "test:openapi-contract" npm run test:openapi-contract --workspace=server
run_step "audit:prod" npm run audit:prod
run_step "build:server" npm run build:server
run_step "build:client" npm run build:client
