#!/usr/bin/env bash

dss_compute_error_hash() {
  local raw_text="$1"
  printf '%s' "${raw_text}" | md5 -q 2>/dev/null || printf '%s' "${raw_text}" | md5sum | cut -d' ' -f1
}

dss_append_error_buffer_event() {
  local severity="$1"
  local category="$2"
  local code="$3"
  local message="$4"
  local context_json="$5"
  local artifacts_json="$6"

  jq -cn \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg schema "${LOG_SCHEMA_VERSION}" \
    --arg source "${DSS_LOG_SOURCE}" \
    --arg component "${DSS_LOG_COMPONENT}" \
    --arg severity "${severity}" \
    --arg category "${category}" \
    --arg event "${code}" \
    --arg code "${code}" \
    --arg msg "${message}" \
    --arg runId "${RUN_ID:-}" \
    --argjson context "${context_json}" \
    --argjson artifacts "${artifacts_json}" \
    '{
      ts: $ts,
      schema: $schema,
      source: $source,
      component: $component,
      severity: $severity,
      category: $category,
      event: $event,
      code: $code,
      msg: $msg,
      runId: (if $runId == "" then null else $runId end),
      context: $context,
      artifacts: $artifacts
    }' >>"${ERROR_BUFFER_FILE}"
}

dss_append_codex_result() {
  local status="$1"
  local error_type="$2"
  local summary="$3"
  local log_path="$4"
  local attempt="$5"
  local error_hash="$6"
  local context_json="$7"
  local artifacts_json="$8"

  jq -cn \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg schema "${LOG_SCHEMA_VERSION}" \
    --arg source "${DSS_LOG_SOURCE}" \
    --arg component "codex-dispatch" \
    --arg status "${status}" \
    --arg type "${error_type}" \
    --arg summary "${summary}" \
    --arg log "${log_path}" \
    --arg errorHash "${error_hash}" \
    --arg runId "${RUN_ID:-}" \
    --argjson attempt "${attempt}" \
    --argjson maxAttempts "${CODEX_MAX_ATTEMPTS}" \
    --argjson dedupWindowSec "${CODEX_DEDUP_WINDOW_SEC}" \
    --argjson context "${context_json}" \
    --argjson artifacts "${artifacts_json}" \
    '{
      ts: $ts,
      schema: $schema,
      source: $source,
      component: $component,
      status: $status,
      type: $type,
      summary: $summary,
      log: (if $log == "" then null else $log end),
      errorHash: (if $errorHash == "" then null else $errorHash end),
      runId: (if $runId == "" then null else $runId end),
      attempt: $attempt,
      maxAttempts: $maxAttempts,
      dedupWindowSec: $dedupWindowSec,
      context: $context,
      artifacts: $artifacts
    }' >>"${CODEX_RESULTS_LOG}"
}

dss_format_error_preview() {
  jq -r '[.severity // "unknown", .source // "unknown", .msg // ""] | @tsv' "${ERROR_BUFFER_FILE}" 2>/dev/null |
    head -5 |
    while IFS=$'\t' read -r severity source message; do
      printf '[%s/%s] %s\n' "${severity}" "${source}" "${message}"
    done
}

dss_summarize_codex_results_today() {
  if [[ ! -f "${CODEX_RESULTS_LOG}" ]]; then
    printf '0 0'
    return 0
  fi

  local today
  today="$(date +%Y-%m-%d)"
  jq -r --arg today "${today}" '
    [inputs | select((.ts // "") | startswith($today))] as $items |
    "\($items | length) \($items | map(select(.status == "success")) | length)"
  ' "${CODEX_RESULTS_LOG}" 2>/dev/null || printf '0 0'
}
