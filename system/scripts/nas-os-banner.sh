#!/bin/bash
set -euo pipefail

ISSUE_FILE="/etc/issue"
MOTD_FILE="/etc/motd"

HOSTNAME_VAL="$(hostname 2>/dev/null || echo 'nas-os')"
IPS="$(hostname -I 2>/dev/null | xargs || true)"

# Detect Wi-Fi interfaces
WIFI_IFACES=""
for netdev in /sys/class/net/*; do
  [ -e "$netdev" ] || continue
  if [ -d "${netdev}/wireless" ]; then
    iface="$(basename "$netdev")"
    WIFI_IFACES="${WIFI_IFACES} ${iface}"
  fi
done
WIFI_IFACES="$(echo "$WIFI_IFACES" | xargs || true)"

generate_banner() {
  echo ""
  if [ -d /run/live/medium ]; then
    echo ""
    echo "   Modalita' LIVE attiva: per installare NAS-OS su SSD:"
    echo "     Effettua il login (user: user / pass: live) e lancia:"
    echo "     -> sudo nas-os-install"
  fi
  echo "================================================================="
  echo "   Benvenuto in NAS-OS (Debian 13 Trixie) - Host: ${HOSTNAME_VAL}"
  if [ -d /run/live/medium ]; then
    echo ""
    echo "   Modalita' LIVE attiva: per installare NAS-OS su SSD:"
    echo "     Effettua il login (user: user / pass: live) e lancia:"
    echo "     -> sudo nas-os-install"
  fi
  echo "================================================================="
  if [ -n "$IPS" ]; then
    echo "   Indirizzi IP rilevati:"
    for ip in $IPS; do
      echo "     -> Web UI: http://${ip}/"
    done
  else
    echo "   Rete: Nessun indirizzo IP assegnato al momento."
  fi

  if [ -n "$WIFI_IFACES" ]; then
    echo ""
    echo "   Scheda Wi-Fi rilevata (${WIFI_IFACES})!"
    echo "   Per connetterti al Wi-Fi dal terminale:"
    echo "     1) Effettua il login e avvia:  nmtui"
    echo "        (menu guidato -> Activate a connection)"
    echo "     2) Oppure da riga di comando:"
    echo "        nmcli device wifi list"
    echo "        nmcli device wifi connect \"NOME_RETE\" password \"PASSWORD\""
  fi
  if [ -d /run/live/medium ]; then
    echo ""
    echo "   Modalita' LIVE attiva: per installare NAS-OS su SSD:"
    echo "     Effettua il login (user: user / pass: live) e lancia:"
    echo "     -> sudo nas-os-install"
  fi
  echo "================================================================="
  echo ""
}

BANNER_TEXT="$(generate_banner)"

printf "\033[H\033[2J%s\n\n" "$BANNER_TEXT" > "$ISSUE_FILE"
printf "%s\n" "$BANNER_TEXT" > "$MOTD_FILE"

# Refresh tty1 login screen if no user is logged in on tty1
if command -v who >/dev/null 2>&1 && ! who | grep -q '^.*tty1 '; then
  systemctl restart getty@tty1.service 2>/dev/null || true
fi
