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

# Install each package in isolation to avoid workspace-wide omit=dev side effects.
# This keeps client devDependencies available for Vite build while omitting server devDependencies.
npm install --prefix "$ROOT_DIR/client" --package-lock=false --no-audit --no-fund
npm install --prefix "$ROOT_DIR/server" --omit=dev --package-lock=false --no-audit --no-fund
