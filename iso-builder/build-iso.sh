#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORK_DIR="${LB_WORK_DIR:-${SCRIPT_DIR}/work}"
OUTPUT_ISO="${REPO_ROOT}/nas-os-debian13-amd64.iso"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: build-iso.sh must be run as root (or via build-iso-docker.sh)"
  exit 1
fi

echo "==> [1/6] Checking host build dependencies..."
if ! command -v lb >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends \
    live-build \
    debootstrap \
    curl \
    gnupg \
    ca-certificates \
    xorriso \
    squashfs-tools
fi

if [ "${SKIP_APP_BUILD:-0}" != "1" ]; then
  echo "==> [2/6] Building Backend (TypeScript)..."
  cd "${REPO_ROOT}/backend"
  npm ci
  npm run build

  echo "==> [3/6] Building Frontend (Angular production bundle)..."
  cd "${REPO_ROOT}/frontend"
  npm ci
  npm run build
else
  echo "==> [2/6] Skipping Backend build (SKIP_APP_BUILD=1)"
  echo "==> [3/6] Skipping Frontend build (SKIP_APP_BUILD=1)"
fi

echo "==> [4/6] Preparing live-build workspace in ${WORK_DIR}..."
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"
cd "${WORK_DIR}"

lb config \
  --distribution trixie \
  --architectures amd64 \
  --binary-images iso-hybrid \
  --debian-installer live \
  --debian-installer-gui false \
  --archive-areas "main contrib non-free non-free-firmware" \
  --debootstrap-options "--include=ca-certificates" \
  --apt-recommends false \
  --memtest none \
  --iso-application "NAS-OS" \
  --iso-volume "NAS-OS-DEBIAN13" \
  --bootappend-live "boot=live components quiet loglevel=3" \
  --bootappend-install "cdrom-detect/try-usb=true quiet loglevel=3"

echo "==> [5/6] Copying NAS-OS configs, hooks, archives, and preseed..."
mkdir -p config/package-lists config/hooks/normal config/includes.installer config/archives
mkdir -p config/includes.chroot/opt/nas-os/backend
mkdir -p config/includes.chroot/opt/nas-os/frontend/dist
mkdir -p config/includes.chroot/etc/nginx/sites-available
mkdir -p config/includes.chroot/etc/systemd/system
mkdir -p config/includes.chroot/usr/local/bin
mkdir -p config/includes.chroot/usr/local/sbin
mkdir -p config/includes.chroot/etc/NetworkManager/dispatcher.d
mkdir -p config/includes.chroot/etc/udev/rules.d

cp "${SCRIPT_DIR}/config/package-lists/nas.list.chroot" config/package-lists/
cp "${SCRIPT_DIR}/config/hooks/normal/0100-setup-nas.hook.chroot" config/hooks/normal/
chmod +x config/hooks/normal/0100-setup-nas.hook.chroot
cp "${SCRIPT_DIR}/config/includes.installer/preseed.cfg" config/includes.installer/

# Official Docker APT repository for Debian 13 (Trixie)
curl -fsSL https://download.docker.com/linux/debian/gpg -o config/archives/docker.key.chroot
echo "deb [arch=amd64] https://download.docker.com/linux/debian trixie stable" \
  > config/archives/docker.list.chroot

# Copy built backend, frontend, nginx, and systemd service
cp -r "${REPO_ROOT}/backend/dist" config/includes.chroot/opt/nas-os/backend/
cp "${REPO_ROOT}/backend/package.json" config/includes.chroot/opt/nas-os/backend/
cp "${REPO_ROOT}/backend/package-lock.json" config/includes.chroot/opt/nas-os/backend/
cp -r "${REPO_ROOT}/frontend/dist/nas-os-frontend" config/includes.chroot/opt/nas-os/frontend/dist/
cp "${SCRIPT_DIR}/../system/nginx/nas-os.conf" config/includes.chroot/etc/nginx/sites-available/nas-os.conf
cp "${SCRIPT_DIR}/../system/systemd/nas-os.service" config/includes.chroot/etc/systemd/system/nas-os.service
cp "${SCRIPT_DIR}/../system/systemd/nas-os-banner.service" config/includes.chroot/etc/systemd/system/nas-os-banner.service
cp "${SCRIPT_DIR}/../system/scripts/nas-os-banner.sh" config/includes.chroot/usr/local/bin/nas-os-banner.sh
cp "${SCRIPT_DIR}/../system/scripts/nas-os-install.sh" config/includes.chroot/usr/local/sbin/nas-os-install
cp "${SCRIPT_DIR}/../system/scripts/nas-os-usb-mount.sh" config/includes.chroot/usr/local/sbin/nas-os-usb-mount
cp "${SCRIPT_DIR}/../system/scripts/nas-os-update.sh" config/includes.chroot/usr/local/sbin/nas-os-update
cp "${SCRIPT_DIR}/../system/udev/99-nas-os-usb-automount.rules" config/includes.chroot/etc/udev/rules.d/99-nas-os-usb-automount.rules
cp "${SCRIPT_DIR}/../system/scripts/99-nas-os-banner" config/includes.chroot/etc/NetworkManager/dispatcher.d/99-nas-os-banner

echo "==> [6/6] Running lb build (this may take several minutes)..."
lb build

ISO_GENERATED="$(find "${WORK_DIR}" -maxdepth 1 -name '*.iso' | head -n 1)"
if [ -z "${ISO_GENERATED}" ]; then
  echo "ERROR: No .iso file produced by lb build."
  exit 1
fi

mv "${ISO_GENERATED}" "${OUTPUT_ISO}"
if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ]; then
  chown "${HOST_UID}:${HOST_GID}" "${OUTPUT_ISO}"
fi

echo "==> SUCCESS! Bootable ISO generated at: ${OUTPUT_ISO}"
