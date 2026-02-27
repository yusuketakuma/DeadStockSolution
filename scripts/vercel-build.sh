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

CLIENT_DIR="$ROOT_DIR/client"

(
  cd "$CLIENT_DIR"
  npm run build
)

# After client build succeeds, install only server production dependencies.
# This avoids carrying server devDependencies in deploy artifacts.
npm ci --prefix "$ROOT_DIR" --workspace=server --omit=dev --include-workspace-root=false --no-audit --no-fund

if [ "$START_DIR" != "$CLIENT_DIR" ]; then
  rm -rf "$START_DIR/dist"
  cp -R "$CLIENT_DIR/dist" "$START_DIR/dist"
fi
