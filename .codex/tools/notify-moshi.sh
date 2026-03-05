#!/usr/bin/env bash
set -euo pipefail

# Codex は notify コマンドへ JSON payload を argv[1] として渡す（公式例の形）
payload="${1:-}"

if [[ -z "${payload}" ]]; then
  exit 0
fi

# type を読む（python3があれば確実）
event_type="$(python3 - << 'PY' "${payload}"
import json,sys
try:
  obj=json.loads(sys.argv[1])
  print(obj.get("type",""))
except Exception:
  print("")
PY
)"

# “turnごと” に鳴るので、必要ならここで条件を追加して間引く
# 現状は agent-turn-complete のみが来る想定
if [[ "${event_type}" != "agent-turn-complete" ]]; then
  exit 0
fi

# token は本来 env 化推奨。AGENTS.md に値が固定で書かれているが漏洩注意。
MOSHI_TOKEN="${MOSHI_TOKEN:-qGli1ov22jEY3PEtuI5qGXPJegjvRrFD}"

curl -sS -X POST \
  "https://api.getmoshi.app/api/webhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"token\": \"${MOSHI_TOKEN}\",
    \"title\": \"Codex Turn Complete\",
    \"message\": \"An agent turn completed.\"
  }" >/dev/null || true
