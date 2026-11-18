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

echo "==> [3/4] Building Docker ISO builder image (${IMAGE_NAME})..."
docker build -t "${IMAGE_NAME}" -f "${SCRIPT_DIR}/Dockerfile" "${SCRIPT_DIR}"

APP_VERSION="${SILOOS_VERSION:-$(cat "${REPO_ROOT}/VERSION" 2>/dev/null | tr -d '[:space:]' || echo '1.0.0')}"

echo "==> [4/4] Running live-build inside privileged Docker container..."
docker run --rm --privileged \
  -e SKIP_APP_BUILD=1 \
  -e LB_WORK_DIR=/tmp/lb-work \
  -e SILOOS_VERSION="${APP_VERSION}" \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -v "${REPO_ROOT}:/workspace" \
  "${IMAGE_NAME}"

echo "==> Done! ISO available at: ${REPO_ROOT}/siloos-x86_64-v${APP_VERSION}.iso"
