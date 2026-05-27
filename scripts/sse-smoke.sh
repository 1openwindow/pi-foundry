#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
SESSION_ID="${SESSION_ID:-sse-smoke}"

curl --noproxy '*' -sS -N "$BASE_URL/invocations?agent_session_id=$SESSION_ID&stream=true" \
  -H 'content-type: application/json' \
  -H 'accept: text/event-stream' \
  -d '{"message":"Say exactly: ok"}'
