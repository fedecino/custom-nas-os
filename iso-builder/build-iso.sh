#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORK_DIR="${LB_WORK_DIR:-${SCRIPT_DIR}/work}"
APP_VERSION="${SILOOS_VERSION:-$(cat "${REPO_ROOT}/VERSION" 2>/dev/null | tr -d '[:space:]' || echo '1.0.0')}"
ISO_VARIANT="${ISO_VARIANT:-}"
EXTRA_KERNEL_OPTS="${EXTRA_KERNEL_OPTS:-}"
if [ -n "${ISO_VARIANT}" ]; then
  OUTPUT_ISO="${REPO_ROOT}/siloos-x86_64-v${APP_VERSION}-${ISO_VARIANT}.iso"
else
  OUTPUT_ISO="${REPO_ROOT}/siloos-x86_64-v${APP_VERSION}.iso"
fi

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
  npm prune --omit=dev

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
if [ -n "${LB_CACHE_DIR:-}" ]; then
  mkdir -p "${LB_CACHE_DIR}"
  ln -sfn "${LB_CACHE_DIR}" "${WORK_DIR}/cache"
fi
cd "${WORK_DIR}"

LIVE_BOOT_OPTS="boot=live components hostname=siloos quiet loglevel=3"
INSTALL_BOOT_OPTS="cdrom-detect/try-usb=true quiet loglevel=3"
if [ -n "${EXTRA_KERNEL_OPTS}" ]; then
  echo "==> Applying extra kernel boot options: ${EXTRA_KERNEL_OPTS}"
  LIVE_BOOT_OPTS="${LIVE_BOOT_OPTS} ${EXTRA_KERNEL_OPTS}"
  INSTALL_BOOT_OPTS="${INSTALL_BOOT_OPTS} ${EXTRA_KERNEL_OPTS}"
fi

lb config \
  --distribution trixie \
  --architectures amd64 \
  --binary-images iso-hybrid \
  --bootloaders "syslinux,grub-efi" \
  --debian-installer live \
  --debian-installer-gui false \
  --archive-areas "main contrib non-free non-free-firmware" \
  --debootstrap-options "--include=ca-certificates" \
  --cache true \
  --cache-packages true \
  --cache-stages "bootstrap" \
  --compression gzip \
  --apt-recommends false \
  --memtest none \
  --iso-application "SiloOs" \
  --iso-volume "SILOOS_X86_64" \
  --bootappend-live "${LIVE_BOOT_OPTS}" \
  --bootappend-install "${INSTALL_BOOT_OPTS}"

echo "==> [5/6] Copying NAS-OS configs, hooks, archives, and preseed..."
mkdir -p config/package-lists config/hooks/normal config/includes.installer config/archives

# Override live-build bootloader templates (official way) for 3-second headless auto-boot on BIOS & UEFI
if [ -d /usr/share/live/build/bootloaders ]; then
  echo "==> Configuring 3-second headless auto-boot templates (BIOS isolinux + UEFI grub)..."
  mkdir -p config/bootloaders
  cp -r /usr/share/live/build/bootloaders/* config/bootloaders/

  # 1. BIOS Legacy (isolinux / syslinux): timeout is in tenths of a second (30 = 3s)
  find config/bootloaders -type f \( -name 'isolinux.cfg' -o -name 'syslinux.cfg' \) | while read -r cfg; do
    echo "    Patching BIOS template: $cfg"
    if grep -qi '^timeout ' "$cfg"; then
      sed -i 's/^timeout .*/timeout 30/I' "$cfg"
    else
      echo "timeout 30" >> "$cfg"
    fi
    if grep -qi '^prompt ' "$cfg"; then
      sed -i 's/^prompt .*/prompt 0/I' "$cfg"
    fi
  done

  # 2. UEFI (GRUB): timeout is in seconds (3s)
  find config/bootloaders -type f \( -name 'config.cfg' -o -name 'grub.cfg' \) | while read -r gcfg; do
    echo "    Patching UEFI template: $gcfg"
    if grep -q 'set timeout=' "$gcfg"; then
      sed -i 's/set timeout=.*/set timeout=3/' "$gcfg"
    elif grep -q 'set default=' "$gcfg"; then
      sed -i '/^set default=/a set timeout=3' "$gcfg"
    else
      sed -i '1i set default=0\nset timeout=3' "$gcfg"
    fi
  done
fi
mkdir -p config/includes.chroot/opt/nas-os/backend
mkdir -p config/includes.chroot/opt/nas-os/frontend/dist
mkdir -p config/includes.chroot/etc/nginx/sites-available
mkdir -p config/includes.chroot/etc/systemd/system
mkdir -p config/includes.chroot/usr/local/bin
mkdir -p config/includes.chroot/usr/local/sbin
mkdir -p config/includes.chroot/etc/NetworkManager/dispatcher.d
mkdir -p config/includes.chroot/etc/udev/rules.d

# Persist variant-specific kernel options (e.g. mem=5G for TerraMaster J1800) so nas-os-install applies them to GRUB
if [ -n "${EXTRA_KERNEL_OPTS}" ]; then
  echo "${EXTRA_KERNEL_OPTS}" > config/includes.chroot/etc/siloos-kernel-opts
fi
if [ "${ISO_VARIANT}" = "terramaster-j1800" ]; then
  mkdir -p config/includes.chroot/etc/modules-load.d
  printf "coretemp\nit87\n" > config/includes.chroot/etc/modules-load.d/siloos-terramaster.conf
fi

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
[ -d "${REPO_ROOT}/backend/node_modules" ] && cp -r "${REPO_ROOT}/backend/node_modules" config/includes.chroot/opt/nas-os/backend/
[ -f "${REPO_ROOT}/VERSION" ] && cp "${REPO_ROOT}/VERSION" config/includes.chroot/opt/nas-os/VERSION
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

# Verify auto-boot timeouts inside the generated ISO
echo "==> Verifying BIOS & UEFI auto-boot timeouts in ${OUTPUT_ISO}..."
if command -v xorriso >/dev/null 2>&1; then
  TMP_CHK="$(mktemp -d)"
  xorriso -osirrox on -indev "${OUTPUT_ISO}" -extract /isolinux/isolinux.cfg "${TMP_CHK}/isolinux.cfg" 2>/dev/null || true
  xorriso -osirrox on -indev "${OUTPUT_ISO}" -extract /boot/grub/config.cfg "${TMP_CHK}/config.cfg" 2>/dev/null || true
  if [ -f "${TMP_CHK}/isolinux.cfg" ]; then
    grep -i 'timeout' "${TMP_CHK}/isolinux.cfg" || true
  fi
  if [ -f "${TMP_CHK}/config.cfg" ]; then
    grep 'timeout' "${TMP_CHK}/config.cfg" || true
  fi
  rm -rf "${TMP_CHK}"
fi

echo "==> SUCCESS! Bootable ISO generated at: ${OUTPUT_ISO}"
