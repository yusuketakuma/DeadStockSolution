#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BRANCH="${QUALITY_GATE_BRANCH:-preview}"
REMOTE="${QUALITY_GATE_REMOTE:-origin}"
SKIP_INSTALL="${QUALITY_GATE_SKIP_INSTALL:-0}"

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

if ! git diff --quiet || ! git diff --cached --quiet; then
  log "working tree is dirty. Commit/stash first."
  git status --short
  exit 2
fi

log "sync branch ${BRANCH}"
git fetch "$REMOTE" "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only "$REMOTE" "$BRANCH"

if [ "$SKIP_INSTALL" != "1" ]; then
  log "npm ci"
  npm ci --no-audit --no-fund
fi

status=0
run_step "lint:fix" npm run lint:fix || status=1
run_step "typecheck" npm run typecheck || status=1
run_step "test" npm run test || status=1

if [ "$status" -ne 0 ]; then
  log "quality gate failed"
  exit 1
fi

if git diff --quiet && git diff --cached --quiet; then
  log "no code changes"
  exit 0
fi

stamp="$(date '+%Y-%m-%d %H:%M %Z')"
commit_msg="chore(auto-scan): apply safe autofix (${stamp})"

git add -A
git commit -m "$commit_msg"

sha="$(git rev-parse --short HEAD)"
log "commit: ${sha}"

git push "$REMOTE" "$BRANCH"
log "pushed: ${sha}"
