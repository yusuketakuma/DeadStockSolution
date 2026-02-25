#!/usr/bin/env sh
set -eu

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$BRANCH" != "preview" ]; then
  echo "ERROR: Previewデプロイは preview ブランチからのみ実行できます（現在: ${BRANCH}）"
  exit 1
fi

vercel deploy --yes
