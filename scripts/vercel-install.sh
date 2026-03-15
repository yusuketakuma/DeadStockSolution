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

# Workaround for npm optional-deps bug (https://github.com/npm/cli/issues/4828):
# Vercel build cache may contain macOS node_modules missing linux-specific
# optional deps like @rollup/rollup-linux-x64-gnu. Delete node_modules only
# (keep lockfile for faster resolution) then install fresh for linux.
rm -rf "$ROOT_DIR/node_modules" "$ROOT_DIR/client/node_modules" "$ROOT_DIR/server/node_modules"

npm install --prefix "$ROOT_DIR" --no-audit --no-fund
