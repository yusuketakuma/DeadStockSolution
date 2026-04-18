#!/usr/bin/env bash

dss_codex_exec_prompt() {
  local root_dir="$1"
  local prompt="$2"
  local log_path="$3"

  (
    cd "${root_dir}"
    codex exec \
      --model gpt-5.4 \
      -c "writable_roots=[\"${root_dir}\"]" \
      -c 'sandbox_permissions=["disk-full-read-access"]' \
      "${prompt}"
  ) >"${log_path}" 2>&1
}
