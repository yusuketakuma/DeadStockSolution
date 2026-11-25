#!/usr/bin/env sh
set -eu

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$BRANCH" != "main" ]; then
  echo "ERROR: 本番デプロイは main ブランチからのみ実行できます（現在: ${BRANCH}）"
  exit 1
fi

node scripts/sync-version.mjs
npm run build:client
# Hyperdrive ID は CLOUDFLARE_HYPERDRIVE_ID_PRODUCTION で渡す（GitHub 変数と同じ値）
HYPERDRIVE_ID="${CLOUDFLARE_HYPERDRIVE_ID_PRODUCTION:-}" sh scripts/cloudflare-render-config.sh production
npx wrangler deploy -c wrangler.deploy.jsonc --env ""
