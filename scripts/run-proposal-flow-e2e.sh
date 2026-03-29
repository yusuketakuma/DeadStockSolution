#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/playwright-local-db.sh"

LOCAL_POSTGRES_ADMIN_URL="$(resolve_local_postgres_admin_url)"
assert_local_postgres_admin_url "$LOCAL_POSTGRES_ADMIN_URL"

export NODE_ENV="${NODE_ENV:-development}"
export VERCEL_ENV=""
export JWT_SECRET="${JWT_SECRET:-deadstock-proposal-flow-e2e-jwt-secret-2026}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:5173,http://localhost:5173}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:5173}"
export E2E_HELPER_SECRET="${E2E_HELPER_SECRET:-local-e2e-secret}"
export E2E_SERVER_PORT="${E2E_SERVER_PORT:-3101}"
export E2E_SERVER_BASE_URL="${E2E_SERVER_BASE_URL:-http://127.0.0.1:${E2E_SERVER_PORT}}"
export VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-$E2E_SERVER_BASE_URL}"
export PLAYWRIGHT_SPEC="${PLAYWRIGHT_SPEC:-e2e/tests/proposal-flow.spec.ts}"
export PLAYWRIGHT_GREP="${PLAYWRIGHT_GREP:-}"
export RUN_MIGRATION_SMOKE="${RUN_MIGRATION_SMOKE:-0}"
export PLAYWRIGHT_OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR:-artifacts/playwright-audit/test-results/proposal-flow}"
export PLAYWRIGHT_HTML_OUTPUT_DIR="${PLAYWRIGHT_HTML_OUTPUT_DIR:-artifacts/playwright-audit/reports/html/proposal-flow}"
export PLAYWRIGHT_JSON_REPORT_FILE="${PLAYWRIGHT_JSON_REPORT_FILE:-artifacts/playwright-audit/reports/json/proposal-flow-audit.json}"
export PLAYWRIGHT_SUMMARY_FILE="${PLAYWRIGHT_SUMMARY_FILE:-artifacts/playwright-audit/reports/json/summary.json}"
export PLAYWRIGHT_TRACE_ARCHIVE_DIR="${PLAYWRIGHT_TRACE_ARCHIVE_DIR:-artifacts/playwright-audit/traces}"

if [[ -z "${TEST_PHARMACY_SEED_JSON:-}" ]]; then
  export TEST_PHARMACY_SEED_JSON='{"accounts":[{"id":1001,"name":"E2E テスト薬局A","email":"e2e-pharmacy-a@example.com","password":"Password123!","postalCode":"1000001","address":"東京都千代田区千代田1-1","phone":"03-0000-0001","fax":"03-0000-0002","licenseNumber":"E2E-LIC-A","prefecture":"東京都","latitude":35.6804,"longitude":139.7690},{"id":1002,"name":"E2E テスト薬局B","email":"e2e-pharmacy-b@example.com","password":"Password123!","postalCode":"5300001","address":"大阪府大阪市北区梅田1-1","phone":"06-0000-0001","fax":"06-0000-0002","licenseNumber":"E2E-LIC-B","prefecture":"大阪府","latitude":34.7025,"longitude":135.4959}]}'
fi

APP_DB_NAME="proposal_flow_app_${RANDOM}_$$"
MIGRATION_SMOKE_DB="proposal_flow_migrate_${RANDOM}_$$"
APP_DB_URL="$(build_temp_postgres_url "$LOCAL_POSTGRES_ADMIN_URL" "$APP_DB_NAME")"
export POSTGRES_URL="$APP_DB_URL"
export POSTGRES_URL_NON_POOLING="$APP_DB_URL"

SERVER_LOG="$(mktemp)"
CLIENT_LOG="$(mktemp)"
SERVER_PID=""
CLIENT_PID=""

cleanup() {
  local exit_code=$?

  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$CLIENT_PID" ]] && kill -0 "$CLIENT_PID" >/dev/null 2>&1; then
    kill "$CLIENT_PID" >/dev/null 2>&1 || true
    wait "$CLIENT_PID" >/dev/null 2>&1 || true
  fi

  if [[ $exit_code -ne 0 ]]; then
    printf '\n[proposal-flow-e2e] server log\n'
    sed -n '1,220p' "$SERVER_LOG" || true
    printf '\n[proposal-flow-e2e] client log\n'
    sed -n '1,220p' "$CLIENT_LOG" || true
  fi

  drop_temp_postgres_db "$LOCAL_POSTGRES_ADMIN_URL" "$MIGRATION_SMOKE_DB" >/dev/null 2>&1 || true
  drop_temp_postgres_db "$LOCAL_POSTGRES_ADMIN_URL" "$APP_DB_NAME" >/dev/null 2>&1 || true

  rm -f "$SERVER_LOG" "$CLIENT_LOG"
}

trap cleanup EXIT

run_step() {
  local label="$1"
  shift

  printf '[proposal-flow-e2e] run: %s\n' "$label"
  "$@"
  printf '[proposal-flow-e2e] ok: %s\n' "$label"
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local attempts="${3:-60}"

  for ((i = 1; i <= attempts; i += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      printf '[proposal-flow-e2e] ok: %s\n' "$label"
      return 0
    fi
    sleep 1
  done

  printf '[proposal-flow-e2e] fail: %s (%s)\n' "$label" "$url" >&2
  return 1
}

mkdir -p "$(dirname "$PLAYWRIGHT_JSON_REPORT_FILE")" "$PLAYWRIGHT_HTML_OUTPUT_DIR" "$PLAYWRIGHT_OUTPUT_DIR" "$PLAYWRIGHT_TRACE_ARCHIVE_DIR"

run_step "create app db" create_temp_postgres_db "$LOCAL_POSTGRES_ADMIN_URL" "$APP_DB_NAME"
run_step "db:push" npm run db:push --workspace=server
if [[ "$RUN_MIGRATION_SMOKE" == "1" ]]; then
  run_step "create migration smoke db" create_temp_postgres_db "$LOCAL_POSTGRES_ADMIN_URL" "$MIGRATION_SMOKE_DB"
  MIGRATION_SMOKE_URL="$(build_temp_postgres_url "$LOCAL_POSTGRES_ADMIN_URL" "$MIGRATION_SMOKE_DB")"
  run_step \
    "db:migrate smoke" \
    env POSTGRES_URL="$MIGRATION_SMOKE_URL" POSTGRES_URL_NON_POOLING="$MIGRATION_SMOKE_URL" npm run db:migrate --workspace=server
else
  printf '[proposal-flow-e2e] skip: db:migrate smoke (set RUN_MIGRATION_SMOKE=1 to reproduce clean-db migration issues)\n'
fi
run_step "db:seed-playwright-accounts" npm run db:seed-playwright-accounts --workspace=server
run_step "db:seed-test-pharmacies" npm run db:seed-test-pharmacies --workspace=server

printf '[proposal-flow-e2e] run: start server\n'
PORT="$E2E_SERVER_PORT" npm run dev --workspace=server >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

printf '[proposal-flow-e2e] run: start client\n'
npm run dev --workspace=client -- --host 127.0.0.1 --port 5173 >"$CLIENT_LOG" 2>&1 &
CLIENT_PID=$!

wait_for_url "server health" "$E2E_SERVER_BASE_URL/api/health"
wait_for_url "client root" "$E2E_BASE_URL"

playwright_args=(test "$PLAYWRIGHT_SPEC" --project chromium)
if [[ -n "$PLAYWRIGHT_GREP" ]]; then
  playwright_args+=(--grep "$PLAYWRIGHT_GREP")
fi

run_step \
  "playwright proposal flow" \
  env \
    PLAYWRIGHT_HTML_OUTPUT_DIR="$PLAYWRIGHT_HTML_OUTPUT_DIR" \
    PLAYWRIGHT_HTML_OPEN=never \
    PLAYWRIGHT_JSON_OUTPUT_FILE="$PLAYWRIGHT_JSON_REPORT_FILE" \
    npx playwright "${playwright_args[@]}" --workers=1 --trace on --output "$PLAYWRIGHT_OUTPUT_DIR" --reporter=list,html,json

copy_playwright_traces "$PLAYWRIGHT_OUTPUT_DIR" "$PLAYWRIGHT_TRACE_ARCHIVE_DIR" "proposal-flow-"
run_step "generate summary" generate_playwright_summary "$ROOT_DIR" "$PLAYWRIGHT_SUMMARY_FILE" "$E2E_BASE_URL" "$E2E_SERVER_BASE_URL" "proposal-flow"
