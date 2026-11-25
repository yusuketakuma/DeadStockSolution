#!/usr/bin/env sh
# wrangler.jsonc の Hyperdrive ID プレースホルダを置き換えた wrangler.deploy.jsonc を生成する。
# 使い方: HYPERDRIVE_ID=<ID> sh scripts/cloudflare-render-config.sh production|preview
set -eu

TARGET="${1:-}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

case "$TARGET" in
  production) PLACEHOLDER="REPLACE_WITH_PRODUCTION_HYPERDRIVE_ID" ;;
  preview) PLACEHOLDER="REPLACE_WITH_PREVIEW_HYPERDRIVE_ID" ;;
  *)
    echo "ERROR: 引数に production または preview を指定してください"
    exit 1
    ;;
esac

HYPERDRIVE_ID="${HYPERDRIVE_ID:-}"
if [ -z "$HYPERDRIVE_ID" ]; then
  echo "ERROR: HYPERDRIVE_ID が未設定です（${TARGET} 用の Hyperdrive ID を指定してください）"
  exit 1
fi
if ! printf '%s' "$HYPERDRIVE_ID" | grep -Eq '^[0-9a-f]{32}$'; then
  echo "ERROR: HYPERDRIVE_ID の形式が不正です（32 桁の16進数）"
  exit 1
fi

sed "s/${PLACEHOLDER}/${HYPERDRIVE_ID}/" "$ROOT_DIR/wrangler.jsonc" > "$ROOT_DIR/wrangler.deploy.jsonc"

if ! grep -q "\"id\": \"${HYPERDRIVE_ID}\"" "$ROOT_DIR/wrangler.deploy.jsonc"; then
  echo "ERROR: Hyperdrive ID を設定できませんでした"
  exit 1
fi
echo "wrangler.deploy.jsonc を生成しました（${TARGET}）"
