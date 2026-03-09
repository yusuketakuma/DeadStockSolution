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

# Remove cached node_modules to avoid stale platform-specific binaries
# (Vercel build cache may restore macOS binaries on Linux)
rm -rf "$ROOT_DIR/node_modules" "$ROOT_DIR/client/node_modules"

# Clean install with devDependencies for build toolchain (tsc/vite)
npm ci --prefix "$ROOT_DIR" --workspace=client --include=dev --include-workspace-root=false --no-audit --no-fund
