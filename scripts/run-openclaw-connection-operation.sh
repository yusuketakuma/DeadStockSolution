#!/usr/bin/env bash
set -euo pipefail
PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

ROOT_DIR="/Users/yusuke/workspace/DeadStockSolution"
RUNNER_DIR="/Users/yusuke/.openclaw/agents/dds-agent-runner"
STATE_PATH="${RUNNER_DIR}/runtime/state.json"
BASE_URL="${1:-${OPENCLAW_PRECHECK_BASE_URL:-https://dead-stock-solution.vercel.app}}"
LOG_ROOT="${OPENCLAW_OPS_LOG_DIR:-/Users/yusuke/.openclaw/runtime/openclaw-ops}"
RUN_ID="$(date '+%Y%m%d-%H%M%S')"
PREFLIGHT_LOG="${LOG_ROOT}/openclaw-preflight-${RUN_ID}.log"
RUNNER_LOG="${LOG_ROOT}/openclaw-runner-${RUN_ID}.log"
SUMMARY_PATH="${LOG_ROOT}/openclaw-connection-run-${RUN_ID}.json"
ALERT_LOG="${OPENCLAW_ALERT_LOG:-${LOG_ROOT}/openclaw-connection-alerts.ndjson}"
HEALTH_JSON="/tmp/openclaw-ops-health-${RUN_ID}.json"
REASON_JSON="/tmp/openclaw-ops-reasons-${RUN_ID}.jsonl"

# monitoring thresholds
AWAITING_USER_WARNING_THRESHOLD="${OPENCLAW_AWAITING_USER_WARNING_THRESHOLD:-0}"
AWAITING_USER_CRITICAL_THRESHOLD="${OPENCLAW_AWAITING_USER_CRITICAL_THRESHOLD:-}"

log() {
  printf '[openclaw-ops] %s\n' "$*"
}

if ! command -v jq >/dev/null 2>&1; then
  echo "[openclaw-ops] jq required. install jq first." >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[openclaw-ops] node required." >&2
  exit 2
fi

mkdir -p "${LOG_ROOT}"
: >"${REASON_JSON}"

append_reason() {
  local level="$1"
  local code="$2"
  local message="$3"
  local value_json="${4:-}"

  if [[ -n "${value_json}" ]]; then
    jq -cn --arg level "$level" --arg code "$code" --arg message "$message" --argjson value "$value_json" \
      '{level:$level, code:$code, message:$message, value:$value}' >>"${REASON_JSON}"
  else
    jq -cn --arg level "$level" --arg code "$code" --arg message "$message" \
      '{level:$level, code:$code, message:$message}' >>"${REASON_JSON}"
  fi
  echo >>"${REASON_JSON}"
}

run_preflight() {
  local control_token=""
  if [[ -f "${STATE_PATH}" ]]; then
    control_token="$(jq -r '.controlToken // empty' "${STATE_PATH}" 2>/dev/null)"
  fi

  if [[ -n "${control_token}" ]]; then
    export OPENCLAW_DDS_CONTROL_TOKEN="${control_token}"
  else
    unset OPENCLAW_DDS_CONTROL_TOKEN || true
  fi

  log "step1 preflight start (${BASE_URL})"
  bash "${ROOT_DIR}/scripts/openclaw-connection-preflight.sh" "${BASE_URL}" >"${PREFLIGHT_LOG}" 2>&1
}

run_runner_tick() {
  if [[ ! -x "${RUNNER_DIR}/scripts/run-dds-agent-runner.mjs" ]]; then
    log "runner script missing: ${RUNNER_DIR}/scripts/run-dds-agent-runner.mjs"
    return 127
  fi

  log "step2 runner tick start (${RUNNER_DIR})"
  (cd "${RUNNER_DIR}" && node scripts/run-dds-agent-runner.mjs) >"${RUNNER_LOG}" 2>&1
}

run_health_check() {
  local http_code
  http_code=$(curl -sS -o "${HEALTH_JSON}" -w '%{http_code}' "${BASE_URL%/}/api/health/openclaw" || echo 000)
  if [[ "${http_code}" != "200" ]]; then
    echo '{"connector":{"configured":false},"webhook":{"configured":false},"ddsAgent":{"connected":false,"awaitingUser":0,"lastSeenAt":""}}' >"${HEALTH_JSON}"
  fi
}

preflight_status=0
run_status=0

if ! run_preflight; then
  preflight_status=$?
fi

if ! run_runner_tick; then
  run_status=$?
fi

run_health_check

connected=$(jq -r '.ddsAgent.connected // false' "${HEALTH_JSON}")
connector=$(jq -r '.connector.configured // false' "${HEALTH_JSON}")
webhook=$(jq -r '.webhook.configured // false' "${HEALTH_JSON}")
awaiting_user=$(jq -r '.ddsAgent.awaitingUser // 0' "${HEALTH_JSON}")
awaiting_user_num="${awaiting_user}"
if ! [[ "${awaiting_user_num}" =~ ^[0-9]+$ ]]; then
  awaiting_user_num=0
fi
last_seen=$(jq -r '.ddsAgent.lastSeenAt // ""' "${HEALTH_JSON}")

status_level="ok"
status_message="ok"

if [[ "${preflight_status}" != "0" || "${run_status}" != "0" ]]; then
  status_level="degraded"
  status_message="execution_failed"
  append_reason error "execution_failed" "preflightまたはrunnerが失敗"
fi

if [[ "${connector}" != "true" ]]; then
  status_level="degraded"
  if [[ "${status_message}" == "ok" ]]; then
    status_message="connector_not_configured"
  fi
  append_reason error "connector_not_configured" "connector.configured が false"
fi

if [[ "${webhook}" != "true" ]]; then
  status_level="degraded"
  if [[ "${status_message}" == "ok" ]]; then
    status_message="webhook_not_configured"
  fi
  append_reason error "webhook_not_configured" "webhook.configured が false"
fi

if [[ "${connected}" != "true" ]]; then
  if [[ "${status_level}" == "ok" ]]; then
    status_level="warning"
    status_message="dds_not_connected"
  fi
  append_reason warning "dds_not_connected" "ddsAgent.connected が false"
fi

if (( awaiting_user_num > AWAITING_USER_WARNING_THRESHOLD )); then
  if [[ "${status_level}" == "ok" ]]; then
    status_level="warning"
    status_message="awaiting_user_warning"
  fi
  append_reason warning "awaiting_user_warning" "awaitingUser が閾値を上回った" "${awaiting_user_num}"
fi

if [[ -n "${AWAITING_USER_CRITICAL_THRESHOLD}" ]] && (( awaiting_user_num > AWAITING_USER_CRITICAL_THRESHOLD )); then
  status_level="degraded"
  if [[ "${status_message}" == "ok" ]]; then
    status_message="awaiting_user_critical"
  fi
  append_reason error "awaiting_user_critical" "awaitingUser が重大閾値を上回った" "${awaiting_user_num}"
fi

reasons=$(jq -s '.' "${REASON_JSON}" 2>/dev/null)
if [[ -z "${reasons}" ]]; then
  reasons='[]'
fi

if [[ "${status_level}" == "warning" || "${status_level}" == "degraded" ]]; then
  jq -n \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg baseUrl "${BASE_URL}" \
    --argjson preflightStatus "${preflight_status}" \
    --argjson runnerStatus "${run_status}" \
    --arg statusLevel "${status_level}" \
    --arg reason "${status_message}" \
    --argjson connectorConfigured "${connector}" \
    --argjson webhookConfigured "${webhook}" \
    --argjson ddsConnected "${connected}" \
    --argjson awaitingUser "${awaiting_user_num}" \
    --arg lastSeenAt "${last_seen}" \
    --arg preflightLog "${PREFLIGHT_LOG}" \
    --arg runnerLog "${RUNNER_LOG}" \
    --argjson reasons "${reasons}" \
    '{
      timestamp: $ts,
      baseUrl: $baseUrl,
      preflightStatus: $preflightStatus,
      runnerStatus: $runnerStatus,
      status: $statusLevel,
      reason: $reason,
      health: {
        connectorConfigured: ($connectorConfigured == true),
        webhookConfigured: ($webhookConfigured == true),
        ddsConnected: ($ddsConnected == true),
        awaitingUser: $awaitingUser,
        lastSeenAt: $lastSeenAt
      },
      reasons: $reasons
    }' >>"${ALERT_LOG}"
  echo >>"${ALERT_LOG}"
fi

jq -n \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg baseUrl "${BASE_URL}" \
  --argjson preflightStatus "${preflight_status}" \
  --argjson runnerStatus "${run_status}" \
  --arg statusLevel "${status_level}" \
  --arg reason "${status_message}" \
  --argjson connectorConfigured "${connector}" \
  --argjson webhookConfigured "${webhook}" \
  --argjson ddsConnected "${connected}" \
  --argjson awaitingUser "${awaiting_user_num}" \
  --arg lastSeenAt "${last_seen}" \
  --arg preflightLog "${PREFLIGHT_LOG}" \
  --arg runnerLog "${RUNNER_LOG}" \
  --arg summaryPath "${SUMMARY_PATH}" \
  --arg alertLog "${ALERT_LOG}" \
  --argjson reasons "${reasons}" \
  --slurpfile state "${STATE_PATH}" \
  '{
    timestamp: $ts,
    baseUrl: $baseUrl,
    preflightStatus: $preflightStatus,
    runnerStatus: $runnerStatus,
    status: $statusLevel,
    reason: $reason,
    health: {
      connectorConfigured: ($connectorConfigured == true),
      webhookConfigured: ($webhookConfigured == true),
      ddsConnected: ($ddsConnected == true),
      awaitingUser: $awaitingUser,
      lastSeenAt: $lastSeenAt
    },
    alerts: {
      enabled: true,
      log: $alertLog,
      reasons: $reasons
    },
    artifacts: {
      preflightLog: $preflightLog,
      runnerLog: $runnerLog,
      summaryPath: $summaryPath,
      runnerState: (if $state | length > 0 then $state[0] else {} end)
    }
  }' >"${SUMMARY_PATH}"

cat "${SUMMARY_PATH}"

echo ""
echo "=== ログ ==="
echo "preflight log: ${PREFLIGHT_LOG}"
echo "runner log  : ${RUNNER_LOG}"
echo "summary    : ${SUMMARY_PATH}"
echo "alerts log : ${ALERT_LOG}"

echo ""
echo "=== 結果 ==="
echo "preflight_status=${preflight_status}"
echo "runner_status=${run_status}"
echo "status=${status_level}"
echo "reason=${status_message}"

tail -n 1 "${RUNNER_LOG}" || true

tail -n 1 "${PREFLIGHT_LOG}" || true

if [[ "${status_level}" == "degraded" ]]; then
  exit 1
fi
