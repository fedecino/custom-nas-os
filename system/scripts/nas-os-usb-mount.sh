#!/bin/bash
set -euo pipefail

ACTION="${1:-}"
DEVNAME_SHORT="${2:-}"
FLAG_FILE="/DATA/.nas-os/usb-automount.enabled"
MOUNT_DIR="/DATA/Disks/usb-${DEVNAME_SHORT}"

if [ -z "$ACTION" ] || [ -z "$DEVNAME_SHORT" ]; then
  exit 0
fi

if [ "$ACTION" = "add" ]; then
  [ -f "$FLAG_FILE" ] || exit 0
  mkdir -p "$MOUNT_DIR"
  systemd-mount --no-block --automount=no "/dev/${DEVNAME_SHORT}" "$MOUNT_DIR" || true
elif [ "$ACTION" = "remove" ]; then
  if mountpoint -q "$MOUNT_DIR"; then
    umount -l "$MOUNT_DIR" || true
  fi
  rmdir "$MOUNT_DIR" 2>/dev/null || true
fi
