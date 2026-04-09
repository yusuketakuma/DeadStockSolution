#!/usr/bin/env bash
set -euo pipefail
PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

# DSS CI Monitor — checks GitHub Actions, dispatches codex fixes, sends notifications
# Usage:
#   dss-ci-monitor.sh                  # check CI + buffer errors
#   dss-ci-monitor.sh --flush-errors   # send hourly error digest
#   dss-ci-monitor.sh --daily-report   # send daily summary

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${OPENCLAW_ROOT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
REPO="yusuketakuma/DeadStockSolution"
SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
LOG_SCHEMA_VERSION="dss-runtime-v2"
DSS_LOG_SOURCE="dss-ci-monitor"
DSS_LOG_COMPONENT="github-actions"

# Telegram
TG_BOT_TOKEN="${OPENCLAW_TG_BOT_TOKEN:-}"
TG_DM_CHAT_ID="${OPENCLAW_TG_DM_CHAT_ID:-}"
TG_GROUP_CHAT_ID="${OPENCLAW_TG_GROUP_CHAT_ID:-}"

# Codex
CODEX_AUTOFIX_ENABLED="${OPENCLAW_CODEX_AUTOFIX_ENABLED:-false}"
CODEX_DEDUP_DIR="${HOME}/.openclaw/runtime/dss-codex/dedup"
CODEX_ATTEMPTS_DIR="${HOME}/.openclaw/runtime/dss-codex/attempts"
CODEX_LOG_DIR="${HOME}/.openclaw/runtime/dss-codex/logs"
CODEX_RESULTS_LOG="${HOME}/.openclaw/runtime/dss-codex/results.ndjson"
CODEX_DEDUP_WINDOW_SEC="${OPENCLAW_CODEX_DEDUP_WINDOW_SEC:-7200}"
CODEX_MAX_ATTEMPTS="${OPENCLAW_CODEX_MAX_ATTEMPTS:-3}"

# Buffers
ERROR_BUFFER_DIR="${HOME}/.openclaw/runtime/dss-alerts"
ERROR_BUFFER_FILE="${ERROR_BUFFER_DIR}/error-buffer.ndjson"
CI_STATE_DIR="${HOME}/.openclaw/runtime/dss-ci"
CI_LAST_CHECK="${CI_STATE_DIR}/last-check.json"
DAILY_METRICS_DIR="${HOME}/.openclaw/runtime/dss-daily"

source "${SCRIPT_DIR}/lib/dss-runtime-logging.sh"
source "${SCRIPT_DIR}/lib/dss-telegram.sh"
source "${SCRIPT_DIR}/lib/dss-codex-dispatch.sh"

log() { printf '[dss-ci] %s\n' "$*"; }

mkdir -p "${ERROR_BUFFER_DIR}" "${CI_STATE_DIR}" "${DAILY_METRICS_DIR}" \
  "${CODEX_DEDUP_DIR}" "${CODEX_ATTEMPTS_DIR}" "${CODEX_LOG_DIR}"

build_ci_context_json() {
  local run_id="${1:-}"
  local workflow_name="${2:-}"
  local branch="${3:-}"
  local url="${4:-}"

  jq -n \
    --arg repo "${REPO}" \
    --arg scriptName "${SCRIPT_NAME}" \
    --arg rootDir "${ROOT_DIR}" \
    --arg runId "${run_id}" \
    --arg workflowName "${workflow_name}" \
    --arg branch "${branch}" \
    --arg url "${url}" \
    '{
      repo: $repo,
      script: $scriptName,
      rootDir: $rootDir,
      workflowRunId: (if $runId == "" then null else $runId end),
      workflowName: (if $workflowName == "" then null else $workflowName end),
      branch: (if $branch == "" then null else $branch end),
      url: (if $url == "" then null else $url end)
    }'
}

append_error_buffer_event() {
  local severity="$1"
  local category="$2"
  local code="$3"
  local message="$4"
  local context_json="${5:-}"

  if [[ -z "${context_json}" ]]; then
    context_json="$(build_ci_context_json)"
  fi

  dss_append_error_buffer_event "${severity}" "${category}" "${code}" "${message}" "${context_json}" "$(jq -n --arg errorBuffer "${ERROR_BUFFER_FILE}" '{errorBuffer:$errorBuffer}')"
}

append_codex_result() {
  local status="$1"
  local error_type="$2"
  local summary="$3"
  local log_path="${4:-}"
  local attempt="${5:-0}"
  local error_hash="${6:-}"
  local context_json="${7:-}"

  if [[ -z "${context_json}" ]]; then
    context_json="$(build_ci_context_json)"
  fi

  dss_append_codex_result "${status}" "${error_type}" "${summary}" "${log_path}" "${attempt}" "${error_hash}" "${context_json}" "$(jq -n --arg logDir "${CODEX_LOG_DIR}" --arg resultsLog "${CODEX_RESULTS_LOG}" '{logDir:$logDir,resultsLog:$resultsLog}')"
}

format_error_preview() {
  dss_format_error_preview
}

summarize_codex_results_today() {
  dss_summarize_codex_results_today
}

# --- Telegram helpers (same as run-openclaw-connection-operation.sh) ---
tg_send() {
  [[ -z "${TG_BOT_TOKEN}" ]] && return 0
  dss_tg_send "${TG_BOT_TOKEN}" "$1" "$2"
}

tg_notify_critical() {
  dss_tg_notify_critical "${TG_BOT_TOKEN}" "${TG_DM_CHAT_ID}" "$1"
}

# --- Codex dispatch (reuse from connection-operation, simplified) ---
codex_dispatch() {
  local error_desc="$1" error_type="${2:-ci-failure}" context_json="${3:-}"
  [[ "${CODEX_AUTOFIX_ENABLED}" != "true" ]] && { log "codex disabled"; append_codex_result "disabled" "${error_type}" "codex autofix disabled" "" 0 "" "${context_json}"; return 0; }

  local error_hash
  error_hash="$(dss_compute_error_hash "${error_desc}")"
  local dedup_file="${CODEX_DEDUP_DIR}/${error_hash}"
  if [[ -f "${dedup_file}" ]]; then
    local age=$(( $(date +%s) - $(stat -f %m "${dedup_file}" 2>/dev/null || stat -c %Y "${dedup_file}" 2>/dev/null || echo 0) ))
    (( age < CODEX_DEDUP_WINDOW_SEC )) && { log "codex dedup skip"; append_codex_result "dedup_skipped" "${error_type}" "duplicate CI failure skipped within dedup window" "" 0 "${error_hash}" "${context_json}"; return 0; }
  fi
  touch "${dedup_file}"

  local attempt_file="${CODEX_ATTEMPTS_DIR}/${error_hash}"
  local attempts; attempts=$(cat "${attempt_file}" 2>/dev/null || echo 0)
  if (( attempts >= CODEX_MAX_ATTEMPTS )); then
    tg_notify_critical "Auto-fix ${CODEX_MAX_ATTEMPTS}回失敗
Type: ${error_type}
${error_desc}"
    append_codex_result "escalated" "${error_type}" "max auto-fix attempts reached; human intervention required" "" "${attempts}" "${error_hash}" "${context_json}"
    return 1
  fi
  echo $(( attempts + 1 )) > "${attempt_file}"

  local codex_log="${CODEX_LOG_DIR}/$(date +%Y%m%d-%H%M%S)-${error_type}.log"
  log "codex dispatch: attempt $(( attempts + 1 ))/${CODEX_MAX_ATTEMPTS}"

  local prompt="# DSS CI Fix
Repo: /Users/yusuke/DeadStockSolution
Read CLAUDE.md first.

## Error
${error_desc}

## Steps
1. Diagnose root cause
2. Fix minimally
3. npm run lint && npm run typecheck && npm run test
4. If pass: git checkout -b fix/auto-${error_type}-\$(date +%Y%m%d-%H%M) && git add <files> && git commit -m 'fix: ${error_type}' && gh pr create --base main
5. If fail: report only, no PR

## Off-limits
schema.ts, middleware/, vercel.json"

  if dss_codex_exec_prompt "${ROOT_DIR}" "${prompt}" "${codex_log}"; then
    rm -f "${attempt_file}"
    append_codex_result "success" "${error_type}" "codex CI auto-fix dispatch completed successfully" "${codex_log}" "$(( attempts + 1 ))" "${error_hash}" "${context_json}"
    log "codex success"
  else
    append_codex_result "failed" "${error_type}" "codex CI auto-fix dispatch failed" "${codex_log}" "$(( attempts + 1 ))" "${error_hash}" "${context_json}"
    log "codex failed"
  fi
}

gh_api_json() {
  local endpoint="$1"
  gh api "${endpoint}" 2>/dev/null
}

gh_pr_list_json() {
  gh pr list --repo "${REPO}" --label dependencies --json number,title 2>/dev/null
}

flush_error_digest() {
  if [[ ! -s "${ERROR_BUFFER_FILE}" ]]; then
    log "no buffered errors"
    return 0
  fi
  count=$(wc -l < "${ERROR_BUFFER_FILE}" | tr -d ' ')
  preview="$(format_error_preview)"
  tg_send "${TG_GROUP_CHAT_ID}" "⚠️ *DSS ERROR Digest* (${count}件)
${preview}
_$(date '+%Y-%m-%d %H:%M JST')_"

  # Dispatch codex for each unique error (dedup by msg content, not full JSON line)
  if [[ "${CODEX_AUTOFIX_ENABLED}" == "true" ]]; then
    while IFS= read -r row; do
      [[ -z "$row" ]] && continue
      msg=$(printf '%s' "$row" | jq -r '.msg // empty')
      code=$(printf '%s' "$row" | jq -r '.code // "ci-error-digest"')
      context_json=$(printf '%s' "$row" | jq -c '.context // {}')
      [[ -n "$msg" ]] && codex_dispatch "$msg" "${code}" "${context_json}"
    done < <(jq -c '.' "${ERROR_BUFFER_FILE}" 2>/dev/null)
  fi

  mv "${ERROR_BUFFER_FILE}" "${ERROR_BUFFER_DIR}/error-buffer-$(date +%Y%m%d-%H%M).ndjson" 2>/dev/null || true
}

send_daily_report() {
  log "generating daily report"

  # Collect metrics
  ci_runs=$(gh_api_json "repos/${REPO}/actions/runs?per_page=20&created=>=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d '1 day ago' +%Y-%m-%d)" || echo '{"workflow_runs":[]}')
  total=$(echo "$ci_runs" | jq '.workflow_runs | length')
  success=$(echo "$ci_runs" | jq '[.workflow_runs[] | select(.conclusion == "success")] | length')
  failed=$(echo "$ci_runs" | jq '[.workflow_runs[] | select(.conclusion == "failure")] | length')

  # Dependabot PRs
  dep_prs=$(gh_pr_list_json || echo '[]')
  dep_count=$(echo "$dep_prs" | jq 'length')

  # Health check
  health=$(curl -s "https://dead-stock-solution.vercel.app/api/health/openclaw" 2>/dev/null || echo '{"status":"unknown"}')
  health_status=$(echo "$health" | jq -r '.status // "unknown"')

  # Codex results
  read -r codex_today codex_success <<< "$(summarize_codex_results_today)"

  # Send report
  report="📊 *DSS Daily Report*

*CI (24h)*: ${success}/${total} passed, ${failed} failed
*Health*: ${health_status}
*Dependabot PRs*: ${dep_count}件
*Auto-fix*: ${codex_success}/${codex_today} succeeded
_$(date '+%Y-%m-%d %H:%M JST')_"

  tg_send "${TG_GROUP_CHAT_ID}" "${report}"

  # Save to reports
  report_dir="${HOME}/.openclaw/workspace/reports/dss"
  mkdir -p "${report_dir}"
  echo "${report}" > "${report_dir}/daily-$(date +%Y%m%d).md"

  log "daily report sent"
}

collect_new_failures() {
  local failed_runs="$1"
  local last_notified_ids="$2"
  local new_failures=""

  while IFS= read -r run; do
    run_id=$(echo "$run" | jq -r '.id')
    if ! echo ",${last_notified_ids}," | grep -q ",${run_id}," 2>/dev/null; then
      new_failures="${new_failures}${run}
"
    fi
  done < <(echo "$failed_runs" | jq -c '.[]')

  printf '%s' "${new_failures}"
}

buffer_ci_failures() {
  local new_failures="$1"

  while IFS= read -r run; do
    [[ -z "$run" ]] && continue
    name=$(echo "$run" | jq -r '.name')
    branch=$(echo "$run" | jq -r '.branch')
    url=$(echo "$run" | jq -r '.url')
    run_id=$(echo "$run" | jq -r '.id')
    context_json="$(build_ci_context_json "${run_id}" "${name}" "${branch}" "${url}")"
    append_error_buffer_event "error" "ci" "ci_failure" "CI失敗: ${name} (${branch}) ${url}" "${context_json}"
    codex_dispatch "CI job '${name}' failed on branch '${branch}'. See: ${url}. Check GitHub Actions logs, diagnose, and fix." "ci-${name}" "${context_json}"
  done <<< "${new_failures}"
}

run_ci_check() {
  log "checking CI status for ${REPO}"

  if ! command -v gh >/dev/null 2>&1; then
    log "gh CLI not found, skipping CI check"
    return 0
  fi

  ci_runs=$(gh_api_json "repos/${REPO}/actions/runs?per_page=5" || echo '{"workflow_runs":[]}')
  failed_runs=$(echo "$ci_runs" | jq -c '[.workflow_runs[] | select(.conclusion == "failure") | {id:.id, name:.name, branch:.head_branch, url:.html_url}]')
  failed_count=$(echo "$failed_runs" | jq 'length')

  if (( failed_count == 0 )); then
    log "all CI runs passing"
    jq -cn --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson count 0 '{ts:$ts,failed:$count,status:"ok"}' > "${CI_LAST_CHECK}"
    return 0
  fi

  log "${failed_count} failed CI runs detected"

  last_notified_ids=""
  if [[ -f "${CI_LAST_CHECK}" ]]; then
    last_notified_ids=$(jq -r '.notifiedIds // "" ' "${CI_LAST_CHECK}" 2>/dev/null || echo "")
  fi

  new_failures="$(collect_new_failures "${failed_runs}" "${last_notified_ids}")"
  if [[ -z "${new_failures}" ]]; then
    log "no new failures since last check"
    return 0
  fi

  buffer_ci_failures "${new_failures}"

  all_ids=$(echo "$failed_runs" | jq -r '.[].id' | tr '\n' ',' | sed 's/,$//')
  jq -cn --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson count "${failed_count}" --arg ids "${all_ids}" \
    '{ts:$ts,failed:$count,status:"failed",notifiedIds:$ids}' > "${CI_LAST_CHECK}"

  log "buffered ${failed_count} CI failures for digest"
}

case "${1:-}" in
  --flush-errors)
    flush_error_digest
    ;;
  --daily-report)
    send_daily_report
    ;;
  *)
    run_ci_check
    ;;
esac
