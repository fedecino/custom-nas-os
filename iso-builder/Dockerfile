FROM debian:trixie

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    live-build \
    debootstrap \
    curl \
    gnupg \
    ca-certificates \
    xorriso \
    squashfs-tools \
    dosfstools \
    mtools \
    isolinux \
    syslinux-common \
    grub-pc-bin \
    grub-efi-amd64-bin \
    kmod \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
ENTRYPOINT ["/workspace/iso-builder/build-iso.sh"]
