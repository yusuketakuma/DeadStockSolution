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

# Single npm ci — preserves lockfile so Vercel node_modules cache is effective.
# Platform-specific optional deps (e.g. @rollup/rollup-linux-x64-gnu) are
# resolved by Vercel running npm ci on linux, matching the deploy target.
npm ci --prefix "$ROOT_DIR" --no-audit --no-fund
