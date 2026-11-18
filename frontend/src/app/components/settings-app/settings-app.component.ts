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
  NasSettingsResponse,
  SystemUpdateStatus,
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
          <label class="block text-xs font-medium text-slate-300">
            Sfondo Desktop (Wallpaper)
          </label>
          <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      <!-- System Updates (GitHub) -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              Aggiornamenti Sistema (GitHub)
            </h3>
            <p class="mt-0.5 text-[11px] text-slate-400">
              Verifica la presenza di nuove versioni e aggiorna NAS-OS senza toccare /DATA o i container
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

        <div>
          <label class="block text-xs font-medium text-slate-300">
            URL Repository GitHub
          </label>
          <input
            type="text"
            [(ngModel)]="repoUrl"
            placeholder="https://github.com/fedecino/custom-nas-os.git"
            class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
          />
        </div>

        @if (updateStatus(); as st) {
          <div class="rounded-xl border border-white/10 bg-black/30 p-3.5 text-xs space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              @if (!st.initialized) {
                <span class="text-amber-300">Repository non ancora clonato su questo NAS</span>
              } @else if (st.updateAvailable) {
                <span class="font-semibold text-amber-300">
                  Disponibili {{ st.behindCount }} nuovi aggiornamenti ({{ st.currentCommit }} → {{ st.remoteCommit }})
                </span>
              } @else {
                <span class="font-semibold text-emerald-300">
                  ✓ Sistema aggiornato (commit {{ st.currentCommit }})
                </span>
              }

              <button
                type="button"
                (click)="showAuthPrompt.set(true)"
                [disabled]="updatingSystem()"
                class="rounded-xl bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                Aggiorna Sistema
              </button>
            </div>
            @if (st.latestMessage) {
              <div class="text-[11px] text-slate-400">
                Ultimo commit remoto: <span class="text-slate-200">{{ st.latestMessage }}</span>
              </div>
            }
          </div>
        }

        @if (showAuthPrompt()) {
          <div class="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 space-y-3">
            <h4 class="text-xs font-semibold text-amber-300">
              Conferma identità amministratore (sudo) per avviare l'aggiornamento
            </h4>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="text"
                [(ngModel)]="authUsername"
                placeholder="Username (es. fede)"
                class="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              />
              <input
                type="password"
                [(ngModel)]="authPassword"
                placeholder="Password amministratore"
                class="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
              />
            </div>
            @if (updateError()) {
              <div class="text-xs text-rose-300">{{ updateError() }}</div>
            }
            <div class="flex gap-2">
              <button
                type="button"
                (click)="startUpdate()"
                [disabled]="updatingSystem() || !authUsername.trim() || !authPassword"
                class="rounded-xl bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {{ updatingSystem() ? 'Aggiornamento in corso...' : 'Conferma e Aggiorna' }}
              </button>
              <button
                type="button"
                (click)="showAuthPrompt.set(false)"
                [disabled]="updatingSystem()"
                class="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-300"
              >
                Annulla
              </button>
            </div>
          </div>
        }

        @if (updateLogs().length > 0) {
          <div
            class="max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[#06090f] p-3 font-mono text-[11px] text-slate-200"
          >
            @for (line of updateLogs(); track $index) {
              <div class="whitespace-pre-wrap break-all">{{ line }}</div>
            }
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

  nasName = 'NAS-OS';
  hostname = '';
  wallpaper: 'aurora' | 'midnight' | 'ocean' | 'carbon' = 'aurora';
  repoUrl = 'https://github.com/fedecino/custom-nas-os.git';

  checkingUpdates = signal(false);
  updatingSystem = signal(false);
  updateStatus = signal<SystemUpdateStatus | null>(null);
  showAuthPrompt = signal(false);
  authUsername = '';
  authPassword = '';
  updateError = signal<string | null>(null);
  updateLogs = signal<string[]>([]);

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
    id: 'aurora' | 'midnight' | 'ocean' | 'carbon';
    label: string;
    preview: string;
  }> = [
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
        if (res.settings.repoUrl) this.repoUrl = res.settings.repoUrl;
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
        repoUrl: this.repoUrl,
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

  async startUpdate(): Promise<void> {
    this.updatingSystem.set(true);
    this.updateError.set(null);
    this.updateLogs.set([]);

    try {
      await this.api.applySystemUpdateSse(
        this.authUsername.trim(),
        this.authPassword,
        this.repoUrl.trim(),
        (msg) => {
          this.updateLogs.update((prev) => [...prev, msg]);
        }
      );
      this.authPassword = '';
      this.showAuthPrompt.set(false);
      this.updateLogs.update((prev) => [
        ...prev,
        'Riavvio del servizio completato. Ricaricamento interfaccia tra 3 secondi...',
      ]);
      setTimeout(() => window.location.reload(), 3000);
    } catch (err) {
      this.updateError.set(
        err instanceof Error ? err.message : 'Aggiornamento fallito'
      );
    } finally {
      this.updatingSystem.set(false);
    }
  }
}
