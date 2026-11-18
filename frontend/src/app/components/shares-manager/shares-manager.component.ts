import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  DirectoryBrowseResponse,
  MountedDisk,
  NasShare,
  NasUser,
  ShareUserPermission,
  SharesResponse,
} from '../../services/api.service';

@Component({
  selector: 'app-shares-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <div>
        <h2 class="text-lg font-semibold text-white">
          Condivisioni & Protocolli NAS
        </h2>
        <p class="text-xs text-slate-400">
          Gestisci cartelle condivise SMB/Samba, NFS, FTP, SFTP e stato dei demoni di rete
        </p>
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

      <!-- Protocol Services Status -->
      @if (services(); as svc) {
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          @for (item of [
            { label: 'SMB / Samba', key: 'smbd', info: svc.smb },
            { label: 'NFS Server', key: 'nfs-kernel-server', info: svc.nfs },
            { label: 'FTP (vsftpd)', key: 'vsftpd', info: svc.ftp },
            { label: 'SSH / SFTP', key: 'ssh', info: svc.ssh }
          ]; track item.key) {
            <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-3.5">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-white">{{ item.label }}</span>
                <span
                  class="h-2 w-2 rounded-full"
                  [ngClass]="item.info.active ? 'bg-emerald-400' : 'bg-slate-500'"
                ></span>
              </div>
              <div class="mt-1 text-[11px] text-slate-400">
                Stato: {{ item.info.state }}
              </div>
              <div class="mt-2.5 flex gap-1.5">
                @if (!item.info.active) {
                  <button
                    (click)="toggleService(item.key, 'start')"
                    class="rounded-lg bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                  >
                    Avvia
                  </button>
                } @else {
                  <button
                    (click)="toggleService(item.key, 'restart')"
                    class="rounded-lg bg-white/10 px-2 py-1 text-[10px] text-slate-200 hover:bg-white/15"
                  >
                    Riavvia
                  </button>
                  <button
                    (click)="toggleService(item.key, 'stop')"
                    class="rounded-lg bg-rose-500/15 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-500/25"
                  >
                    Stop
                  </button>
                }
              </div>
            </div>
          }
        </div>
      }

      <!-- Create Share Form -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 space-y-4">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Nuova Condivisione
        </h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            type="text"
            [(ngModel)]="form.name"
            placeholder="Nome (es. Media)"
            class="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
          />
          <div class="flex gap-1.5">
            <input
              type="text"
              [(ngModel)]="form.path"
              placeholder="Percorso (es. /DATA/Shares/...)"
              class="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
            />
            <button
              type="button"
              (click)="openFolderBrowser()"
              class="shrink-0 rounded-xl border border-sky-400/40 bg-sky-500/15 px-3 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
            >
              Sfoglia...
            </button>
          </div>
          <input
            type="text"
            [(ngModel)]="form.nfsClients"
            placeholder="Client NFS (es. 192.168.1.0/24 o *)"
            class="rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
          />
        </div>

        <div class="flex flex-wrap items-center gap-4 text-xs text-slate-300">
          <label class="flex items-center gap-2">
            <input type="checkbox" [(ngModel)]="form.smb" class="accent-sky-400" />
            <span>SMB / Samba</span>
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" [(ngModel)]="form.nfs" class="accent-sky-400" />
            <span>NFS</span>
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" [(ngModel)]="form.ftp" class="accent-sky-400" />
            <span>FTP</span>
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" [(ngModel)]="form.readOnly" class="accent-sky-400" />
            <span>Sola lettura</span>
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" [(ngModel)]="form.guestOk" class="accent-sky-400" />
            <span>Accesso Guest</span>
          </label>
        </div>

        <button
          (click)="createShare()"
          [disabled]="!form.name.trim()"
          class="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
        >
          Crea Condivisione
        </button>
      </div>

      <!-- Existing Shares -->
      <div class="space-y-2.5">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Cartelle Condivise Attive
        </h3>
        @if (shares().length === 0) {
          <p class="text-xs text-slate-500">Nessuna condivisione configurata.</p>
        } @else {
          <div class="space-y-2">
            @for (s of shares(); track s.name) {
              <div
                class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3"
              >
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-white">{{ s.name }}</span>
                    @if (s.smb) {
                      <span class="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">SMB</span>
                    }
                    @if (s.nfs) {
                      <span class="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">NFS</span>
                    }
                    @if (s.ftp) {
                      <span class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">FTP</span>
                    }
                    @if (s.readOnly) {
                      <span class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">RO</span>
                    }
                    @if (s.guestOk) {
                      <span class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">Guest</span>
                    } @else if (s.userPermissions) {
                      <span class="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-300">
                        Permessi per utente
                      </span>
                    }
                  </div>
                  <div class="font-mono text-[11px] text-slate-400">{{ s.path }}</div>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    (click)="openPermissionsModal(s)"
                    class="rounded-lg border border-[#38bdf8]/40 bg-[#38bdf8]/15 px-3 py-1.5 text-xs font-medium text-[#38bdf8] hover:bg-[#38bdf8]/25"
                  >
                    🔐 Permessi Utenti
                  </button>
                  <button
                    type="button"
                    (click)="removeShare(s.name)"
                    class="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/25"
                  >
                    Elimina
                  </button>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Folder Picker / Esplora Risorse Modal -->
      @if (browserOpen()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div
            class="flex h-[75vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-slate-950 shadow-2xl"
          >
            <div
              class="flex items-center justify-between border-b border-white/10 px-5 py-3.5"
            >
              <div>
                <h3 class="text-sm font-semibold text-white">
                  Seleziona Cartella (Esplora Risorse)
                </h3>
                <p class="font-mono text-[11px] text-sky-300">
                  {{ browserData()?.currentPath || '/DATA' }}
                </p>
              </div>
              <button
                type="button"
                (click)="browserOpen.set(false)"
                class="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div class="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-12">
              <!-- Quick Disks / Roots Sidebar -->
              <div
                class="space-y-1.5 overflow-y-auto border-b border-white/10 bg-black/25 p-3 sm:col-span-4 sm:border-b-0 sm:border-r"
              >
                <div class="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Dischi & Percorsi Rapidi
                </div>
                @for (root of quickRoots(); track root.path) {
                  <button
                    type="button"
                    (click)="navigateTo(root.path)"
                    class="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/10"
                  >
                    <span class="truncate">💾 {{ root.label }}</span>
                  </button>
                }
              </div>

              <!-- Directory Contents -->
              <div class="flex min-h-0 flex-col sm:col-span-8">
                <div class="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
                  @if (browserData()?.parentPath; as parent) {
                    <button
                      type="button"
                      (click)="navigateTo(parent)"
                      class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10"
                    >
                      ↑ Livello superiore
                    </button>
                  }
                  <div class="ml-auto flex gap-1.5">
                    <input
                      type="text"
                      [(ngModel)]="newFolderName"
                      placeholder="Nuova cartella..."
                      class="w-36 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1 text-xs text-white focus:border-sky-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      (click)="createSubfolder()"
                      [disabled]="!newFolderName.trim()"
                      class="rounded-lg bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20 disabled:opacity-40"
                    >
                      + Crea
                    </button>
                  </div>
                </div>

                <div class="flex-1 overflow-y-auto p-3 space-y-1">
                  @if (browserError()) {
                    <div class="rounded-xl bg-rose-500/15 p-3 text-xs text-rose-200">
                      {{ browserError() }}
                    </div>
                  }
                  @if ((browserData()?.directories?.length ?? 0) === 0) {
                    <p class="py-8 text-center text-xs text-slate-500">
                      Nessuna sottocartella in questa directory.
                    </p>
                  } @else {
                    @for (dir of browserData()!.directories; track dir.path) {
                      <button
                        type="button"
                        (click)="navigateTo(dir.path)"
                        class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs text-slate-200 transition hover:bg-white/10"
                      >
                        <span>📁</span>
                        <span class="truncate font-medium">{{ dir.name }}</span>
                      </button>
                    }
                  }
                </div>
              </div>
            </div>

            <div
              class="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-3.5"
            >
              <button
                type="button"
                (click)="browserOpen.set(false)"
                class="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/10"
              >
                Annulla
              </button>
              <button
                type="button"
                (click)="selectCurrentFolder()"
                class="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                Seleziona questa cartella
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Share Per-User Permissions Modal -->
      @if (permModalShare(); as share) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          (click)="permModalShare.set(null)"
        >
          <div
            class="w-full max-w-xl rounded-2xl border border-white/15 bg-[#0f172a]/95 p-5 shadow-2xl"
            (click)="$event.stopPropagation()"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-white">
                  Permessi Condivisione "{{ share.name }}"
                </h3>
                <p class="mt-0.5 font-mono text-[11px] text-[#38bdf8]">
                  {{ share.path }}
                </p>
              </div>
              <button
                type="button"
                (click)="permModalShare.set(null)"
                class="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div class="mt-4 flex flex-wrap gap-4 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-xs text-slate-300">
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="permGuestOk" class="accent-[#38bdf8]" />
                <span>Accesso Guest (senza password)</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="permReadOnly" class="accent-[#38bdf8]" />
                <span>Sola lettura globale</span>
              </label>
            </div>

            @if (permGuestOk) {
              <div class="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                Con <strong>Accesso Guest</strong> attivo, chiunque sulla rete può accedere senza restrizioni per utente. Disattiva Guest per gestire i permessi singoli.
              </div>
            } @else {
              <div class="mt-4 space-y-2 max-h-72 overflow-y-auto pr-1">
                <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Accesso per singolo utente NAS
                </div>
                @if (users().length === 0) {
                  <p class="text-xs text-slate-400">
                    Nessun utente trovato. Crea un utente in Utenti & Permessi.
                  </p>
                } @else {
                  @for (u of users(); track u.username) {
                    <div
                      class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5"
                    >
                      <div>
                        <span class="font-mono text-xs font-semibold text-white">
                          {{ u.username }}
                        </span>
                        @if (u.groups.includes('sudo')) {
                          <span class="ml-1.5 rounded bg-[#38bdf8]/15 px-1.5 py-0.5 text-[10px] text-[#38bdf8]">
                            Admin
                          </span>
                        }
                      </div>

                      <div class="inline-flex rounded-lg border border-white/10 bg-slate-950/80 p-0.5 text-[11px]">
                        <button
                          type="button"
                          (click)="permDraft[u.username] = 'none'"
                          class="rounded-md px-2.5 py-1 transition"
                          [ngClass]="
                            permDraft[u.username] === 'none'
                              ? 'bg-rose-500 text-white font-semibold'
                              : 'text-slate-400 hover:text-white'
                          "
                        >
                          Nascosta / No
                        </button>
                        <button
                          type="button"
                          (click)="permDraft[u.username] = 'ro'"
                          class="rounded-md px-2.5 py-1 transition"
                          [ngClass]="
                            permDraft[u.username] === 'ro'
                              ? 'bg-amber-400 text-slate-950 font-semibold'
                              : 'text-slate-400 hover:text-white'
                          "
                        >
                          Solo Lettura
                        </button>
                        <button
                          type="button"
                          (click)="permDraft[u.username] = 'rw'"
                          class="rounded-md px-2.5 py-1 transition"
                          [ngClass]="
                            permDraft[u.username] === 'rw'
                              ? 'bg-[#00ff88] text-[#062417] font-semibold'
                              : 'text-slate-400 hover:text-white'
                          "
                        >
                          Lettura & Scrittura
                        </button>
                      </div>
                    </div>
                  }
                }
              </div>
            }

            <div class="mt-5 flex justify-end gap-2">
              <button
                type="button"
                (click)="permModalShare.set(null)"
                class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300 hover:bg-white/10"
              >
                Annulla
              </button>
              <button
                type="button"
                (click)="savePermissions()"
                [disabled]="savingPerms()"
                class="rounded-xl bg-[#00ff88] px-4 py-2 text-xs font-semibold text-[#062417] hover:brightness-110 disabled:opacity-50"
              >
                {{ savingPerms() ? 'Salvataggio...' : 'Salva Permessi' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class SharesManagerComponent implements OnInit {
  private readonly api = inject(ApiService);

  shares = signal<NasShare[]>([]);
  users = signal<NasUser[]>([]);
  services = signal<SharesResponse['services'] | null>(null);
  feedback = signal<string | null>(null);
  feedbackOk = signal(true);

  permModalShare = signal<NasShare | null>(null);
  permDraft: Record<string, ShareUserPermission> = {};
  permGuestOk = false;
  permReadOnly = false;
  savingPerms = signal(false);

  browserOpen = signal(false);
  browserData = signal<DirectoryBrowseResponse | null>(null);
  browserError = signal<string | null>(null);
  mountedDisks = signal<MountedDisk[]>([]);
  newFolderName = '';

  form = {
    name: '',
    path: '',
    smb: true,
    nfs: false,
    ftp: false,
    readOnly: false,
    guestOk: false,
    nfsClients: '*',
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.getShares().subscribe({
      next: (res) => {
        this.shares.set(res.shares);
        this.services.set(res.services);
      },
      error: () => {},
    });
    this.api.getUsers().subscribe({
      next: (res) => this.users.set(res.users),
      error: () => {},
    });
  }

  openPermissionsModal(share: NasShare): void {
    this.permGuestOk = share.guestOk;
    this.permReadOnly = share.readOnly;
    const draft: Record<string, ShareUserPermission> = {};
    for (const u of this.users()) {
      const existing = share.userPermissions?.[u.username];
      if (existing) {
        draft[u.username] = existing;
      } else if (share.validUsers?.length > 0) {
        draft[u.username] = share.validUsers.includes(u.username)
          ? share.readOnly
            ? 'ro'
            : 'rw'
          : 'none';
      } else {
        draft[u.username] = share.readOnly ? 'ro' : 'rw';
      }
    }
    this.permDraft = draft;
    this.permModalShare.set(share);
  }

  savePermissions(): void {
    const share = this.permModalShare();
    if (!share) return;

    this.savingPerms.set(true);
    this.api
      .updateSharePermissions(share.name, {
        userPermissions: this.permDraft,
        guestOk: this.permGuestOk,
        readOnly: this.permReadOnly,
      })
      .subscribe({
        next: (res) => {
          this.savingPerms.set(false);
          this.permModalShare.set(null);
          this.feedbackOk.set(true);
          this.feedback.set(
            res.warnings?.length
              ? `Permessi salvati (${res.warnings[0]})`
              : `Permessi aggiornati per "${share.name}"`
          );
          this.load();
        },
        error: (err) => {
          this.savingPerms.set(false);
          this.feedbackOk.set(false);
          this.feedback.set(err?.error?.error ?? 'Errore aggiornamento permessi');
        },
      });
  }

  createShare(): void {
    this.api.saveShare(this.form).subscribe({
      next: (res) => {
        this.feedbackOk.set(true);
        this.feedback.set(
          res.warnings?.length
            ? `Condivisione salvata (${res.warnings[0]})`
            : `Condivisione "${this.form.name}" creata e applicata`
        );
        this.form.name = '';
        this.form.path = '';
        this.load();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore creazione condivisione');
      },
    });
  }

  removeShare(name: string): void {
    this.api.deleteShare(name).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Condivisione "${name}" rimossa`);
        this.load();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore eliminazione');
      },
    });
  }

  toggleService(service: string, action: 'start' | 'stop' | 'restart'): void {
    this.api.controlService(service, action).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Servizio ${service}: ${action} completato`);
        this.load();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? `Errore su ${service}`);
      },
    });
  }

  openFolderBrowser(): void {
    this.browserOpen.set(true);
    this.api.getStorageDisks().subscribe({
      next: (res) => this.mountedDisks.set(res.mounts),
      error: () => {},
    });
    this.navigateTo(this.form.path.trim() || '/DATA');
  }

  quickRoots(): Array<{ label: string; path: string }> {
    const base = [
      { label: '/DATA', path: '/DATA' },
      { label: '/DATA/Disks', path: '/DATA/Disks' },
      { label: '/DATA/Media', path: '/DATA/Media' },
      { label: '/DATA/Shares', path: '/DATA/Shares' },
      { label: '/mnt', path: '/mnt' },
      { label: 'Root (/)', path: '/' },
    ];
    const seen = new Set(base.map((b) => b.path));
    for (const m of this.mountedDisks()) {
      if (!seen.has(m.mountpoint) && m.mountpoint !== '/boot/efi') {
        seen.add(m.mountpoint);
        base.push({ label: m.mountpoint, path: m.mountpoint });
      }
    }
    return base;
  }

  navigateTo(dirPath: string): void {
    this.browserError.set(null);
    this.api.browseDirectory(dirPath).subscribe({
      next: (res) => this.browserData.set(res),
      error: (err) => {
        if (dirPath !== '/') {
          this.api.browseDirectory('/').subscribe({
            next: (res) => this.browserData.set(res),
            error: () =>
              this.browserError.set(err?.error?.error ?? 'Impossibile aprire la cartella'),
          });
        } else {
          this.browserError.set(err?.error?.error ?? 'Impossibile aprire la cartella');
        }
      },
    });
  }

  createSubfolder(): void {
    const current = this.browserData()?.currentPath;
    const name = this.newFolderName.trim();
    if (!current || !name) return;
    this.api.createDirectory(current, name).subscribe({
      next: (res) => {
        this.newFolderName = '';
        this.navigateTo(res.path);
      },
      error: (err) => {
        this.browserError.set(err?.error?.error ?? 'Impossibile creare la cartella');
      },
    });
  }

  selectCurrentFolder(): void {
    const current = this.browserData()?.currentPath;
    if (current) {
      this.form.path = current;
      if (!this.form.name.trim()) {
        const parts = current.split('/').filter(Boolean);
        this.form.name = parts[parts.length - 1] || 'Share';
      }
    }
    this.browserOpen.set(false);
  }
}
