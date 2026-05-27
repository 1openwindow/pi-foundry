#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"

curl --noproxy '*' -sS "$BASE_URL/health"
printf '\n'
curl --noproxy '*' -sS "$BASE_URL/invocations" \
  -H 'content-type: application/json' \
  -d '{"message":"List files in the current directory."}'
printf '\n'
