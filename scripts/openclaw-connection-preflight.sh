#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${OPENCLAW_PRECHECK_BASE_URL:-https://dead-stock-solution.vercel.app}}"
TOKEN="${OPENCLAW_DDS_CONTROL_TOKEN:-}"

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
health_status_code=$(curl -sS -o /tmp/dds_health.json -w '%{http_code}' "$health_endpoint")
if [[ "$health_status_code" != "200" ]]; then
  fail "health endpoint status=$health_status_code"
else
  connector_configured=$(jq -r '.connector.configured // false' /tmp/dds_health.json)
  webhook_configured=$(jq -r '.webhook.configured // false' /tmp/dds_health.json)
  dds_connected=$(jq -r '.ddsAgent.connected // false' /tmp/dds_health.json)
  awaiting_user=$(jq -r '.ddsAgent.awaitingUser // 0' /tmp/dds_health.json)
  last_seen=$(jq -r '.ddsAgent.lastSeenAt // "(none)"' /tmp/dds_health.json)

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
claim_status=$(curl -sS -o /tmp/dds_claim.body -w '%{http_code}' -X POST "$claim_endpoint" -H 'Content-Type: application/json' -d '{"noop":true}' || echo 000)
if [[ "$claim_status" == "000" ]]; then
  fail "jobs/claim endpoint unreachable"
elif [[ "$claim_status" != "401" && "$claim_status" != "204" && "$claim_status" != "503" ]]; then
  # 204 is possible for queue-empty when token valid; without token should be 401
  # 503 only in exceptional maintenance/infra state
  warn "jobs/claim without token status=$claim_status"
fi

# admin endpoint should require auth
admin_endpoint="${BASE_URL%/}/api/admin/openclaw/dds-agent"
admin_status=$(curl -sS -o /tmp/dds_admin.body -w '%{http_code}' "$admin_endpoint" || echo 000)
if [[ "$admin_status" == "401" || "$admin_status" == "403" ]]; then
  log "admin DDS status endpoint auth is protected: $admin_status"
else
  warn "admin DDS status endpoint expected auth, got $admin_status"
fi

# optional control token loop check
if [[ -n "$TOKEN" ]]; then
  heartbeat_endpoint="${BASE_URL%/}/api/openclaw/connect/heartbeat"
  heartbeat_status=$(curl -sS -o /tmp/dds_heartbeat.body -w '%{http_code}' -X POST "$heartbeat_endpoint" \
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
commands_status=$(curl -sS -o /tmp/dds_commands.body -w '%{http_code}' -X POST "$commands_endpoint" -H 'Content-Type: application/json' -d '{"command":"noop"}' || echo 000)
if [[ "$commands_status" == "503" ]]; then
  log "openclaw commands is intentionally disabled (expected in current env)"
elif [[ "$commands_status" != "401" ]]; then
  warn "openclaw commands status=$commands_status (expected 503 or 401)"
fi

cat > /tmp/openclaw-preflight-summary.json <<JSON
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "baseUrl": "$BASE_URL",
  "healthOk": $(jq -r '[.status == "ok" or .status == "degraded"] | any' /tmp/dds_health.json 2>/dev/null || echo false),
  "connectorConfigured": $(jq -r '.connector.configured // false' /tmp/dds_health.json 2>/dev/null || echo false),
  "webhookConfigured": $(jq -r '.webhook.configured // false' /tmp/dds_health.json 2>/dev/null || echo false),
  "ddsConnected": $(jq -r '.ddsAgent.connected // false' /tmp/dds_health.json 2>/dev/null || echo false),
  "awaitingUser": $(jq -r '.ddsAgent.awaitingUser // 0' /tmp/dds_health.json 2>/dev/null || echo 0),
  "lastSeenAt": "$(jq -r '.ddsAgent.lastSeenAt // ""' /tmp/dds_health.json 2>/dev/null || echo "")"
}
JSON

if [[ "$status_ok" == true ]]; then
  log "preflight succeeded"
  cat /tmp/openclaw-preflight-summary.json
  exit 0
else
  warn "preflight found issues"
  cat /tmp/openclaw-preflight-summary.json
  exit 1
fi
