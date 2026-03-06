#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BRANCH="${QUALITY_GATE_BRANCH:-preview}"
REMOTE="${QUALITY_GATE_REMOTE:-origin}"
SKIP_INSTALL="${QUALITY_GATE_SKIP_INSTALL:-0}"
SKIP_SYNC="${QUALITY_GATE_SKIP_SYNC:-0}"
ALLOW_DIRTY="${QUALITY_GATE_ALLOW_DIRTY:-0}"
READ_ONLY="${QUALITY_GATE_READ_ONLY:-0}"
OPENCLAW_CLI_PATH="${OPENCLAW_CLI_PATH:-openclaw}"
NOTIFY_CHANNEL="${OPENCLAW_NOTIFY_CHANNEL:-telegram}"
NOTIFY_TARGET="${OPENCLAW_NOTIFY_TARGET:-}"

log() {
  printf '[quality-gate] %s\n' "$*"
}

run_step() {
  local label="$1"
  shift

  log "run: ${label}"
  if "$@"; then
    log "ok: ${label}"
    return 0
  fi

  log "ng: ${label}"
  return 1
}

notify_failure() {
  local reason="$1"
  if [[ -z "$NOTIFY_TARGET" ]]; then
    return 0
  fi
  if ! command -v "$OPENCLAW_CLI_PATH" >/dev/null 2>&1; then
    return 0
  fi

  local message
  message=$(
    cat <<MSG
⚠️ DeadStockSolution 品質ゲート失敗
step: $reason
branch: $(git rev-parse --abbrev-ref HEAD)
commit: $(git rev-parse --short HEAD)
対応: ローカルでログを確認して修正してください。
MSG
  )

  "$OPENCLAW_CLI_PATH" message send \
    --channel "$NOTIFY_CHANNEL" \
    --target "$NOTIFY_TARGET" \
    --message "$message" >/dev/null || true
}

LAST_STEP="unknown"
trap 'notify_failure "$LAST_STEP"' ERR

if [ "$ALLOW_DIRTY" != "1" ] && { ! git diff --quiet || ! git diff --cached --quiet; }; then
  log "working tree is dirty. Commit/stash first."
  git status --short
  exit 2
fi

if [ "$SKIP_SYNC" != "1" ]; then
  log "sync branch ${BRANCH}"
  git fetch "$REMOTE" "$BRANCH"
  git checkout "$BRANCH"
  git pull --ff-only "$REMOTE" "$BRANCH"
fi

if [ "$SKIP_INSTALL" != "1" ]; then
  log "npm ci"
  npm ci --no-audit --no-fund
fi

status=0
if [ "$READ_ONLY" = "1" ]; then
  LAST_STEP="lint"
  run_step "lint" npm run lint || status=1
else
  LAST_STEP="lint:fix"
  run_step "lint:fix" npm run lint:fix || status=1
fi
LAST_STEP="typecheck"
run_step "typecheck" npm run typecheck || status=1
LAST_STEP="test"
run_step "test" npm run test || status=1

if [ "$status" -ne 0 ]; then
  log "quality gate failed"
  exit 1
fi

if [ "$READ_ONLY" = "1" ]; then
  log "read-only mode: skip commit/push"
  exit 0
fi

if git diff --quiet && git diff --cached --quiet; then
  log "no code changes"
  exit 0
fi

stamp="$(date '+%Y-%m-%d %H:%M %Z')"
commit_msg="fix(auto-scan): apply safe autofix (${stamp})"

git add -A
git commit -m "$commit_msg"

sha="$(git rev-parse --short HEAD)"
log "commit: ${sha}"

git push "$REMOTE" "$BRANCH"
log "pushed: ${sha}"
