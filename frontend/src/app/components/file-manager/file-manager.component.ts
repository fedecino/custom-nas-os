import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, FileEntry, MountedDisk } from '../../services/api.service';

@Component({
  selector: 'app-file-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="relative flex h-full flex-col space-y-4"
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

      <!-- Top Action Bar -->
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

          <div class="flex gap-1.5">
            <input
              type="text"
              [(ngModel)]="newFolderName"
              placeholder="Nuova cartella..."
              class="w-36 rounded-xl border border-white/10 bg-black/35 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
            />
            <button
              type="button"
              (click)="createFolder()"
              [disabled]="!newFolderName.trim()"
              class="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-40"
            >
              + Cartella
            </button>
          </div>

          <label
            class="cursor-pointer rounded-xl bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            Carica File
            <input
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

      <!-- Main Split: Quick Roots + Files Table -->
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
            💡 Puoi trascinare file dal tuo PC direttamente dentro questa finestra per caricarli sul NAS.
          </div>
        </div>

        <!-- Files List -->
        <div
          class="min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/60 md:col-span-9"
        >
          @if (items().length === 0) {
            <div class="flex h-full flex-col items-center justify-center py-16 text-center text-xs text-slate-400">
              <div class="text-3xl">📂</div>
              <p class="mt-2">Cartella vuota. Trascina qui dei file dal PC per caricarli.</p>
            </div>
          } @else {
            <table class="w-full text-left text-xs">
              <thead class="sticky top-0 border-b border-white/10 bg-slate-950/95 text-[11px] uppercase text-slate-400">
                <tr>
                  <th class="px-4 py-2.5">Nome</th>
                  <th class="px-4 py-2.5">Dimensione</th>
                  <th class="px-4 py-2.5 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                @for (item of items(); track item.path) {
                  <tr class="hover:bg-white/[0.04]">
                    <td class="px-4 py-2.5">
                      @if (item.isDirectory) {
                        <button
                          type="button"
                          (click)="openDir(item.path)"
                          class="flex items-center gap-2.5 font-medium text-white hover:text-sky-300"
                        >
                          <span>📁</span>
                          <span>{{ item.name }}</span>
                        </button>
                      } @else {
                        <div class="flex items-center gap-2.5 text-slate-200">
                          <span>📄</span>
                          <span>{{ item.name }}</span>
                        </div>
                      }
                    </td>
                    <td class="px-4 py-2.5 font-mono text-[11px] text-slate-400">
                      {{ item.isDirectory ? '—' : formatBytes(item.size) }}
                    </td>
                    <td class="px-4 py-2.5 text-right whitespace-nowrap">
                      <div class="inline-flex gap-1.5">
                        @if (!item.isDirectory) {
                          <a
                            [href]="getDownloadUrl(item.path)"
                            class="rounded-lg bg-sky-500/15 px-2.5 py-1 text-[11px] text-sky-300 hover:bg-sky-500/25"
                          >
                            Scarica
                          </a>
                        }
                        <button
                          type="button"
                          (click)="renameItem(item)"
                          class="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/20"
                        >
                          Rinomina
                        </button>
                        <button
                          type="button"
                          (click)="deleteItem(item)"
                          class="rounded-lg bg-rose-500/15 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-rose-500/25"
                        >
                          Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </div>
    </div>
  `,
})
export class FileManagerComponent implements OnInit {
  private readonly api = inject(ApiService);

  currentPath = signal('/DATA');
  parentPath = signal<string | null>('/');
  items = signal<FileEntry[]>([]);
  mountedDisks = signal<MountedDisk[]>([]);

  feedback = signal<string | null>(null);
  feedbackOk = signal(true);
  dragActive = signal(false);
  uploadStatus = signal<{ filename: string; percent: number } | null>(null);
  newFolderName = '';

  ngOnInit(): void {
    this.api.getStorageDisks().subscribe({
      next: (res) => this.mountedDisks.set(res.mounts),
      error: () => {},
    });
    this.openDir('/DATA');
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

  createFolder(): void {
    const name = this.newFolderName.trim();
    if (!name) return;
    this.api.createFileFolder(this.currentPath(), name).subscribe({
      next: () => {
        this.newFolderName = '';
        this.feedbackOk.set(true);
        this.feedback.set(`Cartella "${name}" creata`);
        this.openDir(this.currentPath());
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore creazione cartella');
      },
    });
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

  getDownloadUrl(filePath: string): string {
    return `/api/files/download?path=${encodeURIComponent(filePath)}`;
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
