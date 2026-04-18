#!/usr/bin/env bash

dss_tg_send() {
  local bot_token="$1"
  local chat_id="$2"
  local text="$3"

  [[ -z "${bot_token}" ]] && return 0
  curl -s -X POST "https://api.telegram.org/bot${bot_token}/sendMessage" \
    -d "chat_id=${chat_id}" \
    -d "parse_mode=Markdown" \
    --data-urlencode "text=${text}" >/dev/null 2>&1 || true
}

dss_tg_notify_critical() {
  local bot_token="$1"
  local chat_id="$2"
  local message="$3"

  dss_tg_send "${bot_token}" "${chat_id}" "🚨 *DSS CRITICAL*
${message}
_$(date '+%Y-%m-%d %H:%M:%S JST')_"
}
