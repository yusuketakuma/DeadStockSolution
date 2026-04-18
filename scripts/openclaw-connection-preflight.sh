#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${OPENCLAW_PRECHECK_BASE_URL:-https://dead-stock-solution.vercel.app}}"
TOKEN="${OPENCLAW_DDS_CONTROL_TOKEN:-}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openclaw-preflight.XXXXXX")"
HEALTH_JSON="${TMP_DIR}/dds_health.json"
CLAIM_BODY="${TMP_DIR}/dds_claim.body"
ADMIN_BODY="${TMP_DIR}/dds_admin.body"
HEARTBEAT_BODY="${TMP_DIR}/dds_heartbeat.body"
COMMANDS_BODY="${TMP_DIR}/dds_commands.body"
SUMMARY_JSON="${TMP_DIR}/openclaw-preflight-summary.json"

cleanup() {
  rm -rf "${TMP_DIR}"
}

trap cleanup EXIT

if ! command -v jq >/dev/null 2>&1; then
  echo "[ERROR] jq is required for health JSON parse."
  exit 2
fi

status_ok=true

log() { echo "[preflight] $*"; }
fail() { echo "[preflight][FAIL] $*"; status_ok=false; }
warn() { echo "[preflight][WARN] $*"; }

health_endpoint="${BASE_URL%/}/api/health/openclaw"
log "check $health_endpoint"
health_status_code=$(curl -sS -o "${HEALTH_JSON}" -w '%{http_code}' "$health_endpoint" || echo 000)
if [[ "$health_status_code" == "000" ]]; then
  printf '%s\n' '{"connector":{"configured":false},"webhook":{"configured":false},"ddsAgent":{"connected":false,"awaitingUser":0,"lastSeenAt":""}}' >"${HEALTH_JSON}"
  fail "health endpoint unreachable"
elif [[ "$health_status_code" != "200" ]]; then
  fail "health endpoint status=$health_status_code"
else
  connector_configured=$(jq -r '.connector.configured // false' "${HEALTH_JSON}")
  webhook_configured=$(jq -r '.webhook.configured // false' "${HEALTH_JSON}")
  dds_connected=$(jq -r '.ddsAgent.connected // false' "${HEALTH_JSON}")
  awaiting_user=$(jq -r '.ddsAgent.awaitingUser // 0' "${HEALTH_JSON}")
  last_seen=$(jq -r '.ddsAgent.lastSeenAt // "(none)"' "${HEALTH_JSON}")

  if [[ "$connector_configured" != "true" ]]; then
    fail "connector.configured = $connector_configured"
  fi
  if [[ "$webhook_configured" != "true" ]]; then
    fail "webhook.configured = $webhook_configured"
  fi
  if [[ "$dds_connected" != "true" ]]; then
    warn "ddsAgent.connected = $dds_connected (manual対応が必要になる可能性あり)"
  fi

  log "connector=$connector_configured webhook=$webhook_configured ddsConnected=$dds_connected awaitingUser=$awaiting_user lastSeen=$last_seen"
fi

# connect endpoint requires bearer token (expected unauthorized)
claim_endpoint="${BASE_URL%/}/api/openclaw/connect/jobs/claim"
claim_status=$(curl -sS -o "${CLAIM_BODY}" -w '%{http_code}' -X POST "$claim_endpoint" -H 'Content-Type: application/json' -d '{"noop":true}' || echo 000)
if [[ "$claim_status" == "000" ]]; then
  fail "jobs/claim endpoint unreachable"
elif [[ "$claim_status" != "401" && "$claim_status" != "204" && "$claim_status" != "503" ]]; then
  # 204 is possible for queue-empty when token valid; without token should be 401
  # 503 only in exceptional maintenance/infra state
  warn "jobs/claim without token status=$claim_status"
fi

# admin endpoint should require auth
admin_endpoint="${BASE_URL%/}/api/admin/openclaw/dds-agent"
admin_status=$(curl -sS -o "${ADMIN_BODY}" -w '%{http_code}' "$admin_endpoint" || echo 000)
if [[ "$admin_status" == "401" || "$admin_status" == "403" ]]; then
  log "admin DDS status endpoint auth is protected: $admin_status"
else
  warn "admin DDS status endpoint expected auth, got $admin_status"
fi

# optional control token loop check
if [[ -n "$TOKEN" ]]; then
  heartbeat_endpoint="${BASE_URL%/}/api/openclaw/connect/heartbeat"
  heartbeat_status=$(curl -sS -o "${HEARTBEAT_BODY}" -w '%{http_code}' -X POST "$heartbeat_endpoint" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"source":"preflight"}' || echo 000)
  if [[ "$heartbeat_status" != "200" ]]; then
    fail "heartbeat with token returned status=$heartbeat_status"
  else
    log "heartbeat token check passed"
  fi
fi

commands_endpoint="${BASE_URL%/}/api/openclaw/commands"
commands_status=$(curl -sS -o "${COMMANDS_BODY}" -w '%{http_code}' -X POST "$commands_endpoint" -H 'Content-Type: application/json' -d '{"command":"noop"}' || echo 000)
if [[ "$commands_status" == "503" ]]; then
  log "openclaw commands is intentionally disabled (expected in current env)"
elif [[ "$commands_status" != "401" ]]; then
  warn "openclaw commands status=$commands_status (expected 503 or 401)"
fi

cat > "${SUMMARY_JSON}" <<JSON
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "baseUrl": "$BASE_URL",
  "healthOk": $(jq -r '[.status == "ok" or .status == "degraded"] | any' "${HEALTH_JSON}" 2>/dev/null || echo false),
  "connectorConfigured": $(jq -r '.connector.configured // false' "${HEALTH_JSON}" 2>/dev/null || echo false),
  "webhookConfigured": $(jq -r '.webhook.configured // false' "${HEALTH_JSON}" 2>/dev/null || echo false),
  "ddsConnected": $(jq -r '.ddsAgent.connected // false' "${HEALTH_JSON}" 2>/dev/null || echo false),
  "awaitingUser": $(jq -r '.ddsAgent.awaitingUser // 0' "${HEALTH_JSON}" 2>/dev/null || echo 0),
  "lastSeenAt": "$(jq -r '.ddsAgent.lastSeenAt // ""' "${HEALTH_JSON}" 2>/dev/null || echo "")"
}
JSON

if [[ "$status_ok" == true ]]; then
  log "preflight succeeded"
  cat "${SUMMARY_JSON}"
  exit 0
else
  warn "preflight found issues"
  cat "${SUMMARY_JSON}"
  exit 1
fi
