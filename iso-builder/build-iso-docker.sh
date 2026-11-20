#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IMAGE_NAME="nas-os-iso-builder:trixie"

echo "==> [1/4] Building Backend (TypeScript) on host..."
cd "${REPO_ROOT}/backend"
npm ci
npm run build
npm prune --omit=dev

echo "==> [2/4] Building Frontend (Angular) on host..."
cd "${REPO_ROOT}/frontend"
npm ci
npm run build

if [ "${SKIP_DOCKER_BUILD:-0}" != "1" ]; then
  echo "==> [3/4] Building Docker ISO builder image (${IMAGE_NAME})..."
  docker build -t "${IMAGE_NAME}" -f "${SCRIPT_DIR}/Dockerfile" "${SCRIPT_DIR}"
else
  echo "==> [3/4] Using pre-built Docker ISO builder image (${IMAGE_NAME})..."
fi

APP_VERSION="${SILOOS_VERSION:-$(cat "${REPO_ROOT}/VERSION" 2>/dev/null | tr -d '[:space:]' || echo '1.0.0')}"
ISO_VARIANT="${ISO_VARIANT:-}"
EXTRA_KERNEL_OPTS="${EXTRA_KERNEL_OPTS:-}"
if [ -n "${ISO_VARIANT}" ]; then
  ISO_FILENAME="siloos-x86_64-v${APP_VERSION}-${ISO_VARIANT}.iso"
else
  ISO_FILENAME="siloos-x86_64-v${APP_VERSION}.iso"
fi

echo "==> [4/4] Running live-build inside privileged Docker container..."
docker run --rm --privileged \
  -e SKIP_APP_BUILD=1 \
  -e LB_WORK_DIR=/tmp/lb-work \
  -e LB_CACHE_DIR=/workspace/iso-builder/.lb-cache \
  -e SILOOS_VERSION="${APP_VERSION}" \
  -e ISO_VARIANT="${ISO_VARIANT}" \
  -e EXTRA_KERNEL_OPTS="${EXTRA_KERNEL_OPTS}" \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -v "${REPO_ROOT}:/workspace" \
  "${IMAGE_NAME}"

echo "==> Done! ISO available at: ${REPO_ROOT}/${ISO_FILENAME}"
