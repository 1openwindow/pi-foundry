#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-pi-foundry:local}"
HOST_PORT="${HOST_PORT:-8081}"
PI_AGENT_SOURCE="${PI_AGENT_SOURCE:-$HOME/.pi/agent}"
TMP_AGENT_DIR="$(mktemp -d)"

cleanup() {
  if [[ -n "${container_id:-}" ]]; then
    docker stop "$container_id" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_AGENT_DIR"
}
trap cleanup EXIT

cp -a "$PI_AGENT_SOURCE/." "$TMP_AGENT_DIR/"

container_id="$(docker run -d --rm \
  --network=host \
  -e PORT="$HOST_PORT" \
  -e HTTP_PROXY="${HTTP_PROXY:-${http_proxy:-}}" \
  -e HTTPS_PROXY="${HTTPS_PROXY:-${https_proxy:-}}" \
  -e NO_PROXY="${NO_PROXY:-${no_proxy:-}}" \
  -v "$PWD:/workspace" \
  -v "$TMP_AGENT_DIR:/home/node/.pi-foundry/pi-agent" \
  "$IMAGE_TAG")"

sleep 3
BASE_URL="http://127.0.0.1:${HOST_PORT}" npm run smoke:curl
