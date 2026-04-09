#!/usr/bin/env bash
set -euo pipefail
PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${OPENCLAW_ROOT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
LOG_SCHEMA_VERSION="dss-runtime-v2"
DSS_LOG_SOURCE="dss-health-monitor"
DSS_LOG_COMPONENT="openclaw-connection-operation"

# --- Telegram notification settings ---
TG_BOT_TOKEN="${OPENCLAW_TG_BOT_TOKEN:-}"
TG_DM_CHAT_ID="${OPENCLAW_TG_DM_CHAT_ID:-}"
TG_GROUP_CHAT_ID="${OPENCLAW_TG_GROUP_CHAT_ID:-}"
# --- Codex auto-fix settings ---
CODEX_AUTOFIX_ENABLED="${OPENCLAW_CODEX_AUTOFIX_ENABLED:-false}"
CODEX_DEDUP_DIR="${HOME}/.openclaw/runtime/dss-codex/dedup"
CODEX_ATTEMPTS_DIR="${HOME}/.openclaw/runtime/dss-codex/attempts"
CODEX_LOG_DIR="${HOME}/.openclaw/runtime/dss-codex/logs"
CODEX_RESULTS_LOG="${HOME}/.openclaw/runtime/dss-codex/results.ndjson"
CODEX_DEDUP_WINDOW_SEC="${OPENCLAW_CODEX_DEDUP_WINDOW_SEC:-7200}"
CODEX_MAX_ATTEMPTS="${OPENCLAW_CODEX_MAX_ATTEMPTS:-3}"
# --- Error buffer for hourly digest ---
ERROR_BUFFER_DIR="${HOME}/.openclaw/runtime/dss-alerts"
ERROR_BUFFER_FILE="${ERROR_BUFFER_DIR}/error-buffer.ndjson"
RUNNER_DIR="${OPENCLAW_RUNNER_DIR:-${HOME}/.openclaw/agents/dds-agent-runner}"
STATE_PATH="${OPENCLAW_RUNNER_STATE_PATH:-${RUNNER_DIR}/runtime/state.json}"
BASE_URL="${1:-${OPENCLAW_PRECHECK_BASE_URL:-https://dead-stock-solution.vercel.app}}"
LOG_ROOT="${OPENCLAW_OPS_LOG_DIR:-${HOME}/.openclaw/runtime/openclaw-ops}"
RUN_ID="$(date '+%Y%m%d-%H%M%S')"
PREFLIGHT_LOG="${LOG_ROOT}/openclaw-preflight-${RUN_ID}.log"
RUNNER_LOG="${LOG_ROOT}/openclaw-runner-${RUN_ID}.log"
SUMMARY_PATH="${LOG_ROOT}/openclaw-connection-run-${RUN_ID}.json"
ALERT_LOG="${OPENCLAW_ALERT_LOG:-${LOG_ROOT}/openclaw-connection-alerts.ndjson}"
HEALTH_JSON="/tmp/openclaw-ops-health-${RUN_ID}.json"
REASON_JSON="/tmp/openclaw-ops-reasons-${RUN_ID}.jsonl"
HEALTH_HTTP_CODE=0

# monitoring thresholds
AWAITING_USER_WARNING_THRESHOLD="${OPENCLAW_AWAITING_USER_WARNING_THRESHOLD:-0}"
AWAITING_USER_CRITICAL_THRESHOLD="${OPENCLAW_AWAITING_USER_CRITICAL_THRESHOLD:-}"

RUNNER_SCRIPT="${RUNNER_DIR}/scripts/run-dds-agent-runner.mjs"

source "${SCRIPT_DIR}/lib/dss-runtime-logging.sh"
source "${SCRIPT_DIR}/lib/dss-telegram.sh"
source "${SCRIPT_DIR}/lib/dss-codex-dispatch.sh"

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

refresh_reasons() {
  local current
  current=$(jq -s '.' "${REASON_JSON}" 2>/dev/null)
  if [[ -z "${current}" ]]; then
    current='[]'
  fi
  printf '%s' "${current}"
}

load_runner_state_json() {
  local runner_state='{}'
  if [[ -f "${STATE_PATH}" ]]; then
    if ! runner_state="$(jq -c '.' "${STATE_PATH}" 2>/dev/null)"; then
      runner_state='{}'
      append_reason warning "runner_state_invalid" "runner state JSON の解析に失敗した"
    fi
  fi
  printf '%s' "${runner_state}"
}

write_status_json() {
  local include_details="${1:-false}"
  local runner_state_json="${2:-null}"

  jq -n \
    --arg schema "${LOG_SCHEMA_VERSION}" \
    --arg source "dss-health-monitor" \
    --arg runId "${RUN_ID}" \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg baseUrl "${BASE_URL}" \
    --argjson preflightStatus "${preflight_status}" \
    --argjson runnerStatus "${run_status}" \
    --argjson healthHttpCode "${HEALTH_HTTP_CODE}" \
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
    --arg healthSnapshot "${HEALTH_JSON}" \
    --arg reasonLog "${REASON_JSON}" \
    --arg rootDir "${ROOT_DIR}" \
    --arg runnerDir "${RUNNER_DIR}" \
    --arg statePath "${STATE_PATH}" \
    --arg scriptName "${SCRIPT_NAME}" \
    --arg hostName "${HOSTNAME:-unknown}" \
    --arg preflightTail "$(tail -n 1 "${PREFLIGHT_LOG}" 2>/dev/null || true)" \
    --arg runnerTail "$(tail -n 1 "${RUNNER_LOG}" 2>/dev/null || true)" \
    --argjson tgDmEnabled "$([[ -n "${TG_BOT_TOKEN}" && -n "${TG_DM_CHAT_ID}" ]] && printf 'true' || printf 'false')" \
    --argjson tgGroupEnabled "$([[ -n "${TG_BOT_TOKEN}" && -n "${TG_GROUP_CHAT_ID}" ]] && printf 'true' || printf 'false')" \
    --argjson codexAutofixEnabled "$([[ "${CODEX_AUTOFIX_ENABLED}" == "true" ]] && printf 'true' || printf 'false')" \
    --argjson awaitingWarningThreshold "${AWAITING_USER_WARNING_THRESHOLD}" \
    --arg awaitingCriticalThreshold "${AWAITING_USER_CRITICAL_THRESHOLD}" \
    --argjson reasons "${reasons}" \
    --argjson runnerState "${runner_state_json}" \
    --argjson includeDetails "${include_details}" \
    '{
      schema: $schema,
      source: $source,
      runId: $runId,
      timestamp: $ts,
      baseUrl: $baseUrl,
      preflightStatus: $preflightStatus,
      runnerStatus: $runnerStatus,
      healthHttpCode: $healthHttpCode,
      status: $statusLevel,
      reason: $reason,
      runtime: {
        script: $scriptName,
        rootDir: $rootDir,
        runnerDir: $runnerDir,
        statePath: $statePath,
        hostName: $hostName
      },
      notifications: {
        telegramDmEnabled: $tgDmEnabled,
        telegramGroupEnabled: $tgGroupEnabled,
        codexAutofixEnabled: $codexAutofixEnabled
      },
      thresholds: {
        awaitingUserWarning: $awaitingWarningThreshold,
        awaitingUserCritical: (if $awaitingCriticalThreshold == "" then null else ($awaitingCriticalThreshold | tonumber) end)
      },
      health: {
        connectorConfigured: ($connectorConfigured == true),
        webhookConfigured: ($webhookConfigured == true),
        ddsConnected: ($ddsConnected == true),
        awaitingUser: $awaitingUser,
        lastSeenAt: $lastSeenAt
      },
      diagnostics: {
        preflightLogTail: $preflightTail,
        runnerLogTail: $runnerTail
      }
    } + (
      if $includeDetails then
        {
          alerts: {
            enabled: true,
            log: $alertLog,
            reasons: $reasons
          },
          artifacts: {
            preflightLog: $preflightLog,
            runnerLog: $runnerLog,
            summaryPath: $summaryPath,
            alertLog: $alertLog,
            healthSnapshot: $healthSnapshot,
            reasonsLog: $reasonLog,
            runnerState: $runnerState
          }
        }
      else
        {
          reasons: $reasons
        }
      end
    )'
}

build_monitor_context_json() {
  jq -n \
    --arg runId "${RUN_ID}" \
    --arg baseUrl "${BASE_URL}" \
    --arg status "${status_level}" \
    --arg reason "${status_message}" \
    --argjson preflightStatus "${preflight_status}" \
    --argjson runnerStatus "${run_status}" \
    --argjson healthHttpCode "${HEALTH_HTTP_CODE}" \
    --argjson awaitingUser "${awaiting_user_num:-0}" \
    --arg lastSeenAt "${last_seen:-}" \
    --argjson connectorConfigured "$([[ "${connector:-false}" == "true" ]] && printf 'true' || printf 'false')" \
    --argjson webhookConfigured "$([[ "${webhook:-false}" == "true" ]] && printf 'true' || printf 'false')" \
    --argjson ddsConnected "$([[ "${connected:-false}" == "true" ]] && printf 'true' || printf 'false')" \
    '{
      runId: $runId,
      baseUrl: $baseUrl,
      status: $status,
      reason: $reason,
      preflightStatus: $preflightStatus,
      runnerStatus: $runnerStatus,
      healthHttpCode: $healthHttpCode,
      connectorConfigured: $connectorConfigured,
      webhookConfigured: $webhookConfigured,
      ddsConnected: $ddsConnected,
      awaitingUser: $awaitingUser,
      lastSeenAt: $lastSeenAt
    }'
}

build_monitor_artifacts_json() {
  jq -n \
    --arg preflightLog "${PREFLIGHT_LOG}" \
    --arg runnerLog "${RUNNER_LOG}" \
    --arg summaryPath "${SUMMARY_PATH}" \
    --arg alertLog "${ALERT_LOG}" \
    --arg healthSnapshot "${HEALTH_JSON}" \
    --arg reasonsLog "${REASON_JSON}" \
    '{
      preflightLog: $preflightLog,
      runnerLog: $runnerLog,
      summaryPath: $summaryPath,
      alertLog: $alertLog,
      healthSnapshot: $healthSnapshot,
      reasonsLog: $reasonsLog
    }'
}

append_error_buffer_event() {
  local severity="$1"
  local category="$2"
  local code="$3"
  local message="$4"
  local context_json="${5:-}"
  local artifacts_json="${6:-}"

  mkdir -p "${ERROR_BUFFER_DIR}"
  if [[ -z "${context_json}" ]]; then
    context_json="$(build_monitor_context_json)"
  fi
  if [[ -z "${artifacts_json}" ]]; then
    artifacts_json="$(build_monitor_artifacts_json)"
  fi

  dss_append_error_buffer_event "${severity}" "${category}" "${code}" "${message}" "${context_json}" "${artifacts_json}"
}

append_codex_result() {
  local status="$1"
  local error_type="$2"
  local summary="$3"
  local log_path="${4:-}"
  local attempt="${5:-0}"
  local error_hash="${6:-}"

  dss_append_codex_result "${status}" "${error_type}" "${summary}" "${log_path}" "${attempt}" "${error_hash}" "$(build_monitor_context_json)" "$(build_monitor_artifacts_json)"
}

# --- Telegram notification helpers ---
tg_send() {
  if [[ -z "${TG_BOT_TOKEN}" ]]; then
    log "TG_BOT_TOKEN not set, skipping notification"
    return 0
  fi
  dss_tg_send "${TG_BOT_TOKEN}" "$1" "$2"
}

tg_notify_critical() {
  dss_tg_notify_critical "${TG_BOT_TOKEN}" "${TG_DM_CHAT_ID}" "$1"
}

tg_notify_error_buffer() {
  local message="$1"
  local code="${2:-warning}"
  append_error_buffer_event "warning" "health" "${code}" "${message}"
}

# --- Codex auto-fix dispatch ---
codex_dispatch() {
  local error_desc="$1"
  local error_type="${2:-unknown}"

  if [[ "${CODEX_AUTOFIX_ENABLED}" != "true" ]]; then
    log "codex autofix disabled, skipping"
    append_codex_result "disabled" "${error_type}" "codex autofix disabled"
    return 0
  fi

  mkdir -p "${CODEX_DEDUP_DIR}" "${CODEX_ATTEMPTS_DIR}" "${CODEX_LOG_DIR}"

  # Dedup check
  local error_hash
  error_hash="$(dss_compute_error_hash "${error_desc}")"
  local dedup_file="${CODEX_DEDUP_DIR}/${error_hash}"
  if [[ -f "${dedup_file}" ]]; then
    local age=$(( $(date +%s) - $(stat -f %m "${dedup_file}" 2>/dev/null || stat -c %Y "${dedup_file}" 2>/dev/null || echo 0) ))
    if (( age < CODEX_DEDUP_WINDOW_SEC )); then
      log "codex dedup: skipped (${age}s < ${CODEX_DEDUP_WINDOW_SEC}s)"
      append_codex_result "dedup_skipped" "${error_type}" "duplicate error skipped within dedup window" "" 0 "${error_hash}"
      return 0
    fi
  fi
  touch "${dedup_file}"

  # Attempt counter
  local attempt_file="${CODEX_ATTEMPTS_DIR}/${error_hash}"
  local attempts
  attempts=$(cat "${attempt_file}" 2>/dev/null || echo 0)
  if (( attempts >= CODEX_MAX_ATTEMPTS )); then
    tg_notify_critical "Auto-fix ${CODEX_MAX_ATTEMPTS}回失敗 → 人間対応必要
Type: ${error_type}
${error_desc}"
    append_codex_result "escalated" "${error_type}" "max auto-fix attempts reached; human intervention required" "" "${attempts}" "${error_hash}"
    return 1
  fi
  echo $(( attempts + 1 )) > "${attempt_file}"

  log "codex dispatch: attempt $(( attempts + 1 ))/${CODEX_MAX_ATTEMPTS} for ${error_type}"

  local codex_log="${CODEX_LOG_DIR}/$(date +%Y%m%d-%H%M%S)-${error_type}.log"
  local dispatch_prompt
  dispatch_prompt="# DSS Auto-Fix Task

## Project
DeadStockSolution — 薬局向けデッドストック管理SaaS
Repo: /Users/yusuke/DeadStockSolution

## Error
Type: ${error_type}
${error_desc}

## Instructions
1. Read CLAUDE.md for project conventions
2. Diagnose the root cause
3. Implement the minimal fix
4. Run: npm run lint && npm run typecheck && npm run test
5. If tests pass:
   - git checkout -b fix/auto-${error_type}-\$(date +%Y%m%d-%H%M)
   - git add (specific files only)
   - git commit -m \"fix: auto-repair ${error_type}\"
   - gh pr create --base main --title \"fix: auto-repair ${error_type}\" --body \"Automated fix by GPT-5.4 via OpenClaw dss-manager\"
6. If tests fail: report the failure, do NOT create PR

## Constraints
- Coverage: Lines 95%, Functions 95%, Branches 86%
- DO NOT modify: server/src/db/schema.ts, server/src/middleware/, vercel.json
- DO NOT push directly to main"

  if dss_codex_exec_prompt "${ROOT_DIR}" "${dispatch_prompt}" "${codex_log}"; then
    log "codex dispatch succeeded"
    rm -f "${attempt_file}"
    append_codex_result "success" "${error_type}" "codex auto-fix dispatch completed successfully" "${codex_log}" "$(( attempts + 1 ))" "${error_hash}"
  else
    local exit_code=$?
    log "codex dispatch failed (exit ${exit_code})"
    append_codex_result "failed" "${error_type}" "codex auto-fix dispatch failed" "${codex_log}" "$(( attempts + 1 ))" "${error_hash}"
  fi
}

handle_status_notifications() {
  if [[ "${status_level}" == "degraded" ]]; then
    tg_notify_critical "ヘルスチェック degraded
reason: ${status_message}
URL: ${BASE_URL}"
    codex_dispatch "Health check degraded: ${status_message}. connector=${connector} webhook=${webhook} connected=${connected}" "health-degraded"
    return 1
  fi

  if [[ "${status_level}" == "warning" ]]; then
    tg_notify_error_buffer "ヘルスチェック warning: ${status_message} (awaiting=${awaiting_user_num})" "${status_message}"
  fi

  return 0
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
  if [[ ! -r "${RUNNER_SCRIPT}" ]]; then
    log "runner script missing: ${RUNNER_SCRIPT}"
    return 127
  fi

  log "step2 runner tick start (${RUNNER_DIR})"
  (cd "${RUNNER_DIR}" && node scripts/run-dds-agent-runner.mjs) >"${RUNNER_LOG}" 2>&1
}

run_health_check() {
  local http_code
  http_code=$(curl -sS -o "${HEALTH_JSON}" -w '%{http_code}' "${BASE_URL%/}/api/health/openclaw" 2>/dev/null || echo 000)
  HEALTH_HTTP_CODE="${http_code}"
  if [[ "${http_code}" != "200" ]]; then
    echo '{"connector":{"configured":false},"webhook":{"configured":false},"ddsAgent":{"connected":false,"awaitingUser":0,"lastSeenAt":""}}' >"${HEALTH_JSON}"
  fi
}

load_health_snapshot() {
  connected=$(jq -r '.ddsAgent.connected // false' "${HEALTH_JSON}")
  connector=$(jq -r '.connector.configured // false' "${HEALTH_JSON}")
  webhook=$(jq -r '.webhook.configured // false' "${HEALTH_JSON}")
  awaiting_user=$(jq -r '.ddsAgent.awaitingUser // 0' "${HEALTH_JSON}")
  awaiting_user_num="${awaiting_user}"
  if ! [[ "${awaiting_user_num}" =~ ^[0-9]+$ ]]; then
    awaiting_user_num=0
  fi
  last_seen=$(jq -r '.ddsAgent.lastSeenAt // ""' "${HEALTH_JSON}")
}

evaluate_execution_status() {
  if [[ "${preflight_status}" != "0" || "${run_status}" != "0" ]]; then
    status_level="degraded"
    status_message="execution_failed"
    append_reason error "execution_failed" "preflightまたはrunnerが失敗"
  fi
}

evaluate_connector_status() {
  if [[ "${connector}" != "true" ]]; then
    status_level="degraded"
    if [[ "${status_message}" == "ok" ]]; then
      status_message="connector_not_configured"
    fi
    append_reason error "connector_not_configured" "connector.configured が false"
  fi
}

evaluate_webhook_status() {
  if [[ "${webhook}" != "true" ]]; then
    status_level="degraded"
    if [[ "${status_message}" == "ok" ]]; then
      status_message="webhook_not_configured"
    fi
    append_reason error "webhook_not_configured" "webhook.configured が false"
  fi
}

evaluate_dds_connection_status() {
  if [[ "${connected}" != "true" ]]; then
    if [[ "${status_level}" == "ok" ]]; then
      status_level="warning"
      status_message="dds_not_connected"
    fi
    append_reason warning "dds_not_connected" "ddsAgent.connected が false"
  fi
}

evaluate_awaiting_user_status() {
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
}

evaluate_status() {
  status_level="ok"
  status_message="ok"
  evaluate_execution_status
  evaluate_connector_status
  evaluate_webhook_status
  evaluate_dds_connection_status
  evaluate_awaiting_user_status
}

emit_status_artifacts() {
  runner_state_json="$(load_runner_state_json)"
  reasons="$(refresh_reasons)"

  if [[ "${status_level}" == "warning" || "${status_level}" == "degraded" ]]; then
    write_status_json false >>"${ALERT_LOG}"
    echo >>"${ALERT_LOG}"
  fi

  write_status_json true "${runner_state_json}" >"${SUMMARY_PATH}"
}

print_status_report() {
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

  tail -n 1 "${RUNNER_LOG}" 2>/dev/null || true
  tail -n 1 "${PREFLIGHT_LOG}" 2>/dev/null || true
}

preflight_status=0
run_status=0

run_preflight || preflight_status=$?
run_runner_tick || run_status=$?

run_health_check
load_health_snapshot
evaluate_status
emit_status_artifacts
print_status_report

if ! handle_status_notifications; then
  exit 1
fi
