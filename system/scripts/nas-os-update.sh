#!/bin/bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Esegui come root: sudo nas-os-update <URL_REPO_GITHUB>"
  exit 1
fi

REPO_URL="${1:-${NAS_OS_REPO:-}}"
SRC_DIR="/opt/nas-os/src"
APP_DIR="/opt/nas-os"

if [ ! -d "${SRC_DIR}/.git" ]; then
  if [ -z "$REPO_URL" ]; then
    echo "Uso: sudo nas-os-update https://github.com/<utente>/<repo>.git"
    exit 1
  fi
  echo "==> [1/5] Clonazione repository in ${SRC_DIR}..."
  rm -rf "$SRC_DIR"
  git clone --depth 1 "$REPO_URL" "$SRC_DIR"
else
  echo "==> [1/5] Aggiornamento codice da GitHub (${SRC_DIR})..."
  git -C "$SRC_DIR" fetch --all --prune
  git -C "$SRC_DIR" pull --ff-only
fi

echo "==> [2/5] Compilazione Backend..."
cd "${SRC_DIR}/backend"
npm ci
npm run build

echo "==> [3/5] Compilazione Frontend..."
cd "${SRC_DIR}/frontend"
npm ci
npm run build

echo "==> [4/5] Installazione sicura in ${APP_DIR} (/DATA non viene toccata)..."
mkdir -p "${APP_DIR}/backend" "${APP_DIR}/frontend/dist"
rm -rf "${APP_DIR}/backend/dist.new" "${APP_DIR}/frontend/dist/nas-os-frontend.new"

cp -r "${SRC_DIR}/backend/dist" "${APP_DIR}/backend/dist.new"
cp "${SRC_DIR}/backend/package.json" "${APP_DIR}/backend/package.json"
cp "${SRC_DIR}/backend/package-lock.json" "${APP_DIR}/backend/package-lock.json"
[ -f "${SRC_DIR}/VERSION" ] && cp "${SRC_DIR}/VERSION" "${APP_DIR}/VERSION"
cp -r "${SRC_DIR}/frontend/dist/nas-os-frontend" "${APP_DIR}/frontend/dist/nas-os-frontend.new"

# Install production deps in backend
cd "${APP_DIR}/backend"
npm ci --omit=dev

# Atomic swap of dist folders
rm -rf "${APP_DIR}/backend/dist.bak" "${APP_DIR}/frontend/dist/nas-os-frontend.bak"
[ -d "${APP_DIR}/backend/dist" ] && mv "${APP_DIR}/backend/dist" "${APP_DIR}/backend/dist.bak"
mv "${APP_DIR}/backend/dist.new" "${APP_DIR}/backend/dist"

[ -d "${APP_DIR}/frontend/dist/nas-os-frontend" ] && mv "${APP_DIR}/frontend/dist/nas-os-frontend" "${APP_DIR}/frontend/dist/nas-os-frontend.bak"
mv "${APP_DIR}/frontend/dist/nas-os-frontend.new" "${APP_DIR}/frontend/dist/nas-os-frontend"

# Update OS configs & scripts
cp "${SRC_DIR}/system/nginx/nas-os.conf" /etc/nginx/sites-available/nas-os.conf
cp "${SRC_DIR}/system/systemd/nas-os.service" /etc/systemd/system/nas-os.service
cp "${SRC_DIR}/system/systemd/nas-os-banner.service" /etc/systemd/system/nas-os-banner.service
cp "${SRC_DIR}/system/scripts/nas-os-banner.sh" /usr/local/bin/nas-os-banner.sh
cp "${SRC_DIR}/system/scripts/nas-os-install.sh" /usr/local/sbin/nas-os-install
cp "${SRC_DIR}/system/scripts/nas-os-usb-mount.sh" /usr/local/sbin/nas-os-usb-mount
cp "${SRC_DIR}/system/scripts/nas-os-update.sh" /usr/local/sbin/nas-os-update
cp "${SRC_DIR}/system/scripts/99-nas-os-banner" /etc/NetworkManager/dispatcher.d/99-nas-os-banner
cp "${SRC_DIR}/system/udev/99-nas-os-usb-automount.rules" /etc/udev/rules.d/99-nas-os-usb-automount.rules

chmod +x /usr/local/bin/nas-os-banner.sh /usr/local/sbin/nas-os-install /usr/local/sbin/nas-os-usb-mount /usr/local/sbin/nas-os-update /etc/NetworkManager/dispatcher.d/99-nas-os-banner

echo "==> [5/5] Riavvio servizi NAS-OS..."
udevadm control --reload-rules || true
systemctl daemon-reload
systemctl reload nginx || systemctl restart nginx
systemctl restart nas-os.service

echo ""
echo "==> Aggiornamento completato! I dati in /DATA e i container Docker sono rimasti intatti."
