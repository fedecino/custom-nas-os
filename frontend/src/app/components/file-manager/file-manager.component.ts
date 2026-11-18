import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, FileEntry, MountedDisk } from '../../services/api.service';

interface ContextMenuState {
  x: number;
  y: number;
  item: FileEntry | null;
}

@Component({
  selector: 'app-file-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="relative flex h-full flex-col space-y-4 select-none"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <!-- Drag & Drop Overlay -->
      @if (dragActive()) {
        <div
          class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-sky-950/80 backdrop-blur-sm"
        >
          <div
            class="rounded-3xl border-2 border-dashed border-sky-400 bg-slate-900/90 px-10 py-8 text-center shadow-2xl"
          >
            <div class="text-4xl">📤</div>
            <p class="mt-3 text-base font-semibold text-white">
              Rilascia i file per caricarli sul NAS
            </p>
            <p class="mt-1 font-mono text-xs text-sky-300">
              Destinazione: {{ currentPath() }}
            </p>
          </div>
        </div>
      }

      <!-- Top Bar -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-white">Files (File Manager)</h2>
          <p class="font-mono text-xs text-sky-300">{{ currentPath() }}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          @if (parentPath(); as parent) {
            <button
              type="button"
              (click)="openDir(parent)"
              class="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
            >
              ↑ Su
            </button>
          }

          <button
            type="button"
            (click)="openDir(currentPath())"
            class="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
          >
            Aggiorna
          </button>

          <label
            class="cursor-pointer rounded-xl bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            Carica File
            <input
              #fileInput
              type="file"
              multiple
              class="hidden"
              (change)="onFileInput($event)"
            />
          </label>
        </div>
      </div>

      @if (feedback()) {
        <div
          class="rounded-xl border px-4 py-2 text-xs"
          [ngClass]="
            feedbackOk()
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          "
        >
          {{ feedback() }}
        </div>
      }

      @if (uploadStatus(); as up) {
        <div class="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs">
          <div class="flex justify-between text-sky-200">
            <span>Caricamento: {{ up.filename }}</span>
            <span>{{ up.percent }}%</span>
          </div>
          <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              class="h-full rounded-full bg-sky-400 transition-all"
              [style.width.%]="up.percent"
            ></div>
          </div>
        </div>
      }

      <!-- Main Split: Quick Roots + Files Area -->
      <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-12">
        <!-- Quick Access Sidebar -->
        <div
          class="space-y-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/25 p-3 md:col-span-3"
        >
          <div class="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Cartelle & Dischi
          </div>
          @for (root of quickRoots(); track root.path) {
            <button
              type="button"
              (click)="openDir(root.path)"
              class="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition"
              [ngClass]="
                currentPath() === root.path
                  ? 'bg-sky-500/20 text-sky-200 font-medium'
                  : 'text-slate-300 hover:bg-white/10'
              "
            >
              <span>{{ root.icon }}</span>
              <span class="truncate">{{ root.label }}</span>
            </button>
          }

          <div class="mt-4 rounded-xl border border-dashed border-white/15 p-3 text-[11px] text-slate-400">
            💡 Usa il <strong>tasto destro del mouse</strong> su file, cartelle o spazi vuoti per creare, rinominare, scaricare o eliminare. Trascina file dal PC per caricarli.
          </div>
        </div>

        <!-- Files Area (Right-click enabled on both items and empty space) -->
        <div
          (contextmenu)="onEmptyContextMenu($event)"
          class="min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/60 md:col-span-9"
        >
          @if (items().length === 0) {
            <div class="flex h-full flex-col items-center justify-center py-16 text-center text-xs text-slate-400">
              <div class="text-3xl">📂</div>
              <p class="mt-2">
                Cartella vuota. Fai click destro per creare un file/cartella o trascina qui dei file dal PC.
              </p>
            </div>
          } @else {
            <table class="w-full text-left text-xs">
              <thead class="sticky top-0 border-b border-white/10 bg-slate-950/95 text-[11px] uppercase text-slate-400">
                <tr>
                  <th class="px-4 py-2.5">Nome</th>
                  <th class="px-4 py-2.5 text-right">Dimensione</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                @for (item of items(); track item.path) {
                  <tr
                    (dblclick)="item.isDirectory ? openDir(item.path) : downloadItem(item)"
                    (contextmenu)="onItemContextMenu($event, item)"
                    class="cursor-pointer transition hover:bg-white/[0.06]"
                  >
                    <td class="px-4 py-2.5">
                      <div class="flex items-center gap-2.5">
                        <span>{{ item.isDirectory ? '📁' : '📄' }}</span>
                        <span
                          [ngClass]="
                            item.isDirectory
                              ? 'font-medium text-white'
                              : 'text-slate-200'
                          "
                        >
                          {{ item.name }}
                        </span>
                      </div>
                    </td>
                    <td class="px-4 py-2.5 text-right font-mono text-[11px] text-slate-400">
                      {{ item.isDirectory ? '—' : formatBytes(item.size) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </div>

      <!-- Context Menu (Right Click) -->
      @if (contextMenu(); as cm) {
        <div
          [style.left.px]="cm.x"
          [style.top.px]="cm.y"
          (click)="$event.stopPropagation()"
          class="fixed z-50 w-48 rounded-2xl border border-white/15 bg-slate-900/95 p-1.5 text-xs shadow-2xl backdrop-blur-xl"
        >
          @if (cm.item; as item) {
            @if (item.isDirectory) {
              <button
                type="button"
                (click)="openDir(item.path); closeContextMenu()"
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-white hover:bg-white/10"
              >
                <span>📂</span>
                <span>Apri cartella</span>
              </button>
              <button
                type="button"
                (click)="openShareModal(item); closeContextMenu()"
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[#38bdf8] hover:bg-white/10"
              >
                <span>🔗</span>
                <span>Condividi cartella...</span>
              </button>
            } @else {
              <button
                type="button"
                (click)="downloadItem(item); closeContextMenu()"
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sky-300 hover:bg-white/10"
              >
                <span>⬇️</span>
                <span>Scarica file</span>
              </button>
            }
            <button
              type="button"
              (click)="renameItem(item); closeContextMenu()"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-slate-200 hover:bg-white/10"
            >
              <span>✏️</span>
              <span>Rinomina</span>
            </button>
            <div class="my-1 border-t border-white/10"></div>
            <button
              type="button"
              (click)="deleteItem(item); closeContextMenu()"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-rose-300 hover:bg-rose-500/15"
            >
              <span>🗑️</span>
              <span>Elimina</span>
            </button>
          } @else {
            <button
              type="button"
              (click)="promptCreateFolder(); closeContextMenu()"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-white hover:bg-white/10"
            >
              <span>📁</span>
              <span>Nuova cartella</span>
            </button>
            <button
              type="button"
              (click)="promptCreateFile(); closeContextMenu()"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-white hover:bg-white/10"
            >
              <span>📄</span>
              <span>Nuovo file</span>
            </button>
            <button
              type="button"
              (click)="triggerUpload(); closeContextMenu()"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sky-300 hover:bg-white/10"
            >
              <span>📤</span>
              <span>Carica file dal PC...</span>
            </button>
            <div class="my-1 border-t border-white/10"></div>
            <button
              type="button"
              (click)="openDir(currentPath()); closeContextMenu()"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-slate-300 hover:bg-white/10"
            >
              <span>🔄</span>
              <span>Aggiorna</span>
            </button>
          }
        </div>
      }

      <!-- Share Folder Dialog -->
      @if (shareModalPath(); as targetPath) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div
            class="w-full max-w-lg rounded-3xl border border-[#1e293b] bg-[#0f172a] p-6 shadow-2xl space-y-4"
          >
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-base font-semibold text-white">
                  Condividi Cartella in Rete
                </h3>
                <p class="mt-0.5 font-mono text-[11px] text-[#38bdf8]">
                  {{ targetPath }}
                </p>
              </div>
              <button
                type="button"
                (click)="shareModalPath.set(null)"
                class="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label class="block text-xs font-medium text-slate-300">
                  Nome Condivisione
                </label>
                <input
                  type="text"
                  [(ngModel)]="shareForm.name"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-300">
                  Client NFS (es. * o 192.168.1.0/24)
                </label>
                <input
                  type="text"
                  [(ngModel)]="shareForm.nfsClients"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                />
              </div>
            </div>

            <div class="flex flex-wrap gap-4 text-xs text-slate-200">
              <label class="flex cursor-pointer items-center gap-2">
                <input type="checkbox" [(ngModel)]="shareForm.smb" class="accent-[#38bdf8]" />
                <span>SMB / Samba</span>
              </label>
              <label class="flex cursor-pointer items-center gap-2">
                <input type="checkbox" [(ngModel)]="shareForm.nfs" class="accent-[#38bdf8]" />
                <span>NFS</span>
              </label>
              <label class="flex cursor-pointer items-center gap-2">
                <input type="checkbox" [(ngModel)]="shareForm.ftp" class="accent-[#38bdf8]" />
                <span>FTP</span>
              </label>
              <label class="flex cursor-pointer items-center gap-2">
                <input type="checkbox" [(ngModel)]="shareForm.readOnly" class="accent-[#38bdf8]" />
                <span>Sola lettura</span>
              </label>
              <label class="flex cursor-pointer items-center gap-2">
                <input type="checkbox" [(ngModel)]="shareForm.guestOk" class="accent-[#38bdf8]" />
                <span>Guest OK</span>
              </label>
            </div>

            <!-- Connection Paths Preview -->
            <div class="rounded-2xl border border-white/10 bg-black/35 p-3.5 text-[11px] space-y-1.5 font-mono">
              <div class="text-[10px] font-sans font-semibold uppercase tracking-wider text-slate-400">
                Come collegarti da altri dispositivi:
              </div>
              @if (shareForm.smb) {
                <div class="text-slate-200">
                  <span class="text-[#38bdf8]">SMB:</span> \\{{ currentHost() }}\{{ shareForm.name || '...' }}
                </div>
              }
              @if (shareForm.nfs) {
                <div class="text-slate-200">
                  <span class="text-indigo-300">NFS:</span> {{ currentHost() }}:{{ targetPath }}
                </div>
              }
              <div class="text-slate-200">
                <span class="text-[#00ff88]">SFTP:</span> sftp://{{ currentHost() }}{{ targetPath }}
              </div>
              @if (shareForm.ftp) {
                <div class="text-slate-200">
                  <span class="text-amber-300">FTP:</span> ftp://{{ currentHost() }}{{ targetPath }}
                </div>
              }
            </div>

            @if (shareModalError()) {
              <div class="text-xs text-rose-300">{{ shareModalError() }}</div>
            }

            <div class="flex justify-end gap-2">
              <button
                type="button"
                (click)="shareModalPath.set(null)"
                class="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/5"
              >
                Annulla
              </button>
              <button
                type="button"
                (click)="saveFolderShare()"
                [disabled]="!shareForm.name.trim()"
                class="rounded-xl bg-[#00ff88] px-4 py-2 text-xs font-semibold text-[#090e1a] hover:brightness-110 disabled:opacity-50"
              >
                Attiva Condivisione
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class FileManagerComponent implements OnInit {
  private readonly api = inject(ApiService);

  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  currentPath = signal('/DATA');
  parentPath = signal<string | null>('/');
  items = signal<FileEntry[]>([]);
  mountedDisks = signal<MountedDisk[]>([]);

  feedback = signal<string | null>(null);
  feedbackOk = signal(true);
  dragActive = signal(false);
  uploadStatus = signal<{ filename: string; percent: number } | null>(null);
  contextMenu = signal<ContextMenuState | null>(null);
  shareModalPath = signal<string | null>(null);
  shareModalError = signal<string | null>(null);
  shareForm = {
    name: '',
    smb: true,
    nfs: false,
    ftp: false,
    readOnly: false,
    guestOk: false,
    nfsClients: '*',
  };

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  closeContextMenu(): void {
    if (this.contextMenu()) {
      this.contextMenu.set(null);
    }
  }

  ngOnInit(): void {
    this.api.getStorageDisks().subscribe({
      next: (res) => this.mountedDisks.set(res.mounts),
      error: () => {},
    });
    this.openDir('/DATA');
  }

  onItemContextMenu(event: MouseEvent, item: FileEntry): void {
    event.preventDefault();
    event.stopPropagation();
    this.openMenuAt(event.clientX, event.clientY, item);
  }

  onEmptyContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.openMenuAt(event.clientX, event.clientY, null);
  }

  private openMenuAt(clientX: number, clientY: number, item: FileEntry | null): void {
    const x = Math.min(clientX, window.innerWidth - 205);
    const y = Math.min(clientY, window.innerHeight - 190);
    this.contextMenu.set({ x, y, item });
  }

  quickRoots(): Array<{ label: string; path: string; icon: string }> {
    const base = [
      { label: '/DATA', path: '/DATA', icon: '🏠' },
      { label: 'Media', path: '/DATA/Media', icon: '🎬' },
      { label: 'Shares', path: '/DATA/Shares', icon: '📁' },
      { label: 'Disks', path: '/DATA/Disks', icon: '💾' },
      { label: 'AppData', path: '/DATA/AppData', icon: '🐳' },
      { label: 'Root (/)', path: '/', icon: '🖥️' },
    ];
    const seen = new Set(base.map((b) => b.path));
    for (const m of this.mountedDisks()) {
      if (!seen.has(m.mountpoint) && m.mountpoint !== '/boot/efi') {
        seen.add(m.mountpoint);
        base.push({ label: m.mountpoint, path: m.mountpoint, icon: '💽' });
      }
    }
    return base;
  }

  openDir(dirPath: string): void {
    this.api.listFiles(dirPath).subscribe({
      next: (res) => {
        this.feedback.set(null);
        this.currentPath.set(res.currentPath);
        this.parentPath.set(res.parentPath);
        this.items.set(res.items);
      },
      error: (err) => {
        if (dirPath !== '/') {
          this.openDir('/');
        } else {
          this.feedbackOk.set(false);
          this.feedback.set(err?.error?.error ?? 'Impossibile aprire la directory');
        }
      },
    });
  }

  promptCreateFolder(): void {
    const name = prompt('Nome nuova cartella:');
    if (!name || !name.trim()) return;
    this.api.createFileFolder(this.currentPath(), name.trim()).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Cartella "${name.trim()}" creata`);
        this.openDir(this.currentPath());
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore creazione cartella');
      },
    });
  }

  promptCreateFile(): void {
    const name = prompt('Nome nuovo file (es. note.txt):');
    if (!name || !name.trim()) return;
    this.api.createEmptyFile(this.currentPath(), name.trim()).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`File "${name.trim()}" creato`);
        this.openDir(this.currentPath());
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore creazione file');
      },
    });
  }

  triggerUpload(): void {
    this.fileInput?.nativeElement.click();
  }

  renameItem(item: FileEntry): void {
    const newName = prompt(`Nuovo nome per "${item.name}":`, item.name);
    if (!newName || !newName.trim() || newName.trim() === item.name) return;
    this.api.renameFileOrFolder(item.path, newName.trim()).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Rinominato in "${newName.trim()}"`);
        this.openDir(this.currentPath());
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore rinomina');
      },
    });
  }

  deleteItem(item: FileEntry): void {
    const kind = item.isDirectory ? 'la cartella e tutto il suo contenuto' : 'il file';
    if (!confirm(`Eliminare ${kind} "${item.name}"?`)) return;
    this.api.deleteFileOrFolder(item.path).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Eliminato "${item.name}"`);
        this.openDir(this.currentPath());
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore eliminazione');
      },
    });
  }

  downloadItem(item: FileEntry): void {
    window.open(
      `/api/files/download?path=${encodeURIComponent(item.path)}`,
      '_blank'
    );
  }

  currentHost(): string {
    return window.location.hostname || 'siloos.local';
  }

  openShareModal(item: FileEntry): void {
    const cleanName =
      item.name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^[^a-zA-Z0-9]+/, '') || 'Share';
    this.shareForm = {
      name: cleanName.slice(0, 32),
      smb: true,
      nfs: false,
      ftp: false,
      readOnly: false,
      guestOk: false,
      nfsClients: '*',
    };
    this.shareModalError.set(null);
    this.shareModalPath.set(item.path);
  }

  saveFolderShare(): void {
    const targetPath = this.shareModalPath();
    if (!targetPath) return;
    this.shareModalError.set(null);
    this.api
      .saveShare({
        name: this.shareForm.name.trim(),
        path: targetPath,
        smb: this.shareForm.smb,
        nfs: this.shareForm.nfs,
        ftp: this.shareForm.ftp,
        readOnly: this.shareForm.readOnly,
        guestOk: this.shareForm.guestOk,
        nfsClients: this.shareForm.nfsClients,
      })
      .subscribe({
        next: () => {
          const name = this.shareForm.name.trim();
          this.shareModalPath.set(null);
          this.feedbackOk.set(true);
          this.feedback.set(`Cartella "${name}" condivisa con successo!`);
        },
        error: (err) => {
          this.shareModalError.set(
            err?.error?.error ?? 'Errore durante la creazione della condivisione'
          );
        },
      });
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragActive.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget === event.target) {
      this.dragActive.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragActive.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.uploadFiles(Array.from(files));
    }
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.uploadFiles(Array.from(input.files));
      input.value = '';
    }
  }

  async uploadFiles(files: File[]): Promise<void> {
    const targetDir = this.currentPath();
    for (const file of files) {
      try {
        this.uploadStatus.set({ filename: file.name, percent: 0 });
        await this.api.uploadFileWithProgress(targetDir, file, (pct) => {
          this.uploadStatus.set({ filename: file.name, percent: pct });
        });
        this.feedbackOk.set(true);
        this.feedback.set(`Caricato "${file.name}" in ${targetDir}`);
      } catch (err) {
        this.feedbackOk.set(false);
        this.feedback.set(
          err instanceof Error ? err.message : `Errore upload "${file.name}"`
        );
      }
    }
    this.uploadStatus.set(null);
    this.openDir(targetDir);
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
  }
}
