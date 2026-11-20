#!/bin/bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Esegui questo comando come root: sudo nas-os-install"
  exit 1
fi

NONINTERACTIVE="${SILO_NONINTERACTIVE:-0}"

if [ "$NONINTERACTIVE" = "1" ]; then
  TARGET_DISK="${SILO_TARGET_DISK:-}"
  NEW_USER="${SILO_NEW_USER:-nas}"
  NEW_HOSTNAME="${SILO_HOSTNAME:-siloos}"
  # Read password securely from stdin (never passed via CLI args)
  IFS= read -r NEW_PASS || true
else
  echo "==========================================================="
  echo "   SiloOs Direct Disk Installer (Debian 13 Trixie)"
  echo "   Dual-Boot: BIOS Legacy + UEFI"
  echo "==========================================================="
  echo ""
  echo "Dischi disponibili:"
  lsblk -d -o NAME,SIZE,MODEL,TRAN | grep -v '^loop'
  echo ""
  read -rp "Inserisci il disco di destinazione (es. /dev/sda o /dev/nvme0n1): " TARGET_DISK

  if [ ! -b "$TARGET_DISK" ]; then
    echo "ERRORE: '$TARGET_DISK' non e' un dispositivo a blocchi valido."
    exit 1
  fi

  echo ""
  echo "ATTENZIONE: TUTTI I DATI SU $TARGET_DISK VERRANNO CANCELLATI!"
  read -rp "Scrivi 'SI' per confermare: " CONFIRM
  if [ "$CONFIRM" != "SI" ]; then
    echo "Installazione annullata."
    exit 0
  fi

  read -rp "Hostname del NAS (default: siloos): " NEW_HOSTNAME
  NEW_HOSTNAME="${NEW_HOSTNAME:-siloos}"
  read -rp "Nome nuovo utente amministratore (default: nas): " NEW_USER
  NEW_USER="${NEW_USER:-nas}"
  read -rsp "Password per '$NEW_USER': " NEW_PASS
  echo ""
fi

if [ -z "$TARGET_DISK" ] || [ ! -b "$TARGET_DISK" ]; then
  echo "ERRORE: '$TARGET_DISK' non e' un dispositivo a blocchi valido."
  exit 1
fi

if ! [[ "$NEW_USER" =~ ^[a-z_][a-z0-9_-]{1,30}$ ]]; then
  echo "ERRORE: Nome utente '$NEW_USER' non valido."
  exit 1
fi

if ! [[ "$NEW_HOSTNAME" =~ ^[a-zA-Z0-9-]{1,63}$ ]]; then
  echo "ERRORE: Hostname '$NEW_HOSTNAME' non valido."
  exit 1
fi

if [ -z "$NEW_PASS" ] || [ "${#NEW_PASS}" -lt 6 ]; then
  echo "ERRORE: Password non valida (minimo 6 caratteri)."
  exit 1
fi

# Prevent overwriting the active Live USB stick
LIVE_SRC="$(findmnt -n -o SOURCE /run/live/medium 2>/dev/null || findmnt -n -o SOURCE /lib/live/mount/medium 2>/dev/null || true)"
if [ -n "$LIVE_SRC" ] && [ -b "$LIVE_SRC" ]; then
  LIVE_PARENT="$(lsblk -no PKNAME "$LIVE_SRC" 2>/dev/null | head -n 1 || true)"
  if [ -n "$LIVE_PARENT" ] && [ "/dev/${LIVE_PARENT}" = "$TARGET_DISK" ]; then
    echo "ERRORE: Impossibile installare sulla chiavetta USB Live attualmente in uso ($TARGET_DISK)."
    exit 1
  fi
fi

# Unmount any currently mounted partitions on target disk
for mp in $(lsblk -ln -o MOUNTPOINT "$TARGET_DISK" 2>/dev/null | grep -v '^$' | sort -r); do
  umount -l "$mp" 2>/dev/null || true
done

# Determine partition suffix (nvme0n1p1 vs sda1)
if [[ "$TARGET_DISK" =~ [0-9]$ ]]; then
  PART_BIOS="${TARGET_DISK}p1"
  PART_EFI="${TARGET_DISK}p2"
  PART_ROOT="${TARGET_DISK}p3"
else
  PART_BIOS="${TARGET_DISK}1"
  PART_EFI="${TARGET_DISK}2"
  PART_ROOT="${TARGET_DISK}3"
fi

echo "[STEP 1/5] Partizionamento GPT Dual-Boot (BIOS + UEFI) su $TARGET_DISK..."
wipefs -a "$TARGET_DISK" >/dev/null 2>&1 || true
parted -s "$TARGET_DISK" mklabel gpt
# Partition 1: 2MiB BIOS Boot Partition (required by GRUB i386-pc on GPT disks)
parted -s "$TARGET_DISK" mkpart BIOSBOOT 1MiB 3MiB
parted -s "$TARGET_DISK" set 1 bios_grub on
# Partition 2: 512MiB EFI System Partition (required by UEFI)
parted -s "$TARGET_DISK" mkpart ESP fat32 3MiB 515MiB
parted -s "$TARGET_DISK" set 2 esp on
# Partition 3: Root filesystem (rest of disk)
parted -s "$TARGET_DISK" mkpart primary ext4 515MiB 100%
partprobe "$TARGET_DISK" || true
udevadm settle --timeout=10 2>/dev/null || sleep 2

echo "[STEP 2/5] Formattazione partizioni (EFI FAT32 + Root ext4)..."
mkfs.vfat -F32 -n EFI "$PART_EFI"
mkfs.ext4 -F -L NASOS_ROOT "$PART_ROOT"

TARGET_MNT="/mnt/nas-install"
mkdir -p "$TARGET_MNT"
mount "$PART_ROOT" "$TARGET_MNT"
mkdir -p "$TARGET_MNT/boot/efi"
mount "$PART_EFI" "$TARGET_MNT/boot/efi"

cleanup() {
  for dir in run sys proc dev/pts dev; do
    umount "$TARGET_MNT/$dir" 2>/dev/null || true
  done
  umount "$TARGET_MNT/boot/efi" 2>/dev/null || true
  umount "$TARGET_MNT" 2>/dev/null || true
}
trap cleanup EXIT

echo "[STEP 3/5] Copia del sistema SiloOs su $TARGET_DISK (attendere qualche minuto)..."
rsync -aAX \
  --exclude='/dev/*' \
  --exclude='/proc/*' \
  --exclude='/sys/*' \
  --exclude='/tmp/*' \
  --exclude='/run/*' \
  --exclude='/mnt/*' \
  --exclude='/media/*' \
  --exclude='/lost+found' \
  --exclude='/lib/live/*' \
  / "$TARGET_MNT/"

mkdir -p "$TARGET_MNT"/{dev,proc,sys,tmp,run,mnt,media}
chmod 1777 "$TARGET_MNT/tmp"

echo "[STEP 4/5] Configurazione fstab, hostname, utente e bootloader GRUB (BIOS + UEFI)..."
UUID_ROOT="$(blkid -s UUID -o value "$PART_ROOT")"
UUID_EFI="$(blkid -s UUID -o value "$PART_EFI")"

cat > "$TARGET_MNT/etc/fstab" <<EOF
UUID=${UUID_ROOT} / ext4 errors=remount-ro 0 1
UUID=${UUID_EFI} /boot/efi vfat umask=0077 0 1
EOF

echo "$NEW_HOSTNAME" > "$TARGET_MNT/etc/hostname"
if [ -f "$TARGET_MNT/etc/hosts" ]; then
  sed -i "s/127\.0\.1\.1.*/127.0.1.1\t${NEW_HOSTNAME}/" "$TARGET_MNT/etc/hosts" || true
  if ! grep -q "127\.0\.1\.1" "$TARGET_MNT/etc/hosts"; then
    echo -e "127.0.1.1\t${NEW_HOSTNAME}" >> "$TARGET_MNT/etc/hosts"
  fi
fi

for dir in dev dev/pts proc sys run; do
  mount --bind "/$dir" "$TARGET_MNT/$dir"
done

# Create admin user safely without interpolating passwords into shell strings
if ! chroot "$TARGET_MNT" id -u "$NEW_USER" >/dev/null 2>&1; then
  chroot "$TARGET_MNT" useradd -m -s /bin/bash -G sudo "$NEW_USER"
fi
printf '%s:%s\n' "$NEW_USER" "$NEW_PASS" | chroot "$TARGET_MNT" chpasswd
printf '%s\n%s\n' "$NEW_PASS" "$NEW_PASS" | chroot "$TARGET_MNT" smbpasswd -a -s "$NEW_USER" >/dev/null 2>&1 || true
chroot "$TARGET_MNT" smbpasswd -e "$NEW_USER" >/dev/null 2>&1 || true
mkdir -p "$TARGET_MNT/DATA/Homes/$NEW_USER"

if [ -f "$TARGET_MNT/etc/default/grub" ]; then
  sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT="quiet loglevel=3"/' "$TARGET_MNT/etc/default/grub"
fi

# Install BOTH BIOS Legacy (i386-pc) and UEFI (x86_64-efi) bootloaders on GPT
echo "  -> Installazione GRUB BIOS Legacy (i386-pc) su $TARGET_DISK..."
chroot "$TARGET_MNT" grub-install --target=i386-pc --recheck "$TARGET_DISK" || \
  echo "Avviso: grub-install i386-pc non riuscito (continuo con UEFI)"

echo "  -> Installazione GRUB UEFI (x86_64-efi, fallback /EFI/BOOT/BOOTX64.EFI)..."
chroot "$TARGET_MNT" grub-install \
  --target=x86_64-efi \
  --efi-directory=/boot/efi \
  --bootloader-id=siloos \
  --removable \
  --no-nvram \
  --recheck || echo "Avviso: grub-install x86_64-efi removable non riuscito"

if [ -d /sys/firmware/efi ]; then
  echo "  -> Registrazione voce NVRAM UEFI..."
  chroot "$TARGET_MNT" grub-install \
    --target=x86_64-efi \
    --efi-directory=/boot/efi \
    --bootloader-id=siloos \
    --recheck || true
fi

chroot "$TARGET_MNT" update-grub

echo "[STEP 5/5] Sincronizzazione disco e smontaggio..."
sync
cleanup
trap - EXIT

echo ""
echo "==========================================================="
echo "   INSTALLAZIONE COMPLETATA CON SUCCESSO!"
echo "   Rimuovi la chiavetta USB e riavvia il NAS."
echo "==========================================================="
