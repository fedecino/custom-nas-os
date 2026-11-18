import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  BlockDevice,
  MountedDisk,
  RaidStatusResponse,
} from '../../services/api.service';

@Component({
  selector: 'app-storage-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-white">Storage, Dischi & RAID</h2>
          <p class="text-xs text-slate-400">
            Monta dischi esistenti senza formattare, importa RAID/ZFS, configura avvio automatico (fstab) e automount USB
          </p>
        </div>
        <div class="flex items-center gap-3">
          <label
            class="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200"
          >
            <input
              type="checkbox"
              [ngModel]="usbAutomount()"
              (ngModelChange)="toggleUsbAutomount($event)"
              class="accent-sky-400"
            />
            <span>Automount USB esterni</span>
          </label>
          <button
            (click)="load()"
            class="rounded-xl border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-slate-200 hover:bg-white/10"
          >
            Aggiorna
          </button>
        </div>
      </div>

      @if (feedback()) {
        <div
          class="rounded-xl border px-4 py-2.5 text-xs"
          [ngClass]="
            feedbackOk()
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          "
        >
          {{ feedback() }}
        </div>
      }

      <!-- RAID & ZFS Import Section -->
      @if (raidStatus(); as raid) {
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-sky-300">
                RAID Software (mdadm) & ZFS Pool
              </h3>
              <p class="text-[11px] text-slate-400">
                Importa array RAID o pool ZFS esistenti senza perdere i dati
              </p>
            </div>
            <button
              (click)="importMdadm()"
              class="rounded-xl bg-sky-500/20 px-3.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/30"
            >
              Scansiona & Importa RAID (mdadm)
            </button>
          </div>

          @if (raid.zfsImportable.length > 0) {
            <div class="flex flex-wrap items-center gap-2 pt-1">
              <span class="text-xs text-slate-300">Pool ZFS rilevati:</span>
              @for (pool of raid.zfsImportable; track pool) {
                <button
                  (click)="importZfs(pool)"
                  class="rounded-lg bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/30"
                >
                  Importa Pool "{{ pool }}"
                </button>
              }
            </div>
          }

          @if (raid.zfsActive.length > 0) {
            <div class="text-xs text-emerald-300">
              Pool ZFS attivi: {{ raid.zfsActive.join(', ') }}
            </div>
          }

          @if (raid.mdadmScan) {
            <pre class="overflow-x-auto rounded-xl bg-black/40 p-2.5 font-mono text-[11px] text-slate-300">{{ raid.mdadmScan }}</pre>
          }
        </div>
      }

      <!-- Mount Config Panel (without formatting) -->
      @if (mountTarget(); as mt) {
        <div class="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3">
          <h4 class="text-sm font-semibold text-emerald-300">
            Monta {{ mt.device }} senza formattare
          </h4>
          <div class="flex flex-wrap items-center gap-3">
            <input
              type="text"
              [(ngModel)]="mountLabel"
              placeholder="Nome cartella in /DATA/Disks/"
              class="w-56 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 font-mono text-xs text-white"
            />
            <label class="flex items-center gap-2 text-xs text-slate-200">
              <input type="checkbox" [(ngModel)]="mountPersistFstab" class="accent-emerald-400" />
              <span>Monta automaticamente all'avvio (/etc/fstab)</span>
            </label>
            <button
              (click)="confirmMount()"
              class="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Monta Ora
            </button>
            <button
              (click)="mountTarget.set(null)"
              class="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
            >
              Annulla
            </button>
          </div>
        </div>
      }

      <!-- Mounted Filesystems -->
      <div class="space-y-2.5">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Volumi Montati
        </h3>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          @for (m of mounts(); track m.mountpoint) {
            <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-xs font-semibold text-sky-300">
                  {{ m.mountpoint }}
                </span>
                <div class="flex items-center gap-2">
                  <span class="rounded bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                    {{ m.fsType }}
                  </span>
                  @if (m.mountpoint.startsWith('/DATA/Disks/')) {
                    <button
                      (click)="unmount(m.mountpoint)"
                      class="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/25"
                    >
                      Smonta
                    </button>
                  }
                </div>
              </div>
              <div class="mt-1 truncate font-mono text-[11px] text-slate-500">
                {{ m.filesystem }}
              </div>
              <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  class="h-full rounded-full bg-sky-400"
                  [style.width.%]="m.usedPercent"
                ></div>
              </div>
              <div class="mt-1.5 flex justify-between text-[11px] text-slate-400">
                <span>{{ formatBytes(m.usedBytes) }} / {{ formatBytes(m.sizeBytes) }}</span>
                <span>{{ m.usedPercent }}%</span>
              </div>
            </div>
          }
        </div>
      </div>

      <!-- Physical Block Devices -->
      <div class="space-y-3">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Dischi Fisici & Partizioni (lsblk)
        </h3>
        @for (disk of blockdevices(); track disk.name) {
          <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-mono text-sm font-semibold text-white">
                    /dev/{{ disk.name }}
                  </span>
                  <span class="rounded bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                    {{ formatBytes(disk.size) }}
                  </span>
                  @if (disk.tran) {
                    <span class="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] uppercase text-sky-300">
                      {{ disk.tran }}
                    </span>
                  }
                </div>
                <p class="mt-0.5 text-xs text-slate-400">
                  {{ disk.model || 'Disco generico' }}
                  @if (disk.serial) { · S/N: {{ disk.serial }} }
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                @if (!disk.children?.length && !disk.mountpoint) {
                  @if (disk.fstype) {
                    <button
                      (click)="openMount('/dev/' + disk.name, disk.label || disk.name)"
                      class="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                    >
                      Monta (senza formattare)
                    </button>
                  }
                  <button
                    (click)="openFormat('/dev/' + disk.name)"
                    class="rounded-lg bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/25"
                  >
                    Formatta
                  </button>
                }
                <button
                  (click)="checkSmart('/dev/' + disk.name)"
                  class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
                >
                  SMART Health
                </button>
              </div>
            </div>

            @if (disk.children && disk.children.length > 0) {
              <div class="mt-3 space-y-2 border-t border-white/5 pt-3">
                @for (part of disk.children; track part.name) {
                  <div
                    class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-black/25 px-3.5 py-2.5 text-xs"
                  >
                    <div>
                      <span class="font-mono font-medium text-slate-200">
                        /dev/{{ part.name }}
                      </span>
                      <span class="ml-2 text-slate-400">
                        {{ formatBytes(part.size) }}
                      </span>
                      @if (part.fstype) {
                        <span class="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                          {{ part.fstype }}
                        </span>
                      }
                      @if (part.mountpoint) {
                        <span class="ml-2 font-mono text-[11px] text-emerald-400">
                          → {{ part.mountpoint }}
                        </span>
                      }
                    </div>

                    @if (!part.mountpoint) {
                      <div class="flex flex-wrap items-center gap-2">
                        @if (part.fstype) {
                          <button
                            (click)="openMount('/dev/' + part.name, part.label || part.name)"
                            class="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                          >
                            Monta (senza formattare)
                          </button>
                        }
                        <button
                          (click)="openFormat('/dev/' + part.name)"
                          class="rounded-lg bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/25"
                        >
                          Formatta
                        </button>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>

      <!-- Format Modal -->
      @if (formatTarget(); as dev) {
        <div class="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4 space-y-3">
          <h4 class="text-sm font-semibold text-amber-300">
            Formatta {{ dev }} (ATTENZIONE: cancella tutti i dati!)
          </h4>
          <div class="flex flex-wrap items-center gap-3">
            <select
              [(ngModel)]="formatFs"
              class="rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-white"
            >
              <option value="ext4">ext4 (Consigliato)</option>
              <option value="xfs">xfs</option>
              <option value="btrfs">btrfs</option>
            </select>
            <input
              type="text"
              [(ngModel)]="formatLabel"
              placeholder="Etichetta (es. media1)"
              class="rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-white"
            />
            <button
              (click)="confirmFormat()"
              class="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400"
            >
              Conferma Formattazione
            </button>
            <button
              (click)="formatTarget.set(null)"
              class="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
            >
              Annulla
            </button>
          </div>
        </div>
      }

      <!-- SMART Output -->
      @if (smartOutput(); as smart) {
        <div class="rounded-2xl border border-white/10 bg-black/40 p-4">
          <div class="flex items-center justify-between">
            <h4 class="text-xs font-semibold uppercase text-sky-300">
              Risultato SMART
            </h4>
            <button
              (click)="smartOutput.set(null)"
              class="text-xs text-slate-400 hover:text-white"
            >
              Chiudi
            </button>
          </div>
          <pre class="mt-2 max-h-56 overflow-auto font-mono text-[11px] text-slate-300">{{ smart | json }}</pre>
        </div>
      }
    </div>
  `,
})
export class StorageManagerComponent implements OnInit {
  private readonly api = inject(ApiService);

  blockdevices = signal<BlockDevice[]>([]);
  mounts = signal<MountedDisk[]>([]);
  raidStatus = signal<RaidStatusResponse | null>(null);
  usbAutomount = signal(false);

  feedback = signal<string | null>(null);
  feedbackOk = signal(true);
  smartOutput = signal<Record<string, unknown> | null>(null);

  mountTarget = signal<{ device: string; label: string } | null>(null);
  mountLabel = '';
  mountPersistFstab = true;

  formatTarget = signal<string | null>(null);
  formatFs = 'ext4';
  formatLabel = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.getStorageDisks().subscribe({
      next: (res) => {
        this.feedback.set(null);
        this.blockdevices.set(res.blockdevices);
        this.mounts.set(res.mounts);
      },
      error: (err) => {
        this.feedbackOk.set(false);
        const detail =
          err?.error?.error ||
          (err?.status ? `HTTP ${err.status} (${err.statusText || 'Errore'})` : null) ||
          err?.message;
        this.feedback.set(
          detail ? `Errore lettura dischi: ${detail}` : 'Errore lettura dischi'
        );
      },
    });

    this.api.getRaidStatus().subscribe({
      next: (res) => this.raidStatus.set(res),
      error: () => {},
    });

    this.api.getUsbAutomount().subscribe({
      next: (res) => this.usbAutomount.set(res.enabled),
      error: () => {},
    });
  }

  toggleUsbAutomount(enabled: boolean): void {
    this.api.setUsbAutomount(enabled).subscribe({
      next: (res) => {
        this.usbAutomount.set(res.enabled);
        this.feedbackOk.set(true);
        this.feedback.set(
          res.enabled
            ? 'Automount HDD/USB esterni abilitato (/DATA/Disks/usb-*)'
            : 'Automount HDD/USB esterni disabilitato'
        );
      },
      error: () => {},
    });
  }

  importMdadm(): void {
    this.api.importRaid('mdadm').subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set('Scansione & importazione RAID mdadm completata');
        this.load();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Nessun array RAID assemblabile trovato');
      },
    });
  }

  importZfs(poolName: string): void {
    this.api.importRaid('zfs', poolName).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Pool ZFS "${poolName}" importato!`);
        this.load();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? `Errore importazione pool ${poolName}`);
      },
    });
  }

  openMount(device: string, defaultLabel: string): void {
    this.mountLabel = defaultLabel.replace(/[^a-zA-Z0-9_-]/g, '_') || 'disk';
    this.mountPersistFstab = true;
    this.mountTarget.set({ device, label: this.mountLabel });
  }

  confirmMount(): void {
    const mt = this.mountTarget();
    if (!mt) return;
    const clean = this.mountLabel.replace(/[^a-zA-Z0-9_-]/g, '_') || 'disk';
    this.api.mountDisk(mt.device, clean, this.mountPersistFstab).subscribe({
      next: (res) => {
        this.feedbackOk.set(true);
        this.feedback.set(
          `Montato ${mt.device} in ${res.mountpoint}${
            this.mountPersistFstab ? ' (salvato in fstab)' : ''
          }`
        );
        this.mountTarget.set(null);
        this.load();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore durante il mount');
      },
    });
  }

  unmount(mountpoint: string): void {
    this.api.unmountDisk(mountpoint).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Smontato ${mountpoint}`);
        this.load();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore durante unmount');
      },
    });
  }

  checkSmart(device: string): void {
    this.api.getDiskSmart(device).subscribe({
      next: (res) => this.smartOutput.set(res),
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'SMART non disponibile');
      },
    });
  }

  openFormat(device: string): void {
    this.formatTarget.set(device);
    this.formatLabel = '';
  }

  confirmFormat(): void {
    const dev = this.formatTarget();
    if (!dev) return;
    this.api.formatDisk(dev, this.formatFs, this.formatLabel).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Partizione ${dev} formattata in ${this.formatFs}`);
        this.formatTarget.set(null);
        this.load();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Formattazione fallita');
      },
    });
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
  }
}
