#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-pi-foundry:local}"
HOST_PORT="${HOST_PORT:-8110}"
CONTAINER_PORT="${CONTAINER_PORT:-8088}"

container_id="$(docker run -d --rm -p "${HOST_PORT}:${CONTAINER_PORT}" -e PI_MOCK=1 "$IMAGE_TAG")"
cleanup() {
  docker stop "$container_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sleep 3
BASE_URL="http://127.0.0.1:${HOST_PORT}" npm run smoke:curl
