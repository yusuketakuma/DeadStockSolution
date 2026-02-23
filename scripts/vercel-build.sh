#!/usr/bin/env sh
set -eu

START_DIR="$(pwd)"

if [ -d client ]; then
  npm run build --workspace=client
  rm -rf "$START_DIR/dist"
  cp -R client/dist "$START_DIR/dist"
elif [ -f ../client/package.json ]; then
  cd ../client
  npm install
  npm run build
  rm -rf "$START_DIR/dist"
  cp -R dist "$START_DIR/dist"
elif [ -f package.json ] && grep -q '"name"[[:space:]]*:[[:space:]]*"client"' package.json; then
  npm run build
else
  echo "client directory not found"
  exit 1
fi
