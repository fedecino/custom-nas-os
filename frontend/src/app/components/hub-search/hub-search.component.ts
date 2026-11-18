import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  HubSearchResult,
  HubTagResult,
  InspectedImage,
  StackInfo,
} from '../../services/api.service';

@Component({
  selector: 'app-hub-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <!-- Header & Search Bar -->
      <div class="rounded-2xl border border-nas-border bg-nas-card/90 p-6 shadow-lg">
        <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight text-white">
              Docker App Store
            </h1>
            <p class="mt-1 text-sm text-slate-400">
              Cerca qualsiasi immagine su Docker Hub, ispeziona porte/volumi da remoto e genera il docker-compose.yml.
            </p>
          </div>
        </div>

        <form (ngSubmit)="search()" class="mt-5 flex gap-3">
          <div class="relative flex-1">
            <input
              type="text"
              [(ngModel)]="query"
              name="query"
              placeholder="Cerca su Docker Hub (es. jellyfin, nginx, pihole, nextcloud, vaultwarden...)"
              class="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
            />
          </div>
          <button
            type="submit"
            [disabled]="searching() || !query.trim()"
            class="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
          >
            @if (searching()) {
              <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent"></span>
              <span>Ricerca...</span>
            } @else {
              <span>Cerca</span>
            }
          </button>
        </form>

        <!-- Quick Picks -->
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <span class="text-xs text-slate-500">Suggeriti NAS:</span>
          @for (item of quickPicks; track item) {
            <button
              type="button"
              (click)="quickSearch(item)"
              class="rounded-full border border-slate-700/80 bg-slate-900/70 px-3 py-1 text-xs text-slate-300 transition hover:border-sky-500/60 hover:text-sky-300"
            >
              {{ item }}
            </button>
          }
        </div>
      </div>

      @if (error()) {
        <div
          class="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {{ error() }}
        </div>
      }

      <!-- Search Results -->
      @if (results().length > 0) {
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          @for (repo of results(); track repo.name) {
            <div
              class="flex flex-col justify-between rounded-2xl border border-nas-border bg-nas-card/90 p-5 shadow transition hover:border-sky-500/50"
            >
              <div>
                <div class="flex items-start justify-between gap-2">
                  <h3 class="break-all font-semibold text-white">
                    {{ repo.name }}
                  </h3>
                  <div class="flex shrink-0 items-center gap-1.5">
                    @if (findInstalledStack(repo.name)) {
                      <span
                        class="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-300"
                      >
                        Installata
                      </span>
                    }
                    @if (repo.isOfficial) {
                      <span
                        class="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300"
                      >
                        Official
                      </span>
                    }
                  </div>
                </div>
                <p class="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-400">
                  {{ repo.description || 'Nessuna descrizione disponibile su Docker Hub.' }}
                </p>
              </div>

              <div class="mt-4 pt-4 border-t border-slate-800/80">
                <div class="flex items-center justify-between text-xs text-slate-400">
                  <span>★ {{ formatNumber(repo.starCount) }}</span>
                  <span>↓ {{ formatNumber(repo.pullCount) }} pulls</span>
                </div>
                @if (findInstalledStack(repo.name); as existing) {
                  <button
                    type="button"
                    (click)="openExisting.emit(existing.name)"
                    class="mt-3 w-full rounded-xl border border-emerald-500/40 bg-emerald-500/15 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500 hover:text-slate-950"
                  >
                    Gestisci Container ({{ existing.name }})
                  </button>
                } @else {
                  <button
                    type="button"
                    (click)="selectRepo(repo)"
                    class="mt-3 w-full rounded-xl border border-sky-500/40 bg-sky-500/15 py-2 text-xs font-semibold text-sky-300 transition hover:bg-sky-500 hover:text-slate-950"
                  >
                    Seleziona Tag & Configura
                  </button>
                }
              </div>
            </div>
          }
        </div>
      } @else if (hasSearched() && !searching()) {
        <div
          class="rounded-2xl border border-dashed border-slate-700 py-14 text-center text-sm text-slate-400"
        >
          Nessuna immagine trovata per "{{ lastQuery() }}".
        </div>
      }

      <!-- Tag Selection Modal -->
      @if (selectedRepo(); as repo) {
        <div
          class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <div
            class="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-nas-border bg-nas-panel shadow-2xl"
          >
            <div class="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <h2 class="text-lg font-semibold text-white">{{ repo.name }}</h2>
                <p class="text-xs text-slate-400">
                  Seleziona il tag da ispezionare tramite Registry API v2
                </p>
              </div>
              <button
                (click)="closeTagModal()"
                class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div class="flex-1 overflow-y-auto p-6">
              @if (loadingTags()) {
                <div class="flex items-center justify-center py-10 text-sm text-slate-400">
                  <span class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"></span>
                  Caricamento tag da Docker Hub...
                </div>
              } @else if (tagError()) {
                <div class="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                  {{ tagError() }}
                </div>
              } @else {
                <div class="space-y-2">
                  @for (tag of tags(); track tag.name) {
                    <label
                      class="flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 transition"
                      [ngClass]="
                        selectedTag() === tag.name
                          ? 'border-sky-500 bg-sky-500/10'
                          : 'border-slate-800 bg-slate-900/60'
                      "
                    >
                      <div class="flex items-center gap-3">
                        <input
                          type="radio"
                          name="selectedTag"
                          [value]="tag.name"
                          [(ngModel)]="selectedTagModel"
                          (ngModelChange)="selectedTag.set($event)"
                          class="accent-sky-400"
                        />
                        <div>
                          <div class="font-mono text-sm font-medium text-white">
                            {{ tag.name }}
                          </div>
                          @if (tag.architectures.length > 0) {
                            <div class="text-[11px] text-slate-400">
                              {{ tag.architectures.slice(0, 4).join(', ') }}
                            </div>
                          }
                        </div>
                      </div>
                      @if (tag.fullSize) {
                        <span class="font-mono text-xs text-slate-400">
                          {{ formatSize(tag.fullSize) }}
                        </span>
                      }
                    </label>
                  }
                </div>
              }
            </div>

            <div class="flex items-center justify-end gap-3 border-t border-slate-800 px-6 py-4">
              <button
                type="button"
                (click)="closeTagModal()"
                class="rounded-xl border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                Annulla
              </button>
              <button
                type="button"
                (click)="inspectSelected()"
                [disabled]="inspecting() || loadingTags() || !selectedTag()"
                class="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
              >
                @if (inspecting()) {
                  <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-950 border-t-transparent"></span>
                  <span>Ispezione Manifest...</span>
                } @else {
                  <span>Ispeziona & Genera YAML</span>
                }
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class HubSearchComponent {
  private readonly api = inject(ApiService);

  @Input() installedStacks: StackInfo[] = [];
  @Output() inspected = new EventEmitter<InspectedImage>();
  @Output() openExisting = new EventEmitter<string>();

  query = '';
  quickPicks = [
    'nginx',
    'jellyfin/jellyfin',
    'portainer/portainer-ce',
    'pihole/pihole',
    'redis',
    'linuxserver/qbittorrent',
    'vaultwarden/server',
  ];

  searching = signal(false);
  hasSearched = signal(false);
  lastQuery = signal('');
  results = signal<HubSearchResult[]>([]);
  error = signal<string | null>(null);

  selectedRepo = signal<HubSearchResult | null>(null);
  tags = signal<HubTagResult[]>([]);
  selectedTag = signal('latest');
  selectedTagModel = 'latest';
  loadingTags = signal(false);
  tagError = signal<string | null>(null);
  inspecting = signal(false);

  quickSearch(term: string): void {
    this.query = term;
    this.search();
  }

  search(): void {
    const q = this.query.trim();
    if (!q) return;

    this.searching.set(true);
    this.error.set(null);
    this.lastQuery.set(q);

    this.api.searchHub(q).subscribe({
      next: (res) => {
        this.results.set(res.results);
        this.hasSearched.set(true);
        this.searching.set(false);
      },
      error: (err) => {
        const detail =
          err?.error?.error ||
          (err?.status ? `HTTP ${err.status} (${err.statusText || 'Errore'})` : null) ||
          err?.message;
        this.error.set(
          detail
            ? `Errore durante la ricerca su Docker Hub: ${detail}`
            : 'Errore durante la ricerca su Docker Hub'
        );
        this.searching.set(false);
      },
    });
  }

  findInstalledStack(repoName: string): StackInfo | null {
    const normalize = (img: string) =>
      img
        .trim()
        .toLowerCase()
        .replace(/^docker\.io\//, '')
        .replace(/^library\//, '')
        .split(':')[0];

    const target = normalize(repoName);
    for (const stack of this.installedStacks) {
      if (
        stack.containers.some((c) => normalize(c.image) === target) ||
        stack.name.toLowerCase() === target.split('/').pop()
      ) {
        return stack;
      }
    }
    return null;
  }

  selectRepo(repo: HubSearchResult): void {
    const existing = this.findInstalledStack(repo.name);
    if (existing) {
      this.openExisting.emit(existing.name);
      return;
    }
    this.selectedRepo.set(repo);
    this.tags.set([]);
    this.tagError.set(null);
    this.loadingTags.set(true);

    this.api.getHubTags(repo.name).subscribe({
      next: (res) => {
        this.tags.set(res.tags);
        const defaultTag =
          res.tags.find((t) => t.name === 'latest')?.name ?? res.tags[0]?.name ?? 'latest';
        this.selectedTag.set(defaultTag);
        this.selectedTagModel = defaultTag;
        this.loadingTags.set(false);
      },
      error: (err) => {
        this.tagError.set(err?.error?.error ?? 'Impossibile recuperare i tag');
        this.loadingTags.set(false);
      },
    });
  }

  closeTagModal(): void {
    this.selectedRepo.set(null);
    this.inspecting.set(false);
  }

  inspectSelected(): void {
    const repo = this.selectedRepo();
    const tag = this.selectedTag();
    if (!repo || !tag) return;

    this.inspecting.set(true);
    this.tagError.set(null);

    this.api.inspectHubImage(repo.name, tag).subscribe({
      next: (data) => {
        this.inspecting.set(false);
        this.selectedRepo.set(null);
        this.inspected.emit(data);
      },
      error: (err) => {
        this.inspecting.set(false);
        this.tagError.set(
          err?.error?.error ?? 'Ispezione del manifest fallita. Prova un altro tag.'
        );
      },
    });
  }

  formatNumber(num: number): string {
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return String(num);
  }

  formatSize(bytes: number): string {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(1)} MB`;
  }
}
