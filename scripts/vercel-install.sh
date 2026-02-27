#!/usr/bin/env sh
set -eu

START_DIR="$(pwd)"

if [ -d "$START_DIR/client" ] && [ -d "$START_DIR/server" ]; then
  ROOT_DIR="$START_DIR"
elif [ -d "$START_DIR/../client" ] && [ -d "$START_DIR/../server" ]; then
  ROOT_DIR="$(cd "$START_DIR/.." && pwd)"
else
  echo "workspace layout not found"
  exit 1
fi

# Deterministic workspace installs from lockfile.
# Client keeps devDependencies for Vite build; server omits dev dependencies.
npm ci --prefix "$ROOT_DIR" --workspace=client --include-workspace-root=false --no-audit --no-fund
npm ci --prefix "$ROOT_DIR" --workspace=server --include-workspace-root=false --omit=dev --no-audit --no-fund
