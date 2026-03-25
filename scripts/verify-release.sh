#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

run_step() {
  local label="$1"
  shift

  printf '[verify:release] run: %s\n' "$label"
  "$@"
  printf '[verify:release] ok: %s\n' "$label"
}

release_smoke_url="${RELEASE_SMOKE_BASE_URL:-${SMOKE_BASE_URL:-}}"
release_require_smoke="${RELEASE_REQUIRE_SMOKE:-1}"
release_protection_bypass="${RELEASE_PROTECTION_BYPASS:-${SMOKE_PROTECTION_BYPASS:-${PREVIEW_PROTECTION_BYPASS:-${VERCEL_AUTOMATION_BYPASS_SECRET:-}}}}"

run_step "verify:preview" npm run verify:preview

if [[ -n "$release_smoke_url" ]]; then
  run_step "smoke:release-candidate" env \
    SMOKE_BASE_URL="$release_smoke_url" \
    SMOKE_PROTECTION_BYPASS="$release_protection_bypass" \
    npm run smoke:preview
elif [[ "$release_require_smoke" == "1" ]]; then
  run_step "smoke:release-candidate" env \
    SMOKE_PROTECTION_BYPASS="$release_protection_bypass" \
    npm run smoke:preview
else
  printf '[verify:release] skip: smoke:release-candidate (set RELEASE_SMOKE_BASE_URL to enforce deployment smoke)\n'
fi
