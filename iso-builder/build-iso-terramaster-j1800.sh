#!/bin/bash
set -euo pipefail

# Native (non-Docker) SiloOs ISO builder for TerraMaster NAS with Intel Celeron J1800 (Bay Trail)
# Fixes the >5GB RAM ACPI/E820 boot hang (mem=5G) and Bay Trail C-state freezes (intel_idle.max_cstate=1),
# both in Live USB mode and permanently in /etc/default/grub after installation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export ISO_VARIANT="terramaster-j1800"
export EXTRA_KERNEL_OPTS="mem=5G intel_idle.max_cstate=1"

exec "${SCRIPT_DIR}/build-iso.sh" "$@"
