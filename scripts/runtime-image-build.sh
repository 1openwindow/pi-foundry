#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${OPEN_FOUNDRY_RUNTIME_IMAGE:-pi-foundry-runtime:local}"
DOCKERFILE="${OPEN_FOUNDRY_RUNTIME_DOCKERFILE:-Dockerfile.runtime}"

cd "$(dirname "$0")/.."

echo "Building open-foundry runtime image"
echo "Image:      ${IMAGE_TAG}"
echo "Dockerfile: ${DOCKERFILE}"

docker build \
  --pull=false \
  ${DOCKER_BUILD_NETWORK:+--network=${DOCKER_BUILD_NETWORK}} \
  -f "${DOCKERFILE}" \
  -t "${IMAGE_TAG}" \
  .

echo "Runtime image built: ${IMAGE_TAG}"
