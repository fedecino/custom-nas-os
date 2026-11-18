import {
  Component,
  EventEmitter,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AiSettingsView,
  ApiService,
  LoginScreenSettings,
  NasSettingsResponse,
  SystemUpdateStatus,
  WallpaperType,
} from '../../services/api.service';

@Component({
  selector: 'app-settings-app',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <div>
        <h2 class="text-lg font-semibold text-white">
          Impostazioni Sistema & Aspetto
        </h2>
        <p class="text-xs text-slate-400">
          Personalizza il desktop del NAS, configura l'Assistente AI (Cloud o LLM locale) e controlla la rete
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

      <!-- Desktop & Hostname -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Aspetto Desktop & Sistema
        </h3>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-xs font-medium text-slate-300">
              Nome mostrato nel Desktop
            </label>
            <input
              type="text"
              [(ngModel)]="nasName"
              class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-300">
              Hostname Linux
            </label>
            <input
              type="text"
              [(ngModel)]="hostname"
              class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="block text-xs font-medium text-slate-300">
              Sfondo Desktop (Wallpaper)
            </label>
            <label
              class="cursor-pointer rounded-xl border border-sky-400/40 bg-sky-500/15 px-3 py-1 text-[11px] font-medium text-sky-300 hover:bg-sky-500/25"
            >
              Carica Immagine Personalizzata...
              <input
                type="file"
                accept="image/*"
                class="hidden"
                (change)="onWallpaperUpload($event)"
              />
            </label>
          </div>
          <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
            @for (wp of wallpapers; track wp.id) {
              <button
                type="button"
                (click)="wallpaper = wp.id"
                class="flex flex-col items-start rounded-xl border p-2.5 text-left transition"
                [ngClass]="
                  wallpaper === wp.id
                    ? 'border-sky-400 bg-sky-500/15'
                    : 'border-white/10 bg-black/25 hover:border-white/20'
                "
              >
                <div class="h-10 w-full rounded-lg" [ngClass]="wp.preview"></div>
                <span class="mt-2 text-xs font-medium text-white">{{ wp.label }}</span>
              </button>
            }
          </div>
        </div>
      </div>

      <!-- Login Screen Customization -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Schermata di Login
            </h3>
            <p class="mt-0.5 text-[11px] text-slate-400">
              Personalizza titolo, messaggio di benvenuto, elementi visibili e sfondo del login
            </p>
          </div>
          <label
            class="cursor-pointer rounded-xl border border-sky-400/40 bg-sky-500/15 px-3 py-1.5 text-[11px] font-medium text-sky-300 hover:bg-sky-500/25"
          >
            Carica Sfondo Login...
            <input
              type="file"
              accept="image/*"
              class="hidden"
              (change)="onLoginWallpaperUpload($event)"
            />
          </label>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-xs font-medium text-slate-300">
              Titolo Schermata Login
            </label>
            <input
              type="text"
              [(ngModel)]="loginScreen.title"
              class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-300">
              Sottotitolo / Messaggio
            </label>
            <input
              type="text"
              [(ngModel)]="loginScreen.subtitle"
              class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-5 text-xs text-slate-300">
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" [(ngModel)]="loginScreen.showLogo" class="accent-sky-400" />
            <span>Mostra Logo SiloOS</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" [(ngModel)]="loginScreen.showClock" class="accent-sky-400" />
            <span>Mostra Orologio & Data</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" [(ngModel)]="loginScreen.blurBackground" class="accent-sky-400" />
            <span>Sfocatura Sfondo (Blur)</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" [(ngModel)]="loginScreen.useCustomWallpaper" class="accent-sky-400" />
            <span>Usa sfondo dedicato per il Login</span>
          </label>
        </div>
      </div>

      <!-- Optional AI Agent Configuration -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wider text-sky-300">
              Assistente AI NAS (Opzionale)
            </h3>
            <p class="mt-0.5 text-[11px] text-slate-400">
              Collega un servizio Cloud (OpenAI, Gemini, OpenRouter) o un LLM locale in LAN (Ollama, LM Studio)
            </p>
          </div>
          <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-white">
            <input
              type="checkbox"
              [(ngModel)]="aiEnabled"
              class="h-4 w-4 accent-sky-400"
            />
            <span>Abilita AI Assistant</span>
          </label>
        </div>

        @if (aiEnabled) {
          <div class="space-y-4 border-t border-white/10 pt-4">
            <!-- Quick Presets -->
            <div>
              <span class="block text-[11px] text-slate-400">Preset Provider:</span>
              <div class="mt-2 flex flex-wrap gap-2">
                @for (p of providerPresets; track p.id) {
                  <button
                    type="button"
                    (click)="applyPreset(p.id)"
                    class="rounded-xl border px-3 py-1.5 text-xs transition"
                    [ngClass]="
                      aiProvider === p.id
                        ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                        : 'border-white/10 bg-black/25 text-slate-300 hover:border-white/25'
                    "
                  >
                    {{ p.label }}
                  </button>
                }
              </div>
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label class="block text-xs font-medium text-slate-300">
                  API Base URL (OpenAI-compatible)
                </label>
                <input
                  type="text"
                  [(ngModel)]="aiBaseUrl"
                  placeholder="es. http://192.168.1.50:11434/v1"
                  class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-300">
                  Nome Modello
                </label>
                <input
                  type="text"
                  [(ngModel)]="aiModel"
                  placeholder="es. llama3.2, gpt-4o-mini, gemini-2.5-flash"
                  class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <div class="flex items-center justify-between">
                <label class="block text-xs font-medium text-slate-300">
                  Chiave API (opzionale per Ollama / LLM locali)
                </label>
                @if (hasSavedApiKey()) {
                  <div class="flex items-center gap-2 text-[11px] text-emerald-300">
                    <span>Salvata: {{ apiKeyPreview() }}</span>
                    <button
                      type="button"
                      (click)="clearKey()"
                      class="text-rose-300 hover:underline"
                    >
                      Rimuovi
                    </button>
                  </div>
                }
              </div>
              <input
                type="password"
                [(ngModel)]="aiApiKeyInput"
                [placeholder]="
                  hasSavedApiKey()
                    ? 'Lascia vuoto per mantenere la chiave attuale'
                    : 'Inserisci API key (sk-... / AIza...)'
                "
                class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
              />
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <button
                type="button"
                (click)="testAi()"
                [disabled]="testingAi()"
                class="rounded-xl border border-sky-400/40 bg-sky-500/15 px-4 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/25 disabled:opacity-50"
              >
                {{ testingAi() ? 'Test in corso...' : 'Testa Connessione AI' }}
              </button>
              @if (aiTestResult()) {
                <span class="text-xs text-slate-300">{{ aiTestResult() }}</span>
              }
            </div>
          </div>
        }
      </div>

      <button
        (click)="save()"
        class="rounded-xl bg-sky-500 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
      >
        Salva Tutte le Impostazioni
      </button>

      <!-- System Updates -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              Aggiornamenti Sistema
            </h3>
            <p class="mt-0.5 text-[11px] text-slate-400">
              Verifica la presenza di nuove release e aggiorna NAS-OS senza toccare /DATA o i container
            </p>
          </div>
          <button
            type="button"
            (click)="checkUpdates()"
            [disabled]="checkingUpdates() || updatingSystem()"
            class="rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {{ checkingUpdates() ? 'Controllo...' : 'Controlla Aggiornamenti' }}
          </button>
        </div>

        @if (updateStatus(); as st) {
          <div class="rounded-xl border border-white/10 bg-black/30 p-4 text-xs space-y-2.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded bg-white/10 px-2 py-0.5 font-mono text-slate-200">
                  Installata: v{{ cleanVersion(st.installedVersion) || '1.0.0' }}
                </span>
                @if (st.updateAvailable && st.latestReleaseVersion) {
                  <span class="font-semibold text-amber-300">
                    Disponibile aggiornamento (release {{ cleanVersion(st.latestReleaseVersion) }})
                  </span>
                } @else if (st.latestReleaseVersion) {
                  <span class="font-semibold text-emerald-300">
                    ✓ Sistema aggiornato all'ultima release
                  </span>
                } @else {
                  <span class="text-slate-400">
                    Nessuna release pubblicata trovata
                  </span>
                }
              </div>

              @if (st.updateAvailable) {
                <button
                  type="button"
                  (click)="showAuthPrompt.set(true)"
                  [disabled]="updatingSystem()"
                  class="rounded-xl bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  Aggiorna Sistema
                </button>
              }
            </div>

            @if (st.latestReleaseDate || st.latestReleaseVersion) {
              <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                @if (st.latestReleaseVersion) {
                  <span class="rounded bg-sky-500/15 px-2 py-0.5 font-mono text-sky-300">
                    Release v{{ cleanVersion(st.latestReleaseVersion) }}
                  </span>
                }
                @if (st.latestReleaseDate) {
                  <span class="text-slate-400">
                    del {{ formatReleaseDate(st.latestReleaseDate) }}
                  </span>
                }
              </div>
            }

            @if (st.latestReleaseNotes) {
              <div class="max-h-36 overflow-y-auto rounded-lg bg-black/40 p-2.5 text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap">{{ formatNotes(st.latestReleaseNotes) }}</div>
            }
          </div>
        }

        @if (showAuthPrompt()) {
          <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          >
            <form
              (ngSubmit)="startUpdate()"
              class="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-900 p-6 shadow-2xl space-y-4"
            >
              <div>
                <h4 class="text-sm font-semibold text-white">
                  Conferma Aggiornamento Sistema
                </h4>
                <p class="mt-1 text-xs text-slate-400">
                  Inserisci la password amministratore per avviare l'aggiornamento.
                </p>
              </div>

              <input
                type="password"
                [(ngModel)]="authPassword"
                name="authPassword"
                autofocus
                placeholder="Password amministratore"
                class="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white focus:border-sky-400 focus:outline-none"
              />

              @if (updateError()) {
                <div class="text-xs text-rose-300">{{ updateError() }}</div>
              }

              <div class="flex justify-end gap-2">
                <button
                  type="button"
                  (click)="showAuthPrompt.set(false)"
                  [disabled]="updatingSystem()"
                  class="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/5"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  [disabled]="updatingSystem() || !authPassword"
                  class="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  Conferma e Aggiorna
                </button>
              </div>
            </form>
          </div>
        }

        @if (updatingSystem()) {
          <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          >
            <div
              class="flex w-full max-w-sm flex-col items-center rounded-3xl border border-[#1e293b] bg-[#0f172a] p-8 text-center shadow-2xl"
            >
              <div
                class="h-12 w-12 animate-spin rounded-full border-4 border-[#38bdf8] border-t-transparent"
              ></div>
              <h4 class="mt-5 text-base font-semibold text-white">
                Aggiornamento in corso...
              </h4>
              <p class="mt-2 text-xs text-slate-300">
                {{ updateStage() || 'Aggiornamento di Debian e SiloOs in corso...' }}
              </p>
              <p class="mt-3 text-[11px] text-slate-500">
                La finestra si chiuderà automaticamente al termine dell'operazione.
              </p>
            </div>
          </div>
        }
      </div>

      <!-- Network Interfaces -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-3">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Interfacce di Rete
        </h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          @for (iface of network(); track iface.name) {
            <div class="rounded-xl border border-white/10 bg-black/25 p-3">
              <div class="font-mono text-xs font-semibold text-sky-300">
                {{ iface.name }}
              </div>
              @for (addr of iface.addresses; track addr.address) {
                <div class="mt-1 font-mono text-[11px] text-slate-300">
                  {{ addr.family }}: {{ addr.address }}
                </div>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class SettingsAppComponent implements OnInit {
  private readonly api = inject(ApiService);

  @Output() updated = new EventEmitter<NasSettingsResponse['settings']>();

  nasName = 'SiloOS';
  hostname = '';
  wallpaper: WallpaperType = 'silo-landscape';
  loginScreen: LoginScreenSettings = {
    title: 'SiloOS',
    subtitle: 'Accedi con le credenziali amministratore del NAS',
    showClock: true,
    showLogo: true,
    blurBackground: true,
    useCustomWallpaper: false,
  };

  checkingUpdates = signal(false);
  updatingSystem = signal(false);
  updateStage = signal('Avvio aggiornamento...');
  updateStatus = signal<SystemUpdateStatus | null>(null);
  showAuthPrompt = signal(false);
  authPassword = '';
  updateError = signal<string | null>(null);

  aiEnabled = false;
  aiProvider: AiSettingsView['providerType'] = 'ollama';
  aiBaseUrl = 'http://localhost:11434/v1';
  aiModel = 'llama3.2';
  aiApiKeyInput = '';
  hasSavedApiKey = signal(false);
  apiKeyPreview = signal('');
  clearApiKeyFlag = false;

  testingAi = signal(false);
  aiTestResult = signal<string | null>(null);
  network = signal<NasSettingsResponse['network']>([]);
  feedback = signal<string | null>(null);
  feedbackOk = signal(true);

  providerPresets: Array<{
    id: AiSettingsView['providerType'];
    label: string;
    baseUrl: string;
    model: string;
  }> = [
    {
      id: 'ollama',
      label: 'Ollama (Locale / LAN)',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
    },
    {
      id: 'lmstudio',
      label: 'LM Studio (LAN)',
      baseUrl: 'http://localhost:1234/v1',
      model: 'local-model',
    },
    {
      id: 'openai',
      label: 'OpenAI (Cloud)',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    },
    {
      id: 'gemini',
      label: 'Google Gemini (Cloud)',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
    },
    {
      id: 'custom',
      label: 'Custom OpenAI-API',
      baseUrl: '',
      model: '',
    },
  ];

  wallpapers: Array<{
    id: WallpaperType;
    label: string;
    preview: string;
  }> = [
    {
      id: 'silo-landscape',
      label: 'SiloOS Peak',
      preview: 'bg-gradient-to-br from-sky-900 via-blue-950 to-slate-950',
    },
    {
      id: 'aurora',
      label: 'Aurora',
      preview: 'bg-gradient-to-br from-slate-950 via-indigo-950 to-sky-900',
    },
    {
      id: 'midnight',
      label: 'Midnight',
      preview: 'bg-gradient-to-br from-slate-950 via-purple-950 to-slate-900',
    },
    {
      id: 'ocean',
      label: 'Ocean',
      preview: 'bg-gradient-to-br from-slate-950 via-cyan-950 to-teal-900',
    },
    {
      id: 'carbon',
      label: 'Carbon',
      preview: 'bg-gradient-to-br from-zinc-950 via-neutral-900 to-zinc-800',
    },
  ];

  ngOnInit(): void {
    this.api.getSettings().subscribe({
      next: (res) => {
        this.nasName = res.settings.nasName;
        this.wallpaper = res.settings.wallpaper;
        if (res.settings.loginScreen) {
          this.loginScreen = { ...res.settings.loginScreen };
        }
        this.hostname = res.hostname;
        this.network.set(res.network);

        if (res.settings.ai) {
          this.aiEnabled = res.settings.ai.enabled;
          this.aiProvider = res.settings.ai.providerType;
          this.aiBaseUrl = res.settings.ai.baseUrl;
          this.aiModel = res.settings.ai.model;
          this.hasSavedApiKey.set(Boolean(res.settings.ai.hasApiKey));
          this.apiKeyPreview.set(res.settings.ai.apiKeyPreview ?? '');
        }
      },
      error: () => {},
    });
  }

  applyPreset(id: AiSettingsView['providerType']): void {
    this.aiProvider = id;
    const preset = this.providerPresets.find((p) => p.id === id);
    if (preset && id !== 'custom') {
      this.aiBaseUrl = preset.baseUrl;
      this.aiModel = preset.model;
    }
  }

  clearKey(): void {
    this.clearApiKeyFlag = true;
    this.hasSavedApiKey.set(false);
    this.apiKeyPreview.set('');
    this.aiApiKeyInput = '';
  }

  testAi(): void {
    this.testingAi.set(true);
    this.aiTestResult.set(null);
    this.api
      .testAiConnection({
        baseUrl: this.aiBaseUrl,
        model: this.aiModel,
        apiKey: this.aiApiKeyInput || undefined,
      })
      .subscribe({
        next: (res) => {
          this.testingAi.set(false);
          this.aiTestResult.set(`✓ Connesso! Risposta: "${res.reply}"`);
        },
        error: (err) => {
          this.testingAi.set(false);
          this.aiTestResult.set(`✕ ${err?.error?.error ?? 'Connessione fallita'}`);
        },
      });
  }

  save(): void {
    this.api
      .saveSettings({
        nasName: this.nasName,
        hostname: this.hostname,
        wallpaper: this.wallpaper,
        loginScreen: this.loginScreen,
        ai: {
          enabled: this.aiEnabled,
          providerType: this.aiProvider,
          baseUrl: this.aiBaseUrl,
          model: this.aiModel,
          apiKey: this.aiApiKeyInput || undefined,
          clearApiKey: this.clearApiKeyFlag,
        },
      })
      .subscribe({
        next: (res) => {
          this.feedbackOk.set(true);
          this.feedback.set('Impostazioni salvate!');
          this.aiApiKeyInput = '';
          this.clearApiKeyFlag = false;
          this.hasSavedApiKey.set(Boolean(res.settings.ai?.hasApiKey));
          this.apiKeyPreview.set(res.settings.ai?.apiKeyPreview ?? '');
          this.updated.emit(res.settings);
        },
        error: (err) => {
          this.feedbackOk.set(false);
          this.feedback.set(err?.error?.error ?? 'Errore salvataggio impostazioni');
        },
      });
  }

  async onWallpaperUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const res = await this.api.uploadWallpaper(file);
      this.wallpaper = 'custom';
      this.feedbackOk.set(true);
      this.feedback.set('Sfondo personalizzato caricato!');
      this.updated.emit(res.settings);
    } catch (err) {
      this.feedbackOk.set(false);
      this.feedback.set(err instanceof Error ? err.message : 'Errore upload sfondo');
    } finally {
      input.value = '';
    }
  }

  async onLoginWallpaperUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const res = await this.api.uploadLoginWallpaper(file);
      this.loginScreen.useCustomWallpaper = true;
      this.feedbackOk.set(true);
      this.feedback.set('Sfondo dedicato per il Login caricato!');
      this.updated.emit(res.settings);
    } catch (err) {
      this.feedbackOk.set(false);
      this.feedback.set(err instanceof Error ? err.message : 'Errore upload sfondo login');
    } finally {
      input.value = '';
    }
  }

  checkUpdates(): void {
    this.checkingUpdates.set(true);
    this.updateError.set(null);
    this.api.checkSystemUpdates().subscribe({
      next: (res) => {
        this.checkingUpdates.set(false);
        this.updateStatus.set(res);
      },
      error: (err) => {
        this.checkingUpdates.set(false);
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore controllo aggiornamenti');
      },
    });
  }

  cleanVersion(v: string | null | undefined): string {
    return (v ?? '').trim().replace(/^v+/i, '');
  }

  formatNotes(raw: string): string {
    return raw
      .split('\n')
      .filter((line) => !/^##\s+\[?\d+\.\d+\.\d+/.test(line.trim()))
      .map((line) =>
        line
          .replace(/\(\[?[a-f0-9]{7,40}\]?\(https?:\/\/[^)]+\)\)/gi, '')
          .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, '$1')
          .replace(/https?:\/\/\S+/gi, '')
          .replace(/^###\s+/, '')
          .replace(/^\*\s+/, '• ')
          .trimEnd()
      )
      .filter((line, idx, arr) => !(line === '' && (idx === 0 || arr[idx - 1] === '')))
      .join('\n')
      .trim();
  }

  formatReleaseDate(isoDate: string): string {
    try {
      return new Date(isoDate).toLocaleDateString('it-IT', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return isoDate;
    }
  }

  startUpdate(): void {
    const pwd = this.authPassword;
    if (!pwd) return;
    this.updateError.set(null);

    this.api.startSystemUpdate(pwd).subscribe({
      next: () => {
        this.authPassword = '';
        this.showAuthPrompt.set(false);
        this.updatingSystem.set(true);
        this.updateStage.set('Aggiornamento pacchetti Debian e SiloOs in corso...');
        this.pollUpdateUntilDone();
      },
      error: (err) => {
        this.updateError.set(
          err?.error?.error ?? 'Password amministratore non valida'
        );
      },
    });
  }

  private pollUpdateUntilDone(): void {
    let sawDoneOrRestart = false;
    const timer = setInterval(() => {
      this.api.getSystemUpdateProgress().subscribe({
        next: (prog) => {
          if (prog.message) this.updateStage.set(prog.message);

          if (prog.state === 'error') {
            clearInterval(timer);
            this.updatingSystem.set(false);
            this.feedbackOk.set(false);
            this.feedback.set(prog.message || 'Errore durante l\'aggiornamento');
            return;
          }

          if (prog.state === 'done') {
            if (sawDoneOrRestart) {
              clearInterval(timer);
              this.updatingSystem.set(false);
              window.location.reload();
            } else {
              sawDoneOrRestart = true;
            }
          }
        },
        error: () => {
          // Backend is restarting: wait for /api/health to come back up
          sawDoneOrRestart = true;
          this.updateStage.set('Riavvio servizi SiloOs in corso...');
          this.api.checkHealth().subscribe({
            next: () => {
              clearInterval(timer);
              this.updatingSystem.set(false);
              window.location.reload();
            },
            error: () => {},
          });
        },
      });
    }, 2500);
  }
}
