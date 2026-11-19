import {
  Component,
  EventEmitter,
  Input,
  OnInit,
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
  StoreAppTemplate,
} from '../../services/api.service';
import { DockerIconComponent } from '../docker-icon/docker-icon.component';
import { describeDockerApp } from '../../utils/app-metadata';

type AppStoreTab = 'store' | 'compose' | 'dockerhub';

@Component({
  selector: 'app-hub-search',
  standalone: true,
  imports: [CommonModule, FormsModule, DockerIconComponent],
  template: `
    <div class="space-y-6">
      <!-- Header & Mode Tabs -->
      <div class="rounded-2xl border border-nas-border bg-nas-card/90 p-6 shadow-lg">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight text-white">
            App Store
          </h1>
          <p class="mt-1 text-sm text-slate-400">
            Installa app pronte in 1-Click, incolla un Docker Compose personalizzato oppure cerca su Docker Hub.
          </p>
        </div>

        <div class="mt-5 flex items-center gap-2 overflow-x-auto border-b border-white/10 pb-0 text-xs">
          <button
            type="button"
            (click)="activeTab.set('store')"
            class="whitespace-nowrap border-b-2 px-4 py-2.5 font-medium transition"
            [ngClass]="
              activeTab() === 'store'
                ? 'border-[#38bdf8] text-[#38bdf8] font-semibold'
                : 'border-transparent text-slate-400 hover:text-white'
            "
          >
            🛍️ App Store
          </button>
          <button
            type="button"
            (click)="activeTab.set('compose')"
            class="whitespace-nowrap border-b-2 px-4 py-2.5 font-medium transition"
            [ngClass]="
              activeTab() === 'compose'
                ? 'border-[#38bdf8] text-[#38bdf8] font-semibold'
                : 'border-transparent text-slate-400 hover:text-white'
            "
          >
            📄 Docker Compose
          </button>
          <button
            type="button"
            (click)="activeTab.set('dockerhub')"
            class="whitespace-nowrap border-b-2 px-4 py-2.5 font-medium transition"
            [ngClass]="
              activeTab() === 'dockerhub'
                ? 'border-[#38bdf8] text-[#38bdf8] font-semibold'
                : 'border-transparent text-slate-400 hover:text-white'
            "
          >
            🐳 Avanzate / Docker Hub
          </button>
        </div>

        @if (activeTab() === 'store') {
          <div class="mt-5 space-y-4">
            <div class="flex flex-wrap items-center gap-3">
              <input
                type="text"
                [(ngModel)]="storeFilter"
                placeholder="Filtra app (es. Immich, Jellyfin, Nextcloud, Vaultwarden...)"
                class="min-w-[220px] flex-1 rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
              />
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                (click)="selectedCategory.set('Tutte')"
                class="rounded-full border px-3 py-1 text-xs transition"
                [ngClass]="
                  selectedCategory() === 'Tutte'
                    ? 'border-[#38bdf8] bg-[#38bdf8]/20 text-[#38bdf8] font-semibold'
                    : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500'
                "
              >
                Tutte ({{ storeApps().length }})
              </button>
              @for (cat of storeCategories(); track cat) {
                <button
                  type="button"
                  (click)="selectedCategory.set(cat)"
                  class="rounded-full border px-3 py-1 text-xs transition"
                  [ngClass]="
                    selectedCategory() === cat
                      ? 'border-[#38bdf8] bg-[#38bdf8]/20 text-[#38bdf8] font-semibold'
                      : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500'
                  "
                >
                  {{ cat }}
                </button>
              }
            </div>
          </div>
        }

        @if (activeTab() === 'dockerhub') {
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
        }
      </div>

      <!-- TAB 1: CURATED APP STORE -->
      @if (activeTab() === 'store') {
        @if (storeInstallStatus(); as st) {
          <div
            class="rounded-2xl border p-4 text-xs"
            [ngClass]="
              st.error
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                : st.done
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-[#38bdf8]/40 bg-[#38bdf8]/10 text-slate-200'
            "
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-semibold">
                @if (!st.done && !st.error) {
                  <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#38bdf8] border-t-transparent"></span>
                }
                <span>{{ st.title }}</span>
              </div>
              @if (st.done || st.error) {
                <button
                  type="button"
                  (click)="storeInstallStatus.set(null)"
                  class="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              }
            </div>
            @if (st.logs.length > 0) {
              <pre class="mt-2 max-h-36 overflow-y-auto rounded-xl bg-black/50 p-2.5 font-mono text-[11px] text-slate-300">{{ st.logs.join('\n') }}</pre>
            }
          </div>
        }

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          @for (app of filteredStoreApps(); track app.id) {
            <div
              class="flex flex-col justify-between rounded-2xl border border-nas-border bg-nas-card/90 p-5 shadow transition hover:border-sky-500/50"
            >
              <div>
                <div class="flex items-start justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-3">
                    <app-docker-icon
                      [name]="app.id"
                      [image]="app.image"
                      size="md"
                    />
                    <div class="min-w-0">
                      <h3 class="truncate font-semibold text-white">{{ app.name }}</h3>
                      <span class="text-[11px] text-slate-400">{{ app.category }}</span>
                    </div>
                  </div>
                  <div class="flex shrink-0 flex-col items-end gap-1">
                    @if (findInstalledStack(app.id) || findInstalledStack(app.image)) {
                      <span class="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-300">
                        Installata
                      </span>
                    }
                    @if (app.multiService) {
                      <span class="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] font-medium text-purple-300">
                        Multi-Container
                      </span>
                    }
                  </div>
                </div>
                <p class="mt-3 text-xs leading-relaxed text-slate-300">
                  {{ app.description }}
                </p>
              </div>

              <div class="mt-4 border-t border-slate-800/80 pt-3.5">
                @if (app.defaultPort) {
                  <div class="mb-2.5 font-mono text-[11px] text-slate-400">
                    Porta predefinita: <span class="text-[#38bdf8]">:{{ app.defaultPort }}</span>
                  </div>
                }

                @if (findInstalledStack(app.id) || findInstalledStack(app.image); as existing) {
                  <button
                    type="button"
                    (click)="openExisting.emit(existing.name)"
                    class="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/15 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500 hover:text-slate-950"
                  >
                    Gestisci Container ({{ existing.name }})
                  </button>
                } @else {
                  <div class="flex gap-2">
                    <button
                      type="button"
                      (click)="installStoreAppOneClick(app)"
                      [disabled]="installingAppId() === app.id"
                      class="flex-1 rounded-xl bg-[#00ff88] py-2 text-xs font-semibold text-[#062417] transition hover:brightness-110 disabled:opacity-50"
                    >
                      {{ installingAppId() === app.id ? 'Installazione...' : '⚡ Installa (1-Click)' }}
                    </button>
                    <button
                      type="button"
                      (click)="customizeStoreApp(app)"
                      [disabled]="installingAppId() === app.id"
                      class="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/15 disabled:opacity-50"
                      title="Personalizza YAML prima di installare"
                    >
                      YAML
                    </button>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }

      <!-- TAB 2: CUSTOM DOCKER COMPOSE -->
      @if (activeTab() === 'compose') {
        <div class="rounded-2xl border border-nas-border bg-nas-card/90 p-5 space-y-4 shadow-lg">
          <div>
            <h3 class="text-sm font-semibold text-white">
              Crea Stack da Docker Compose Personalizzato
            </h3>
            <p class="mt-0.5 text-xs text-slate-400">
              Incolla un file <span class="font-mono text-sky-300">docker-compose.yml</span>, caricalo dal PC oppure importalo da un URL raw di GitHub.
            </p>
          </div>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label class="block text-xs font-medium text-slate-300">Nome Stack</label>
              <input
                type="text"
                [(ngModel)]="customStackName"
                placeholder="es. mio-servizio"
                class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
              />
            </div>

            <div>
              <label class="block text-xs font-medium text-slate-300">Importa da URL (opzionale)</label>
              <div class="mt-1 flex gap-2">
                <input
                  type="text"
                  [(ngModel)]="importUrl"
                  placeholder="https://raw.githubusercontent.com/.../docker-compose.yml"
                  class="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                />
                <button
                  type="button"
                  (click)="importFromUrl()"
                  [disabled]="importingUrl() || !importUrl.trim()"
                  class="shrink-0 rounded-xl border border-sky-400/40 bg-sky-500/15 px-3 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/25 disabled:opacity-50"
                >
                  {{ importingUrl() ? 'Scaricamento...' : 'Importa URL' }}
                </button>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="text-xs font-medium text-slate-300">Contenuto docker-compose.yml</label>
            <label class="cursor-pointer rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">
              📂 Carica file .yml/.yaml
              <input
                type="file"
                accept=".yml,.yaml,text/yaml"
                class="hidden"
                (change)="onComposeFileSelected($event)"
              />
            </label>
          </div>

          <textarea
            [(ngModel)]="customComposeYaml"
            rows="11"
            spellcheck="false"
            class="w-full rounded-xl border border-white/10 bg-black/50 p-3.5 font-mono text-xs leading-relaxed text-slate-200 focus:border-[#38bdf8] focus:outline-none"
          ></textarea>

          <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
            <label class="text-xs font-medium text-slate-300">File .env (opzionale)</label>
            <label class="cursor-pointer rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">
              📂 Carica file .env
              <input
                type="file"
                accept=".env,text/plain"
                class="hidden"
                (change)="onEnvFileSelected($event)"
              />
            </label>
          </div>

          <textarea
            [(ngModel)]="customEnvContent"
            rows="4"
            spellcheck="false"
            placeholder="# Opzionale: variabili .env salvate accanto a docker-compose.yml&#10;DB_PASSWORD=changeme&#10;TZ=Europe/Rome"
            class="w-full rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs leading-relaxed text-slate-200 placeholder-slate-500 focus:border-[#38bdf8] focus:outline-none"
          ></textarea>

          @if (customError()) {
            <div class="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
              {{ customError() }}
            </div>
          }

          <div class="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              (click)="openCustomInEditor()"
              [disabled]="!customComposeYaml.trim()"
              class="rounded-xl bg-[#38bdf8] px-5 py-2.5 text-xs font-semibold text-[#090e1a] hover:brightness-110 disabled:opacity-50"
            >
              Verifica & Apri nell'Editor Deploy →
            </button>
          </div>
        </div>
      }

      @if (activeTab() === 'dockerhub' && error()) {
        <div
          class="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {{ error() }}
        </div>
      }

      <!-- Search Results -->
      @if (activeTab() === 'dockerhub' && results().length > 0) {
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          @for (repo of results(); track repo.name) {
            <div
              class="flex flex-col justify-between rounded-2xl border border-nas-border bg-nas-card/90 p-5 shadow transition hover:border-sky-500/50"
            >
              <div>
                <div class="flex items-start justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-3">
                    <app-docker-icon
                      [name]="repo.name"
                      [image]="repo.name"
                      [logoUrl]="repo.iconUrl ?? ''"
                      size="md"
                    />
                    <h3 class="min-w-0 break-all font-semibold text-white">
                      {{ repo.name }}
                    </h3>
                  </div>
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
                  {{ repo.description || describeApp(repo.name) }}
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
export class HubSearchComponent implements OnInit {
  private readonly api = inject(ApiService);

  @Input() installedStacks: StackInfo[] = [];
  @Output() inspected = new EventEmitter<InspectedImage>();
  @Output() openExisting = new EventEmitter<string>();
  @Output() openCustomCompose = new EventEmitter<{
    stackName: string;
    yamlContent: string;
    envContent?: string;
    lockStackName?: boolean;
  }>();
  @Output() deployed = new EventEmitter<void>();

  activeTab = signal<AppStoreTab>('store');

  // Curated App Store state
  storeApps = signal<StoreAppTemplate[]>([]);
  storeCategories = signal<string[]>([]);
  selectedCategory = signal<string>('Tutte');
  storeFilter = '';
  installingAppId = signal<string | null>(null);
  storeInstallStatus = signal<{
    title: string;
    logs: string[];
    done: boolean;
    error: boolean;
  } | null>(null);

  // Custom Compose state
  customStackName = 'mio-stack';
  customEnvContent = '';
  importUrl = '';
  importingUrl = signal(false);
  customError = signal<string | null>(null);
  customComposeYaml = `services:
  app:
    image: nginx:alpine
    container_name: mio-servizio
    ports:
      - "8090:80"
    volumes:
      - /DATA/AppData/mio-servizio:/usr/share/nginx/html
    restart: unless-stopped
`;

  ngOnInit(): void {
    this.api.getAppStore().subscribe({
      next: (res) => {
        this.storeApps.set(res.apps);
        this.storeCategories.set(res.categories);
      },
      error: () => { },
    });
  }

  filteredStoreApps(): StoreAppTemplate[] {
    const cat = this.selectedCategory();
    const q = this.storeFilter.trim().toLowerCase();
    return this.storeApps().filter((a) => {
      if (cat !== 'Tutte' && a.category !== cat) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
      );
    });
  }

  installStoreAppOneClick(app: StoreAppTemplate): void {
    this.installingAppId.set(app.id);
    this.storeInstallStatus.set({
      title: `Preparazione e installazione di ${app.name}...`,
      logs: [],
      done: false,
      error: false,
    });

    this.api.renderStoreApp(app.id).subscribe({
      next: async (rendered) => {
        try {
          let deployFailed = false;
          await this.api.deployStackSse(app.id, rendered.composeYaml, (ev) => {
            if (ev.type === 'log' && ev.message) {
              this.storeInstallStatus.update((cur) =>
                cur ? { ...cur, logs: [...cur.logs.slice(-60), ev.message!] } : cur
              );
            } else if (ev.type === 'error') {
              deployFailed = true;
              this.storeInstallStatus.update((cur) =>
                cur
                  ? {
                    ...cur,
                    title: `✕ Errore installazione ${app.name}: ${ev.message}`,
                    error: true,
                  }
                  : cur
              );
            }
          });

          this.installingAppId.set(null);
          if (!deployFailed) {
            this.storeInstallStatus.update((cur) =>
              cur
                ? {
                  ...cur,
                  title: `✓ ${app.name} installato e avviato con successo!`,
                  done: true,
                }
                : cur
            );
            this.deployed.emit();
          }
        } catch (err) {
          this.installingAppId.set(null);
          const errMsg = err instanceof Error ? err.message : 'Errore deploy';
          this.storeInstallStatus.update((cur) =>
            cur
              ? { ...cur, title: `✕ Errore installazione ${app.name}: ${errMsg}`, error: true }
              : cur
          );
        }
      },
      error: (err) => {
        this.installingAppId.set(null);
        this.storeInstallStatus.set({
          title: `✕ ${err?.error?.error ?? 'Errore generazione template'}`,
          logs: [],
          done: false,
          error: true,
        });
      },
    });
  }

  customizeStoreApp(app: StoreAppTemplate): void {
    this.installingAppId.set(app.id);
    this.api.renderStoreApp(app.id).subscribe({
      next: (rendered) => {
        this.installingAppId.set(null);
        this.openCustomCompose.emit({
          stackName: app.id,
          yamlContent: rendered.composeYaml,
          lockStackName: false,
        });
      },
      error: (err) => {
        this.installingAppId.set(null);
        this.storeInstallStatus.set({
          title: `✕ ${err?.error?.error ?? 'Errore caricamento template'}`,
          logs: [],
          done: false,
          error: true,
        });
      },
    });
  }

  importFromUrl(): void {
    this.importingUrl.set(true);
    this.customError.set(null);
    this.api.importComposeUrl(this.importUrl).subscribe({
      next: (res) => {
        this.importingUrl.set(false);
        this.customComposeYaml = res.composeYaml;
      },
      error: (err) => {
        this.importingUrl.set(false);
        this.customError.set(err?.error?.error ?? 'Impossibile importare YAML da URL');
      },
    });
  }

  onComposeFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.customComposeYaml = reader.result;
        if (!this.customStackName.trim() || this.customStackName === 'mio-stack') {
          const base = file.name.replace(/\.(ya?ml)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-');
          if (base && base !== 'docker-compose' && base !== 'compose') {
            this.customStackName = base.toLowerCase();
          }
        }
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  onEnvFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.customEnvContent = reader.result;
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  openCustomInEditor(): void {
    const name = this.customStackName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom-stack';
    this.openCustomCompose.emit({
      stackName: name,
      yamlContent: this.customComposeYaml,
      envContent: this.customEnvContent,
      lockStackName: false,
    });
  }

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

  describeApp(name: string): string {
    return describeDockerApp(name, name, false);
  }
}
