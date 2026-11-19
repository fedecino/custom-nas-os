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
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { forkJoin } from 'rxjs';
import { ApiService, FileEntry, MountedDisk } from '../../services/api.service';
import { DialogService } from '../../services/dialog.service';

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
          @if (clipboard(); as cb) {
            <button
              type="button"
              (click)="pasteInto(currentPath())"
              [disabled]="pasting()"
              class="rounded-xl bg-[#00ff88] px-3 py-1.5 text-xs font-semibold text-[#062417] hover:brightness-110 disabled:opacity-50"
            >
              {{ pasting() ? 'Incolla...' : '📌 Incolla (' + cb.paths.length + ')' }}
            </button>
            <button
              type="button"
              (click)="clipboard.set(null)"
              title="Svuota appunti"
              class="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10"
            >
              ✕
            </button>
          }

          @if (selectedPaths().size > 1) {
            <button
              type="button"
              (click)="deleteSelected()"
              class="rounded-xl bg-rose-500/20 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/35"
            >
              🗑️ Elimina ({{ selectedPaths().size }})
            </button>
            <button
              type="button"
              (click)="clearSelection()"
              class="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
            >
              Deseleziona
            </button>
          }

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

        <!-- Files Area (Right-click, Shift+Click, Shift+Arrows, and Mouse Drag Selection) -->
        <div
          #filesArea
          tabindex="0"
          (keydown)="onFilesKeyDown($event)"
          (mousedown)="onFilesAreaMouseDown($event)"
          (contextmenu)="onEmptyContextMenu($event)"
          class="relative min-h-0 select-none overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/60 focus:border-[#38bdf8]/40 focus:outline-none md:col-span-9"
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
                  <th class="w-8 px-3 py-2.5"></th>
                  <th class="px-4 py-2.5">Nome</th>
                  <th class="px-4 py-2.5 text-right">Dimensione</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                @for (item of items(); track item.path; let idx = $index) {
                  <tr
                    [attr.data-file-row]="idx"
                    (click)="onRowClick($event, item, idx)"
                    (dblclick)="item.isDirectory ? openDir(item.path) : openFilePreview(item)"
                    (contextmenu)="onItemContextMenu($event, item, idx)"
                    class="cursor-pointer transition"
                    [ngClass]="[
                      isSelected(item.path)
                        ? 'bg-[#38bdf8]/15 hover:bg-[#38bdf8]/20'
                        : 'hover:bg-white/[0.06]',
                      isCutPath(item.path) ? 'opacity-55' : ''
                    ]"
                  >
                    <td class="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        [checked]="isSelected(item.path)"
                        (click)="onCheckboxClick($event, item, idx)"
                        class="h-3.5 w-3.5 rounded border-white/20 bg-black/40 accent-[#38bdf8]"
                      />
                    </td>
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

          @if (selectionBox(); as box) {
            <div
              class="pointer-events-none fixed z-40 rounded border border-[#38bdf8] bg-[#38bdf8]/15"
              [style.left.px]="box.left"
              [style.top.px]="box.top"
              [style.width.px]="box.width"
              [style.height.px]="box.height"
            ></div>
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
                (click)="openFilePreview(item); closeContextMenu()"
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-white hover:bg-white/10"
              >
                <span>👁️</span>
                <span>Apri / Anteprima</span>
              </button>
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
              (click)="copyToClipboard('copy', item); closeContextMenu()"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-slate-200 hover:bg-white/10"
            >
              <span>📋</span>
              <span>{{ selectedPaths().size > 1 ? 'Copia (' + selectedPaths().size + ')' : 'Copia' }}</span>
            </button>
            <button
              type="button"
              (click)="copyToClipboard('cut', item); closeContextMenu()"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-amber-300 hover:bg-white/10"
            >
              <span>✂️</span>
              <span>{{ selectedPaths().size > 1 ? 'Taglia (' + selectedPaths().size + ')' : 'Taglia' }}</span>
            </button>
            @if (item.isDirectory && clipboard()) {
              <button
                type="button"
                (click)="pasteInto(item.path); closeContextMenu()"
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[#00ff88] hover:bg-white/10"
              >
                <span>📌</span>
                <span>Incolla in "{{ item.name }}"</span>
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
            @if (selectedPaths().size > 1) {
              <button
                type="button"
                (click)="deleteSelected(); closeContextMenu()"
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-rose-300 hover:bg-rose-500/15"
              >
                <span>🗑️</span>
                <span>Elimina ({{ selectedPaths().size }})</span>
              </button>
            } @else {
              <button
                type="button"
                (click)="deleteItem(item); closeContextMenu()"
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-rose-300 hover:bg-rose-500/15"
              >
                <span>🗑️</span>
                <span>Elimina</span>
              </button>
            }
          } @else {
            @if (clipboard(); as cb) {
              <button
                type="button"
                (click)="pasteInto(currentPath()); closeContextMenu()"
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-medium text-[#00ff88] hover:bg-white/10"
              >
                <span>📌</span>
                <span>Incolla qui ({{ cb.paths.length }})</span>
              </button>
              <div class="my-1 border-t border-white/10"></div>
            }
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
                  <span class="text-[#38bdf8]">SMB:</span> \\\\{{ currentHost() }}\\{{ shareForm.name || '...' }}
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

      <!-- File Preview / Viewer Modal -->
      @if (previewState(); as pv) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-sm"
          (click)="closePreview()"
        >
          <div
            class="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0b1120] shadow-2xl"
            (click)="$event.stopPropagation()"
          >
            <div class="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900/80 px-5 py-3">
              <div class="min-w-0">
                <h3 class="truncate text-sm font-semibold text-white">{{ pv.item.name }}</h3>
                <p class="truncate font-mono text-[11px] text-slate-400">
                  {{ pv.item.path }} · {{ formatBytes(pv.item.size) }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <a
                  [href]="pv.rawUrl"
                  target="_blank"
                  class="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
                >
                  Apri in scheda ↗
                </a>
                <button
                  type="button"
                  (click)="downloadItem(pv.item)"
                  class="rounded-lg bg-[#38bdf8] px-3 py-1.5 text-xs font-semibold text-[#090e1a] hover:brightness-110"
                >
                  ⬇️ Scarica
                </button>
                <button
                  type="button"
                  (click)="closePreview()"
                  class="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-auto bg-black/40 p-4 flex items-center justify-center">
              @if (pv.kind === 'image') {
                <img
                  [src]="pv.rawUrl"
                  [alt]="pv.item.name"
                  class="max-h-full max-w-full rounded-lg object-contain shadow-xl"
                />
              } @else if (pv.kind === 'pdf') {
                <iframe
                  [src]="pv.safeUrl"
                  class="h-full w-full rounded-xl border border-white/10 bg-white"
                ></iframe>
              } @else if (pv.kind === 'video') {
                <video
                  [src]="pv.rawUrl"
                  controls
                  autoplay
                  class="max-h-full max-w-full rounded-xl shadow-xl"
                ></video>
              } @else if (pv.kind === 'audio') {
                <div class="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/80 p-6 text-center">
                  <div class="text-4xl">🎵</div>
                  <p class="mt-2 truncate text-sm font-medium text-white">{{ pv.item.name }}</p>
                  <audio [src]="pv.rawUrl" controls autoplay class="mt-4 w-full"></audio>
                </div>
              } @else if (pv.kind === 'text') {
                @if (pv.loadingText) {
                  <div class="text-xs text-slate-400">Caricamento contenuto...</div>
                } @else {
                  <pre class="h-full w-full overflow-auto rounded-xl border border-white/10 bg-slate-950/90 p-4 font-mono text-xs leading-relaxed text-slate-200">{{ pv.textContent }}</pre>
                }
              } @else {
                <div class="text-center">
                  <div class="text-4xl">📦</div>
                  <p class="mt-2 text-sm font-medium text-white">
                    Anteprima non disponibile per questo formato
                  </p>
                  <p class="mt-1 text-xs text-slate-400">
                    Puoi scaricare il file sul tuo dispositivo oppure aprirlo in una nuova scheda.
                  </p>
                  <button
                    type="button"
                    (click)="downloadItem(pv.item)"
                    class="mt-4 rounded-xl bg-[#38bdf8] px-5 py-2 text-xs font-semibold text-[#090e1a] hover:brightness-110"
                  >
                    ⬇️ Scarica {{ pv.item.name }}
                  </button>
                </div>
              }
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
  @ViewChild('filesArea') filesArea?: ElementRef<HTMLDivElement>;

  currentPath = signal('/DATA');
  private readonly dialog = inject(DialogService);
  private readonly sanitizer = inject(DomSanitizer);
  previewState = signal<{
    item: FileEntry;
    kind: 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'other';
    rawUrl: string;
    safeUrl: SafeResourceUrl;
    loadingText?: boolean;
    textContent?: string;
  } | null>(null);
  parentPath = signal<string | null>('/');
  items = signal<FileEntry[]>([]);
  mountedDisks = signal<MountedDisk[]>([]);
  isAdmin = signal(true);
  userHomePath = signal('/DATA');
  allowedRoots = signal<Array<{ label: string; path: string; mode: 'ro' | 'rw' }>>([]);
  selectedPaths = signal<Set<string>>(new Set());
  clipboard = signal<{ mode: 'copy' | 'cut'; paths: string[] } | null>(null);
  pasting = signal(false);
  anchorIndex = signal<number | null>(null);
  focusIndex = signal<number | null>(null);
  selectionBox = signal<{ left: number; top: number; width: number; height: number } | null>(null);

  private marqueeStart: { x: number; y: number } | null = null;
  private marqueeAdditive = false;
  private marqueeBaseSelection = new Set<string>();
  private suppressNextRowClick = false;

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
    if (this.previewState()) {
      this.previewState.set(null);
    }
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent): void {
    if (!this.marqueeStart) return;
    const dx = Math.abs(event.clientX - this.marqueeStart.x);
    const dy = Math.abs(event.clientY - this.marqueeStart.y);
    if (!this.selectionBox() && dx < 5 && dy < 5) return;

    const left = Math.min(this.marqueeStart.x, event.clientX);
    const top = Math.min(this.marqueeStart.y, event.clientY);
    const width = Math.abs(event.clientX - this.marqueeStart.x);
    const height = Math.abs(event.clientY - this.marqueeStart.y);
    const box = { left, top, width, height };
    this.selectionBox.set(box);
    this.suppressNextRowClick = true;

    const next = this.marqueeAdditive ? new Set(this.marqueeBaseSelection) : new Set<string>();
    const container = this.filesArea?.nativeElement;
    if (container) {
      const list = this.items();
      const rows = container.querySelectorAll<HTMLElement>('[data-file-row]');
      rows.forEach((row) => {
        const idx = Number(row.dataset['fileRow']);
        const item = list[idx];
        if (!item) return;
        const rect = row.getBoundingClientRect();
        const intersects =
          rect.left <= box.left + box.width &&
          rect.right >= box.left &&
          rect.top <= box.top + box.height &&
          rect.bottom >= box.top;
        if (intersects) {
          next.add(item.path);
        }
      });
    }
    this.selectedPaths.set(next);
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp(): void {
    if (!this.marqueeStart) return;
    this.marqueeStart = null;
    this.selectionBox.set(null);
    if (this.suppressNextRowClick) {
      setTimeout(() => {
        this.suppressNextRowClick = false;
      }, 0);
    }
  }

  isSelected(filePath: string): boolean {
    return this.selectedPaths().has(filePath);
  }

  isCutPath(filePath: string): boolean {
    const cb = this.clipboard();
    return Boolean(cb && cb.mode === 'cut' && cb.paths.includes(filePath));
  }

  copyToClipboard(mode: 'copy' | 'cut', fallbackItem?: FileEntry): void {
    const selected = Array.from(this.selectedPaths());
    const paths =
      selected.length > 0 ? selected : fallbackItem ? [fallbackItem.path] : [];
    if (paths.length === 0) return;

    this.clipboard.set({ mode, paths });
    this.feedbackOk.set(true);
    this.feedback.set(
      mode === 'cut'
        ? `${paths.length} ${paths.length === 1 ? 'elemento tagliato' : 'elementi tagliati'} negli appunti. Vai nella cartella di destinazione e clicca Incolla.`
        : `${paths.length} ${paths.length === 1 ? 'elemento copiato' : 'elementi copiati'} negli appunti. Vai nella cartella di destinazione e clicca Incolla.`
    );
  }

  pasteInto(targetDir: string): void {
    const cb = this.clipboard();
    if (!cb || cb.paths.length === 0 || this.pasting()) return;

    this.pasting.set(true);
    this.api.pasteFiles(cb.mode, cb.paths, targetDir).subscribe({
      next: (res) => {
        this.pasting.set(false);
        this.feedbackOk.set(true);
        this.feedback.set(
          cb.mode === 'cut'
            ? `Spostati ${res.count} elementi`
            : `Copiati ${res.count} elementi`
        );
        if (cb.mode === 'cut') {
          this.clipboard.set(null);
        }
        this.openDir(this.currentPath());
      },
      error: (err) => {
        this.pasting.set(false);
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore durante incolla');
      },
    });
  }

  clearSelection(): void {
    this.selectedPaths.set(new Set());
    this.anchorIndex.set(null);
    this.focusIndex.set(null);
  }

  private selectRange(fromIdx: number, toIdx: number): void {
    const list = this.items();
    const start = Math.max(0, Math.min(fromIdx, toIdx));
    const end = Math.min(list.length - 1, Math.max(fromIdx, toIdx));
    const next = new Set<string>();
    for (let i = start; i <= end; i++) {
      next.add(list[i].path);
    }
    this.selectedPaths.set(next);
  }

  onFilesAreaMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    this.filesArea?.nativeElement.focus({ preventScroll: true });
    this.marqueeStart = { x: event.clientX, y: event.clientY };
    this.marqueeAdditive = event.shiftKey || event.ctrlKey || event.metaKey;
    this.marqueeBaseSelection = new Set(this.selectedPaths());
    if (!this.marqueeAdditive && event.target === this.filesArea?.nativeElement) {
      this.clearSelection();
    }
  }

  onRowClick(event: MouseEvent, item: FileEntry, idx: number): void {
    if (this.suppressNextRowClick) return;
    this.filesArea?.nativeElement.focus({ preventScroll: true });

    if (event.shiftKey && this.anchorIndex() !== null) {
      this.selectRange(this.anchorIndex()!, idx);
      this.focusIndex.set(idx);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      const next = new Set(this.selectedPaths());
      if (next.has(item.path)) {
        next.delete(item.path);
      } else {
        next.add(item.path);
      }
      this.selectedPaths.set(next);
      this.anchorIndex.set(idx);
      this.focusIndex.set(idx);
      return;
    }

    this.selectedPaths.set(new Set([item.path]));
    this.anchorIndex.set(idx);
    this.focusIndex.set(idx);
  }

  onCheckboxClick(event: MouseEvent, item: FileEntry, idx: number): void {
    event.stopPropagation();
    if (event.shiftKey && this.anchorIndex() !== null) {
      this.selectRange(this.anchorIndex()!, idx);
      this.focusIndex.set(idx);
      return;
    }
    const next = new Set(this.selectedPaths());
    if (next.has(item.path)) {
      next.delete(item.path);
    } else {
      next.add(item.path);
    }
    this.selectedPaths.set(next);
    this.anchorIndex.set(idx);
    this.focusIndex.set(idx);
  }

  onFilesKeyDown(event: KeyboardEvent): void {
    const list = this.items();

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      if (this.selectedPaths().size > 0) {
        event.preventDefault();
        this.copyToClipboard('copy');
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
      if (this.selectedPaths().size > 0) {
        event.preventDefault();
        this.copyToClipboard('cut');
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      if (this.clipboard()) {
        event.preventDefault();
        this.pasteInto(this.currentPath());
      }
      return;
    }

    if (list.length === 0) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.selectedPaths.set(new Set(list.map((i) => i.path)));
      this.anchorIndex.set(0);
      this.focusIndex.set(list.length - 1);
      return;
    }

    if (event.key === 'Escape') {
      this.clearSelection();
      return;
    }

    if (event.key === 'Delete' && this.selectedPaths().size > 0) {
      event.preventDefault();
      this.deleteSelected();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const current = this.focusIndex();
      const nextIdx =
        event.key === 'ArrowDown'
          ? Math.min(list.length - 1, current === null ? 0 : current + 1)
          : Math.max(0, current === null ? 0 : current - 1);

      if (event.shiftKey) {
        const anchor = this.anchorIndex() ?? (current ?? nextIdx);
        if (this.anchorIndex() === null) this.anchorIndex.set(anchor);
        this.selectRange(anchor, nextIdx);
      } else {
        this.selectedPaths.set(new Set([list[nextIdx].path]));
        this.anchorIndex.set(nextIdx);
      }
      this.focusIndex.set(nextIdx);
      const row = this.filesArea?.nativeElement.querySelector<HTMLElement>(
        `[data-file-row="${nextIdx}"]`
      );
      row?.scrollIntoView({ block: 'nearest' });
    }
  }

  ngOnInit(): void {
    this.api.getFileRoots().subscribe({
      next: (ctx) => {
        this.isAdmin.set(ctx.isAdmin);
        this.userHomePath.set(ctx.homePath);
        this.allowedRoots.set(ctx.allowedRoots ?? []);
        if (ctx.isAdmin) {
          this.api.getStorageDisks().subscribe({
            next: (res) => this.mountedDisks.set(res.mounts),
            error: () => {},
          });
          this.openDir('/DATA');
        } else {
          this.openDir(ctx.homePath);
        }
      },
      error: () => {
        this.openDir('/DATA');
      },
    });
  }

    onItemContextMenu(event: MouseEvent, item: FileEntry, idx: number): void {
      event.preventDefault();
      event.stopPropagation();
      if(!this.selectedPaths().has(item.path)) {
      this.selectedPaths.set(new Set([item.path]));
      this.anchorIndex.set(idx);
      this.focusIndex.set(idx);
    }
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
    if (!this.isAdmin()) {
      return this.allowedRoots().map((r, idx) => ({
        label: idx === 0 ? `La mia Home` : `${r.label}${r.mode === 'ro' ? ' (RO)' : ''}`,
        path: r.path,
        icon: idx === 0 ? '🏠' : '🔗',
      }));
    }

    const base = [
      { label: 'La mia Home', path: this.userHomePath(), icon: '👤' },
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
        this.clearSelection();
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

  async promptCreateFolder(): Promise<void> {
    const name = await this.dialog.prompt('Inserisci il nome della nuova cartella:', {
      title: 'Nuova Cartella',
      placeholder: 'es. Documenti',
      confirmText: 'Crea Cartella',
    });
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

  async promptCreateFile(): Promise<void> {
    const name = await this.dialog.prompt('Inserisci il nome del nuovo file:', {
      title: 'Nuovo File',
      placeholder: 'es. note.txt',
      confirmText: 'Crea File',
    });
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

  async renameItem(item: FileEntry): Promise<void> {
    const newName = await this.dialog.prompt(`Nuovo nome per "${item.name}":`, {
      title: 'Rinomina',
      defaultValue: item.name,
      confirmText: 'Rinomina',
    });
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

  async deleteItem(item: FileEntry): Promise<void> {
    const kind = item.isDirectory ? 'la cartella e tutto il suo contenuto' : 'il file';
    const confirmed = await this.dialog.confirm(`Eliminare ${kind} "${item.name}"?`, {
      title: 'Conferma eliminazione',
      confirmText: 'Elimina',
      danger: true,
    });
    if (!confirmed) return;
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

  async deleteSelected(): Promise<void> {
    const paths = Array.from(this.selectedPaths());
    if (paths.length === 0) return;

    const confirmed = await this.dialog.confirm(
      `Eliminare ${paths.length} ${paths.length === 1 ? 'elemento selezionato' : 'elementi selezionati'}?`,
      {
        title: 'Elimina Selezione',
        confirmText: 'Elimina',
        danger: true,
      }
    );
    if (!confirmed) return;

    forkJoin(paths.map((p) => this.api.deleteFileOrFolder(p))).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Eliminati ${paths.length} elementi`);
        this.clearSelection();
        this.openDir(this.currentPath());
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore durante eliminazione multipla');
        this.openDir(this.currentPath());
      },
    });
  }

  downloadItem(item: FileEntry): void {
    window.open(
      `/api/files/download?path=${encodeURIComponent(item.path)}`,
      '_blank'
    );
  }

  closePreview(): void {
    this.previewState.set(null);
  }

  openFilePreview(item: FileEntry): void {
    const ext = item.name.split('.').pop()?.toLowerCase() ?? '';
    const rawUrl = `/api/files/view?path=${encodeURIComponent(item.path)}`;
    const safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(rawUrl);

    const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']);
    const videoExts = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
    const audioExts = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg']);
    const textExts = new Set([
      'txt', 'md', 'json', 'yml', 'yaml', 'xml', 'csv', 'log', 'conf', 'ini',
      'env', 'sh', 'ts', 'js', 'html', 'css', 'py', 'sql', 'toml',
    ]);

    let kind: 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'other' = 'other';
    if (imageExts.has(ext)) kind = 'image';
    else if (ext === 'pdf') kind = 'pdf';
    else if (videoExts.has(ext)) kind = 'video';
    else if (audioExts.has(ext)) kind = 'audio';
    else if (textExts.has(ext)) kind = 'text';

    if (kind === 'text') {
      this.previewState.set({
        item,
        kind,
        rawUrl,
        safeUrl,
        loadingText: true,
        textContent: '',
      });
      fetch(rawUrl)
        .then((r) => r.text())
        .then((text) => {
          this.previewState.update((cur) =>
            cur && cur.item.path === item.path
              ? { ...cur, loadingText: false, textContent: text.slice(0, 200000) }
              : cur
          );
        })
        .catch(() => {
          this.previewState.update((cur) =>
            cur && cur.item.path === item.path
              ? { ...cur, loadingText: false, textContent: 'Errore lettura file.' }
              : cur
          );
        });
      return;
    }

    this.previewState.set({ item, kind, rawUrl, safeUrl });
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
