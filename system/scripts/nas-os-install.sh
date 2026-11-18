#!/bin/bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Esegui questo comando come root: sudo nas-os-install"
  exit 1
fi

echo "==========================================================="
echo "   NAS-OS Direct SSD Installer (Debian 13 Trixie)"
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

read -rp "Nome nuovo utente amministratore (default: nas): " NEW_USER
NEW_USER="${NEW_USER:-nas}"
read -rsp "Password per '$NEW_USER': " NEW_PASS
echo ""
if [ -z "$NEW_PASS" ]; then
  echo "Password non valida."
  exit 1
fi

# Determine partition suffix (nvme0n1p1 vs sda1)
if [[ "$TARGET_DISK" =~ [0-9]$ ]]; then
  PART_EFI="${TARGET_DISK}p1"
  PART_ROOT="${TARGET_DISK}p2"
else
  PART_EFI="${TARGET_DISK}1"
  PART_ROOT="${TARGET_DISK}2"
fi

echo "==> [1/5] Partizionamento GPT su $TARGET_DISK..."
wipefs -a "$TARGET_DISK" >/dev/null 2>&1 || true
parted -s "$TARGET_DISK" mklabel gpt
parted -s "$TARGET_DISK" mkpart ESP fat32 1MiB 513MiB
parted -s "$TARGET_DISK" set 1 esp on
parted -s "$TARGET_DISK" mkpart primary ext4 513MiB 100%
partprobe "$TARGET_DISK"
sleep 2

echo "==> [2/5] Formattazione partizioni..."
mkfs.vfat -F32 -n EFI "$PART_EFI"
mkfs.ext4 -F -L NASOS_ROOT "$PART_ROOT"

TARGET_MNT="/mnt/nas-install"
mkdir -p "$TARGET_MNT"
mount "$PART_ROOT" "$TARGET_MNT"
mkdir -p "$TARGET_MNT/boot/efi"
mount "$PART_EFI" "$TARGET_MNT/boot/efi"

echo "==> [3/5] Copia del sistema su SSD (attendere qualche minuto)..."
rsync -aAX --info=progress2 \
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

echo "==> [4/5] Configurazione fstab, utente e bootloader GRUB..."
UUID_ROOT="$(blkid -s UUID -o value "$PART_ROOT")"
UUID_EFI="$(blkid -s UUID -o value "$PART_EFI")"

cat > "$TARGET_MNT/etc/fstab" <<EOF
UUID=${UUID_ROOT} / ext4 errors=remount-ro 0 1
UUID=${UUID_EFI} /boot/efi vfat umask=0077 0 1
EOF

for dir in dev dev/pts proc sys run; do
  mount --bind "/$dir" "$TARGET_MNT/$dir"
done

chroot "$TARGET_MNT" /bin/bash -c "
  set -e
  if ! id -u '${NEW_USER}' >/dev/null 2>&1; then
    useradd -m -s /bin/bash -G sudo '${NEW_USER}'
  fi
  echo '${NEW_USER}:${NEW_PASS}' | chpasswd
  if [ -f /etc/default/grub ]; then
    sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT="quiet loglevel=3"/' /etc/default/grub
  fi
  if [ -d /sys/firmware/efi ]; then
    grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=nas-os --recheck
  else
    grub-install --target=i386-pc '${TARGET_DISK}'
  fi
  update-grub
"

echo "==> [5/5] Smontaggio e completamento..."
for dir in run sys proc dev/pts dev; do
  umount "$TARGET_MNT/$dir" || true
done
umount "$TARGET_MNT/boot/efi" || true
umount "$TARGET_MNT" || true

echo ""
echo "==========================================================="
echo "   INSTALLAZIONE COMPLETATA CON SUCCESSO!"
echo "   Rimuovi la chiavetta USB ed esegui: sudo reboot"
echo "==========================================================="
