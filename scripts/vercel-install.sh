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

# Deterministic workspace install from lockfile.
# Install only client dependencies here, and force devDependencies even under
# NODE_ENV=production so the client build toolchain (tsc/vite) is available.
npm ci --prefix "$ROOT_DIR" --workspace=client --include=dev --include-workspace-root=false --no-audit --no-fund
