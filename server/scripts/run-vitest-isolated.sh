#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VITEST_BIN="../node_modules/.bin/vitest"

if [ "$#" -gt 0 ]; then
  exec "$VITEST_BIN" run --config vitest.config.ts "$@"
fi

status=0
tmp_file="$(mktemp)"
find src/test \
  -path 'src/test/integration' -prune -o \
  -type f -name '*.test.ts' -print | sort > "$tmp_file"

while IFS= read -r file; do
  "$VITEST_BIN" run --config vitest.config.ts "$file" || status=$?
done < "$tmp_file"

rm -f "$tmp_file"

exit "$status"
