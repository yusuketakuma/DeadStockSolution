#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export NODE_ENV="${NODE_ENV:-development}"
export VERCEL_ENV="${VERCEL_ENV:-}"
export POSTGRES_URL="${POSTGRES_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
export POSTGRES_URL_NON_POOLING="${POSTGRES_URL_NON_POOLING:-$POSTGRES_URL}"
export JWT_SECRET="${JWT_SECRET:-dev-local-jwt-secret}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:5173,http://localhost:5173}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:5173}"
export E2E_HELPER_SECRET="${E2E_HELPER_SECRET:-local-e2e-secret}"
export PLAYWRIGHT_SPEC="${PLAYWRIGHT_SPEC:-e2e/tests/proposal-flow.spec.ts}"
export PLAYWRIGHT_GREP="${PLAYWRIGHT_GREP:-ハッピーパス}"

if [[ -z "${TEST_PHARMACY_SEED_JSON:-}" ]]; then
  export TEST_PHARMACY_SEED_JSON='{"accounts":[{"id":1001,"name":"E2E テスト薬局A","email":"e2e-pharmacy-a@example.com","password":"Password123!","postalCode":"1000001","address":"東京都千代田区千代田1-1","phone":"03-0000-0001","fax":"03-0000-0002","licenseNumber":"E2E-LIC-A","prefecture":"東京都","latitude":35.6804,"longitude":139.7690},{"id":1002,"name":"E2E テスト薬局B","email":"e2e-pharmacy-b@example.com","password":"Password123!","postalCode":"5300001","address":"大阪府大阪市北区梅田1-1","phone":"06-0000-0001","fax":"06-0000-0002","licenseNumber":"E2E-LIC-B","prefecture":"大阪府","latitude":34.7025,"longitude":135.4959}]}'
fi

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

run_step "db:migrate" npm run db:migrate --workspace=server
run_step "db:seed-test-pharmacies" npm run db:seed-test-pharmacies --workspace=server

printf '[proposal-flow-e2e] run: start server\n'
npm run dev --workspace=server >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

printf '[proposal-flow-e2e] run: start client\n'
npm run dev --workspace=client -- --host 127.0.0.1 --port 5173 >"$CLIENT_LOG" 2>&1 &
CLIENT_PID=$!

wait_for_url "server health" "http://127.0.0.1:3001/api/health"
wait_for_url "client root" "$E2E_BASE_URL"

run_step "playwright proposal flow smoke" npx playwright test "$PLAYWRIGHT_SPEC" --project chromium --grep "$PLAYWRIGHT_GREP"
