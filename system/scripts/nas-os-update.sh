#!/bin/bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Esegui come root: sudo nas-os-update <URL_REPO_GITHUB>"
  exit 1
fi

STATUS_FILE="/run/nas-os-update.status"
REPO_URL="${1:-${NAS_OS_REPO:-}}"
SRC_DIR="/opt/nas-os/src"
APP_DIR="/opt/nas-os"

set_status() {
  echo "$1" > "$STATUS_FILE" 2>/dev/null || true
}

trap 'set_status "error:Aggiornamento interrotto con errore"' ERR
set_status "running:Aggiornamento pacchetti Debian in corso..."

echo "==> [1/6] Aggiornamento pacchetti di sistema Debian..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"

set_status "running:Scaricamento codice aggiornato..."
if [ ! -d "${SRC_DIR}/.git" ]; then
  if [ -z "$REPO_URL" ]; then
    echo "Uso: sudo nas-os-update https://github.com/<utente>/<repo>.git"
    exit 1
  fi
  echo "==> [2/6] Clonazione repository in ${SRC_DIR}..."
  rm -rf "$SRC_DIR"
  git clone --depth 1 "$REPO_URL" "$SRC_DIR"
else
  echo "==> [2/6] Aggiornamento codice da GitHub (${SRC_DIR})..."
  git -C "$SRC_DIR" fetch --all --prune
  git -C "$SRC_DIR" pull --ff-only
fi

set_status "running:Compilazione Backend..."
echo "==> [3/6] Compilazione Backend..."
cd "${SRC_DIR}/backend"
npm ci
npm run build

set_status "running:Compilazione Frontend..."
echo "==> [4/6] Compilazione Frontend..."
cd "${SRC_DIR}/frontend"
npm ci
npm run build

set_status "running:Installazione nuova versione..."
echo "==> [5/6] Installazione sicura in ${APP_DIR} (/DATA non viene toccata)..."
mkdir -p "${APP_DIR}/backend" "${APP_DIR}/frontend/dist"
rm -rf "${APP_DIR}/backend/dist.new" "${APP_DIR}/frontend/dist/nas-os-frontend.new"

cp -r "${SRC_DIR}/backend/dist" "${APP_DIR}/backend/dist.new"
cp "${SRC_DIR}/backend/package.json" "${APP_DIR}/backend/package.json"
cp "${SRC_DIR}/backend/package-lock.json" "${APP_DIR}/backend/package-lock.json"
[ -f "${SRC_DIR}/VERSION" ] && cp "${SRC_DIR}/VERSION" "${APP_DIR}/VERSION"
cp -r "${SRC_DIR}/frontend/dist/nas-os-frontend" "${APP_DIR}/frontend/dist/nas-os-frontend.new"

cd "${APP_DIR}/backend"
npm ci --omit=dev

rm -rf "${APP_DIR}/backend/dist.bak" "${APP_DIR}/frontend/dist/nas-os-frontend.bak"
[ -d "${APP_DIR}/backend/dist" ] && mv "${APP_DIR}/backend/dist" "${APP_DIR}/backend/dist.bak"
mv "${APP_DIR}/backend/dist.new" "${APP_DIR}/backend/dist"

[ -d "${APP_DIR}/frontend/dist/nas-os-frontend" ] && mv "${APP_DIR}/frontend/dist/nas-os-frontend" "${APP_DIR}/frontend/dist/nas-os-frontend.bak"
mv "${APP_DIR}/frontend/dist/nas-os-frontend.new" "${APP_DIR}/frontend/dist/nas-os-frontend"

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

echo "==> [6/6] Riavvio servizi..."
set_status "running:Riavvio servizi SiloOs..."
mkdir -p /etc/nginx/conf.d/siloos-ssl /etc/nginx/conf.d/siloos-routes
udevadm control --reload-rules || true
systemctl daemon-reload
systemctl reload nginx || systemctl restart nginx
systemctl restart nas-os.service
set_status "done:Aggiornamento completato"

echo ""
echo "==> Aggiornamento completato! I dati in /DATA e i container Docker sono rimasti intatti."
