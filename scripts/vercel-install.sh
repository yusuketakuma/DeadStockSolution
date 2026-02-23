#!/usr/bin/env sh
set -eu

if [ -d client ] && [ -d server ] && [ -f package.json ]; then
  npm install --workspace=client
  npm install --workspace=server --omit=dev
elif [ -f ../package.json ] && [ -d ../client ] && [ -d ../server ]; then
  cd ..
  npm install --workspace=client
  npm install --workspace=server --omit=dev
elif [ -f package.json ] && grep -q '"name"[[:space:]]*:[[:space:]]*"client"' package.json; then
  cd ..
  npm install --workspace=client
  npm install --workspace=server --omit=dev
elif [ -f package.json ] && grep -q '"name"[[:space:]]*:[[:space:]]*"server"' package.json; then
  cd ..
  npm install --workspace=client
  npm install --workspace=server --omit=dev
else
  echo "workspace layout not found"
  exit 1
fi
