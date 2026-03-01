#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${XDG_CONFIG_HOME:-$HOME/.openclaw}/openclaw.json}"
BACKUP_ROOT="${BACKUP_ROOT:-${XDG_CONFIG_HOME:-$HOME/.openclaw}/workspace/backups/deadstock-openclaw}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_ROOT"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
mkdir -p "$BACKUP_DIR"

if [[ -f "$OPENCLAW_CONFIG_PATH" ]]; then
  cp "$OPENCLAW_CONFIG_PATH" "$BACKUP_DIR/openclaw.json"
fi

BRANCH_NAME="preview"
if ! git -C "$REPO_ROOT" rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
  echo "previewブランチが見つかりません" >&2
  exit 1
fi

git -C "$REPO_ROOT" bundle create "$BACKUP_DIR/deadstock-preview.bundle" "$BRANCH_NAME"

LATEST_COMMIT="$(git -C "$REPO_ROOT" rev-parse "$BRANCH_NAME")"
cat > "$BACKUP_DIR/metadata.txt" <<META
timestamp=$TIMESTAMP
repo=$REPO_ROOT
branch=$BRANCH_NAME
commit=$LATEST_COMMIT
openclaw_config=$OPENCLAW_CONFIG_PATH
META

find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} +

echo "backup_created=$BACKUP_DIR"
