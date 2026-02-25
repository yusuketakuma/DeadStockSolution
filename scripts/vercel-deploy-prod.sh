#!/usr/bin/env sh
set -eu

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$BRANCH" != "main" ]; then
  echo "ERROR: 本番デプロイは main ブランチからのみ実行できます（現在: ${BRANCH}）"
  exit 1
fi

vercel deploy --prod --yes
