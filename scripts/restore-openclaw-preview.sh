#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-dir>" >&2
  exit 1
fi

BACKUP_DIR="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${XDG_CONFIG_HOME:-$HOME/.openclaw}/openclaw.json}"

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "バックアップディレクトリが見つかりません: $BACKUP_DIR" >&2
  exit 1
fi

if [[ -f "$BACKUP_DIR/openclaw.json" ]]; then
  cp "$BACKUP_DIR/openclaw.json" "$OPENCLAW_CONFIG_PATH"
  echo "openclaw_config_restored=$OPENCLAW_CONFIG_PATH"
else
  echo "openclaw.json が見つからないため設定復元はスキップ"
fi

if [[ -f "$BACKUP_DIR/deadstock-preview.bundle" ]]; then
  git -C "$REPO_ROOT" fetch "$BACKUP_DIR/deadstock-preview.bundle" preview:preview
  echo "preview_branch_restored_from_bundle=$BACKUP_DIR/deadstock-preview.bundle"
else
  echo "deadstock-preview.bundle が見つからないためブランチ復元はスキップ"
fi

echo "復元後は以下を実行してください:"
echo "  1) git -C $REPO_ROOT checkout preview"
echo "  2) openclaw gateway restart"
