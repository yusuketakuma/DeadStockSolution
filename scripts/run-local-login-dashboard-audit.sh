#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/playwright-local-db.sh"

LOCAL_POSTGRES_ADMIN_URL="$(resolve_local_postgres_admin_url)"
assert_local_postgres_admin_url "$LOCAL_POSTGRES_ADMIN_URL"

export NODE_ENV="${NODE_ENV:-development}"
export VERCEL_ENV=""
export JWT_SECRET="${JWT_SECRET:-deadstock-local-login-dashboard-audit-jwt-secret-2026}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:5173,http://localhost:5173}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:5173}"
export E2E_SERVER_PORT="${E2E_SERVER_PORT:-3101}"
export E2E_SERVER_BASE_URL="${E2E_SERVER_BASE_URL:-http://127.0.0.1:${E2E_SERVER_PORT}}"
export VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-$E2E_SERVER_BASE_URL}"
export VITE_TEST_LOGIN_FEATURE_ENABLED="${VITE_TEST_LOGIN_FEATURE_ENABLED:-true}"
export TEST_LOGIN_FEATURE_ENABLED="${TEST_LOGIN_FEATURE_ENABLED:-true}"
export RUN_MIGRATION_SMOKE="${RUN_MIGRATION_SMOKE:-0}"
export PLAYWRIGHT_OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR:-artifacts/playwright-audit/test-results/login-dashboard}"
export PLAYWRIGHT_HTML_OUTPUT_DIR="${PLAYWRIGHT_HTML_OUTPUT_DIR:-artifacts/playwright-audit/reports/html/login-dashboard}"
export PLAYWRIGHT_JSON_REPORT_FILE="${PLAYWRIGHT_JSON_REPORT_FILE:-artifacts/playwright-audit/reports/json/login-dashboard-audit.json}"
export PLAYWRIGHT_SUMMARY_FILE="${PLAYWRIGHT_SUMMARY_FILE:-artifacts/playwright-audit/reports/json/summary.json}"
export PLAYWRIGHT_TRACE_ARCHIVE_DIR="${PLAYWRIGHT_TRACE_ARCHIVE_DIR:-artifacts/playwright-audit/traces}"

APP_DB_NAME="login_dashboard_audit_${RANDOM}_$$"
MIGRATION_SMOKE_DB="login_dashboard_migrate_${RANDOM}_$$"
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
    printf '\n[local-login-dashboard-audit] server log\n'
    sed -n '1,220p' "$SERVER_LOG" || true
    printf '\n[local-login-dashboard-audit] client log\n'
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

  printf '[local-login-dashboard-audit] run: %s\n' "$label"
  "$@"
  printf '[local-login-dashboard-audit] ok: %s\n' "$label"
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local attempts="${3:-60}"

  for ((i = 1; i <= attempts; i += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      printf '[local-login-dashboard-audit] ok: %s\n' "$label"
      return 0
    fi
    sleep 1
  done

  printf '[local-login-dashboard-audit] fail: %s (%s)\n' "$label" "$url" >&2
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
  printf '[local-login-dashboard-audit] skip: db:migrate smoke (set RUN_MIGRATION_SMOKE=1 to reproduce clean-db migration issues)\n'
fi
run_step "db:seed-playwright-accounts" npm run db:seed-playwright-accounts --workspace=server

printf '[local-login-dashboard-audit] run: start server\n'
PORT="$E2E_SERVER_PORT" npm run dev --workspace=server >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

printf '[local-login-dashboard-audit] run: start client\n'
npm run dev --workspace=client -- --host 127.0.0.1 --port 5173 >"$CLIENT_LOG" 2>&1 &
CLIENT_PID=$!

wait_for_url "server health" "$E2E_SERVER_BASE_URL/api/health"
wait_for_url "client root" "$E2E_BASE_URL"

run_step \
  "playwright login/dashboard" \
  env \
    PLAYWRIGHT_HTML_OUTPUT_DIR="$PLAYWRIGHT_HTML_OUTPUT_DIR" \
    PLAYWRIGHT_HTML_OPEN=never \
    PLAYWRIGHT_JSON_OUTPUT_FILE="$PLAYWRIGHT_JSON_REPORT_FILE" \
    npx playwright test dev/e2e/tests/login-smoke.spec.ts dev/e2e/tests/dashboard-runtime-audit.spec.ts \
      --project chromium \
      --workers=1 \
      --trace on \
      --output "$PLAYWRIGHT_OUTPUT_DIR" \
      --reporter=list,html,json

copy_playwright_traces "$PLAYWRIGHT_OUTPUT_DIR" "$PLAYWRIGHT_TRACE_ARCHIVE_DIR" "login-dashboard-"
run_step "generate summary" generate_playwright_summary "$ROOT_DIR" "$PLAYWRIGHT_SUMMARY_FILE" "$E2E_BASE_URL" "$E2E_SERVER_BASE_URL" "login-dashboard"
