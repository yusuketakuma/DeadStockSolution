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

# npm install (not ci) — resolves platform-specific optional deps for the
# deploy target (linux x64) even when lockfile was generated on macOS.
# Keeps existing node_modules so Vercel cache is still effective.
npm install --prefix "$ROOT_DIR" --no-audit --no-fund
