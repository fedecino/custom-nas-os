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
  AiSettingsView,
  ApiService,
  LoginScreenSettings,
  NasSettingsResponse,
  NetworkInterfaceConfig,
  SystemUpdateStatus,
  WallpaperType,
} from '../../services/api.service';
import { StorageManagerComponent } from '../storage-manager/storage-manager.component';
import { SharesManagerComponent } from '../shares-manager/shares-manager.component';
import { UsersManagerComponent } from '../users-manager/users-manager.component';
import { ServicesManagerComponent } from '../services-manager/services-manager.component';

export type SettingsCategory =
  | 'desktop'
  | 'login'
  | 'storage'
  | 'shares'
  | 'users'
  | 'services'
  | 'network'
  | 'ai'
  | 'updates';

@Component({
  selector: 'app-settings-app',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    StorageManagerComponent,
    SharesManagerComponent,
    UsersManagerComponent,
    ServicesManagerComponent,
  ],
  template: `
    @if (!isAdmin) {
      <div class="flex h-full items-center justify-center p-6">
        <div class="max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
          <div class="text-3xl">🔒</div>
          <h3 class="mt-2 text-sm font-semibold text-white">Accesso Riservato agli Amministratori</h3>
          <p class="mt-1.5 text-xs leading-relaxed text-slate-300">
            Solo gli utenti con privilegi di amministratore (<span class="font-mono text-sky-300">sudo</span>) possono visualizzare o modificare le impostazioni di sistema, rete, dischi, utenti e aggiornamenti.
          </p>
        </div>
      </div>
    } @else {
    <div class="flex h-full flex-col gap-5 md:flex-row">
      <!-- Left Categories Sidebar -->
      <aside
        class="flex shrink-0 flex-row gap-1.5 overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-2.5 md:w-56 md:flex-col"
      >
        @for (cat of categories; track cat.id) {
          <button
            type="button"
            (click)="activeCategory.set(cat.id)"
            class="flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-xs font-medium transition"
            [ngClass]="
              activeCategory() === cat.id
                ? 'bg-[#38bdf8]/20 text-white border border-[#38bdf8]/40'
                : 'text-slate-300 hover:bg-white/10 border border-transparent'
            "
          >
            <span class="text-base">{{ cat.icon }}</span>
            <div>
              <div>{{ cat.label }}</div>
              <div class="hidden text-[10px] text-slate-400 md:block">
                {{ cat.subtitle }}
              </div>
            </div>
          </button>
        }
      </aside>

      <!-- Right Category Content -->
      <div class="flex min-w-0 flex-1 flex-col space-y-5 overflow-y-auto pr-1">
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

        <!-- CATEGORY 1: Aspetto & Desktop -->
        @if (activeCategory() === 'desktop') {
          <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-5">
            <div>
              <h3 class="text-sm font-semibold text-white">Aspetto & Desktop</h3>
              <p class="mt-0.5 text-xs text-slate-400">
                Personalizza il nome del NAS e lo sfondo della scrivania
              </p>
            </div>

            <div>
              <label class="block text-xs font-medium text-slate-300">
                Nome mostrato nel Desktop
              </label>
              <input
                type="text"
                [(ngModel)]="nasName"
                class="mt-1.5 w-full max-w-sm rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
              />
            </div>

            <div>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <label class="block text-xs font-medium text-slate-300">
                  Sfondo Desktop (Wallpaper)
                </label>
                <label
                  class="cursor-pointer rounded-xl border border-[#38bdf8]/40 bg-[#38bdf8]/15 px-3 py-1 text-[11px] font-medium text-[#38bdf8] hover:bg-[#38bdf8]/25"
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
              <div class="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                @for (wp of wallpapers; track wp.id) {
                  <button
                    type="button"
                    (click)="wallpaper = wp.id"
                    class="flex flex-col items-start rounded-xl border p-2.5 text-left transition"
                    [ngClass]="
                      wallpaper === wp.id
                        ? 'border-[#38bdf8] bg-[#38bdf8]/15'
                        : 'border-white/10 bg-black/25 hover:border-white/20'
                    "
                  >
                    <div class="h-10 w-full rounded-lg" [ngClass]="wp.preview"></div>
                    <span class="mt-2 text-xs font-medium text-white">{{ wp.label }}</span>
                  </button>
                }
              </div>
            </div>

            <button
              (click)="save()"
              class="rounded-xl bg-[#38bdf8] px-5 py-2 text-xs font-semibold text-[#090e1a] hover:brightness-110"
            >
              Salva Impostazioni
            </button>
          </div>
        }

        <!-- CATEGORY 2: Schermata di Login -->
        @if (activeCategory() === 'login') {
          <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 class="text-sm font-semibold text-white">Schermata di Login</h3>
                <p class="mt-0.5 text-xs text-slate-400">
                  Personalizza titolo, messaggio di benvenuto, elementi visibili e sfondo del login
                </p>
              </div>
              <label
                class="cursor-pointer rounded-xl border border-[#38bdf8]/40 bg-[#38bdf8]/15 px-3 py-1.5 text-[11px] font-medium text-[#38bdf8] hover:bg-[#38bdf8]/25"
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
                  class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-300">
                  Sottotitolo / Messaggio
                </label>
                <input
                  type="text"
                  [(ngModel)]="loginScreen.subtitle"
                  class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                />
              </div>
            </div>

            <div class="grid grid-cols-1 gap-3 text-xs text-slate-300 sm:grid-cols-2">
              <label class="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-black/25 p-3">
                <input type="checkbox" [(ngModel)]="loginScreen.showLogo" class="accent-[#38bdf8]" />
                <span>Mostra Logo SiloOs</span>
              </label>
              <label class="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-black/25 p-3">
                <input type="checkbox" [(ngModel)]="loginScreen.showClock" class="accent-[#38bdf8]" />
                <span>Mostra Orologio & Data</span>
              </label>
              <label class="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-black/25 p-3">
                <input type="checkbox" [(ngModel)]="loginScreen.blurBackground" class="accent-[#38bdf8]" />
                <span>Sfocatura Sfondo (Blur)</span>
              </label>
              <label class="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-black/25 p-3">
                <input type="checkbox" [(ngModel)]="loginScreen.useCustomWallpaper" class="accent-[#38bdf8]" />
                <span>Usa sfondo dedicato per il Login</span>
              </label>
            </div>

            <button
              (click)="save()"
              class="rounded-xl bg-[#38bdf8] px-5 py-2 text-xs font-semibold text-[#090e1a] hover:brightness-110"
            >
              Salva Impostazioni
            </button>
          </div>
        }

        <!-- CATEGORY: Dischi & Storage -->
        @if (activeCategory() === 'storage') {
          <app-storage-manager />
        }

        <!-- CATEGORY: Condivisioni -->
        @if (activeCategory() === 'shares') {
          <app-shares-manager />
        }

        <!-- CATEGORY: Utenti & Permessi -->
        @if (activeCategory() === 'users') {
          <app-users-manager />
        }

        <!-- CATEGORY: Servizi, Porte & Firewall -->
        @if (activeCategory() === 'services') {
          <app-services-manager />
        }

        <!-- CATEGORY 3: Rete & Sistema -->
        @if (activeCategory() === 'network') {
          <div class="space-y-4">
            <!-- Hostname Card -->
            <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
              <div>
                <h3 class="text-sm font-semibold text-white">Rete & Hostname</h3>
                <p class="mt-0.5 text-xs text-slate-400">
                  Configura l'hostname del server e gli indirizzi IP delle schede di rete fisiche
                </p>
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-300">
                  Hostname Linux
                </label>
                <div class="mt-1.5 flex flex-wrap gap-3">
                  <input
                    type="text"
                    [(ngModel)]="hostname"
                    class="w-full max-w-sm rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                  />
                  <button
                    (click)="save()"
                    class="rounded-xl bg-[#38bdf8] px-5 py-2 text-xs font-semibold text-[#090e1a] hover:brightness-110"
                  >
                    Applica Hostname
                  </button>
                </div>
              </div>
            </div>

            <!-- Physical Network Interfaces Card -->
            <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 class="text-sm font-semibold text-white">
                    Configurazione IP Scheda di Rete Fisica
                  </h4>
                  <p class="mt-0.5 text-xs text-slate-400">
                    Seleziona una scheda di rete fisica per impostare DHCP automatico oppure IP statico manuale
                  </p>
                </div>
                <button
                  type="button"
                  (click)="loadPhysicalInterfaces()"
                  [disabled]="loadingNetwork()"
                  class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50"
                >
                  {{ loadingNetwork() ? 'Aggiornamento...' : '↻ Aggiorna' }}
                </button>
              </div>

              @if (physicalInterfaces().length === 0 && !loadingNetwork()) {
                <div class="rounded-xl border border-white/10 bg-black/25 p-4 text-xs text-slate-400">
                  Nessuna scheda di rete fisica rilevata.
                </div>
              } @else {
                <!-- Interface Selector Cards -->
                <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  @for (iface of physicalInterfaces(); track iface.name) {
                    <button
                      type="button"
                      (click)="selectNetworkInterface(iface)"
                      class="rounded-xl border p-3.5 text-left transition"
                      [ngClass]="
                        selectedIfaceName() === iface.name
                          ? 'border-[#38bdf8] bg-[#38bdf8]/10'
                          : 'border-white/10 bg-black/25 hover:bg-white/5'
                      "
                    >
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2">
                          <span class="font-mono text-xs font-semibold text-[#38bdf8]">
                            {{ iface.name }}
                          </span>
                          <span class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                            {{ iface.type === 'wifi' ? 'Wi-Fi' : 'Ethernet' }}
                          </span>
                        </div>
                        <span
                          class="rounded-full px-2 py-0.5 text-[10px] font-medium"
                          [ngClass]="
                            iface.state.startsWith('connected')
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-700/60 text-slate-400'
                          "
                        >
                          {{ iface.state.startsWith('connected') ? 'Connessa' : iface.state }}
                        </span>
                      </div>

                      <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-slate-300">
                        <span>
                          IP: {{ iface.activeIp ? iface.activeIp + '/' + iface.activePrefix : 'Non assegnato' }}
                        </span>
                        <span class="text-slate-500">·</span>
                        <span class="text-slate-400">
                          {{ iface.method === 'manual' ? 'Manuale' : 'DHCP' }}
                        </span>
                        @if (iface.speedMbps) {
                          <span class="text-slate-500">·</span>
                          <span class="text-slate-400">{{ iface.speedMbps }} Mbps</span>
                        }
                      </div>

                      @if (iface.mac) {
                        <div class="mt-1 font-mono text-[10px] text-slate-500">
                          MAC: {{ iface.mac }}
                        </div>
                      }
                    </button>
                  }
                </div>

                <!-- Selected Interface Configuration Form -->
                @if (selectedIfaceName()) {
                  <div class="space-y-4 rounded-xl border border-white/10 bg-black/30 p-4">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div class="text-xs font-semibold text-white">
                        Configurazione per <span class="font-mono text-[#38bdf8]">{{ selectedIfaceName() }}</span>
                      </div>

                      <!-- DHCP / Manual Toggle -->
                      <div class="inline-flex rounded-xl border border-white/10 bg-slate-950/70 p-1">
                        <button
                          type="button"
                          (click)="netForm.method = 'auto'"
                          class="rounded-lg px-3 py-1.5 text-xs font-medium transition"
                          [ngClass]="
                            netForm.method === 'auto'
                              ? 'bg-[#38bdf8] text-[#090e1a]'
                              : 'text-slate-300'
                          "
                        >
                          DHCP (Automatico)
                        </button>
                        <button
                          type="button"
                          (click)="netForm.method = 'manual'"
                          class="rounded-lg px-3 py-1.5 text-xs font-medium transition"
                          [ngClass]="
                            netForm.method === 'manual'
                              ? 'bg-[#38bdf8] text-[#090e1a]'
                              : 'text-slate-300'
                          "
                        >
                          Manuale (IP Statico)
                        </button>
                      </div>
                    </div>

                    @if (netForm.method === 'auto') {
                      <div class="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs text-slate-300">
                        L'indirizzo IPv4, la subnet mask, il gateway e i server DNS verranno ottenuti automaticamente dal server DHCP della rete (router).
                      </div>
                    } @else {
                      <div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                        <div>
                          <label class="block text-xs font-medium text-slate-300">
                            Indirizzo IPv4
                          </label>
                          <input
                            type="text"
                            [(ngModel)]="netForm.ip"
                            placeholder="es. 192.168.1.50"
                            class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-slate-300">
                            Subnet Mask (o prefisso CIDR)
                          </label>
                          <input
                            type="text"
                            [(ngModel)]="netForm.netmask"
                            placeholder="255.255.255.0 oppure 24"
                            class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-slate-300">
                            Gateway Predefinito
                          </label>
                          <input
                            type="text"
                            [(ngModel)]="netForm.gateway"
                            placeholder="es. 192.168.1.1"
                            class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-slate-300">
                            Server DNS (separati da virgola)
                          </label>
                          <input
                            type="text"
                            [(ngModel)]="netForm.dns"
                            placeholder="es. 1.1.1.1, 8.8.8.8"
                            class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                          />
                        </div>
                      </div>
                    }

                    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                      <p class="text-[11px] text-amber-300/90">
                        Attenzione: se cambi l'IP della scheda su cui sei collegato, la pagina potrebbe perdere temporaneamente la connessione.
                      </p>
                      <button
                        type="button"
                        (click)="saveNetworkConfig()"
                        [disabled]="savingNetwork()"
                        class="rounded-xl bg-[#00ff88] px-5 py-2 text-xs font-semibold text-[#062417] hover:brightness-110 disabled:opacity-50"
                      >
                        {{ savingNetwork() ? 'Applicazione in corso...' : 'Applica Configurazione Rete' }}
                      </button>
                    </div>

                    @if (networkFeedback()) {
                      <div
                        class="rounded-xl border px-3.5 py-2.5 text-xs"
                        [ngClass]="
                          networkFeedbackOk()
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                            : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                        "
                      >
                        <div>{{ networkFeedback() }}</div>
                        @if (redirectIpUrl()) {
                          <a
                            [href]="redirectIpUrl()"
                            class="mt-1.5 inline-block font-semibold text-[#38bdf8] underline"
                          >
                            Apri SiloOs al nuovo indirizzo ({{ redirectIpUrl() }}) →
                          </a>
                        }
                      </div>
                    }
                  </div>
                }
              }
            </div>
          </div>
        }

        <!-- CATEGORY 4: Assistente AI -->
        @if (activeCategory() === 'ai') {
          <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-white">Assistente AI NAS (Opzionale)</h3>
                <p class="mt-0.5 text-xs text-slate-400">
                  Collega un servizio Cloud (OpenAI, Gemini, OpenRouter) o un LLM locale in LAN (Ollama, LM Studio)
                </p>
              </div>
              <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-white">
                <input
                  type="checkbox"
                  [(ngModel)]="aiEnabled"
                  class="h-4 w-4 accent-[#38bdf8]"
                />
                <span>Abilita AI Assistant</span>
              </label>
            </div>

            @if (aiEnabled) {
              <div class="space-y-4 border-t border-white/10 pt-4">
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
                            ? 'border-[#38bdf8] bg-[#38bdf8]/20 text-white'
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
                      class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
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
                      class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <div class="flex items-center justify-between">
                    <label class="block text-xs font-medium text-slate-300">
                      Chiave API (opzionale per Ollama / LLM locali)
                    </label>
                    @if (hasSavedApiKey()) {
                      <div class="flex items-center gap-2 text-[11px] text-[#00ff88]">
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
                    class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                  />
                </div>

                <div class="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    (click)="testAi()"
                    [disabled]="testingAi()"
                    class="rounded-xl border border-[#38bdf8]/40 bg-[#38bdf8]/15 px-4 py-2 text-xs font-medium text-[#38bdf8] hover:bg-[#38bdf8]/25 disabled:opacity-50"
                  >
                    {{ testingAi() ? 'Test in corso...' : 'Testa Connessione AI' }}
                  </button>
                  @if (aiTestResult()) {
                    <span class="text-xs text-slate-300">{{ aiTestResult() }}</span>
                  }
                </div>
              </div>
            }

            <button
              (click)="save()"
              class="rounded-xl bg-[#38bdf8] px-5 py-2 text-xs font-semibold text-[#090e1a] hover:brightness-110"
            >
              Salva Configurazione AI
            </button>
          </div>
        }

        <!-- CATEGORY 5: Aggiornamenti -->
        @if (activeCategory() === 'updates') {
          <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-white">Aggiornamenti Sistema</h3>
                <p class="mt-0.5 text-xs text-slate-400">
                  Verifica nuove release di SiloOs e aggiorna anche i pacchetti Debian di sistema
                </p>
              </div>
              <button
                type="button"
                (click)="checkUpdates()"
                [disabled]="checkingUpdates() || updatingSystem()"
                class="rounded-xl border border-[#00ff88]/40 bg-[#00ff88]/15 px-4 py-2 text-xs font-medium text-[#00ff88] hover:bg-[#00ff88]/25 disabled:opacity-50"
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
                      <span class="font-semibold text-[#00ff88]">
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
                      class="rounded-xl bg-[#00ff88] px-4 py-1.5 text-xs font-semibold text-[#090e1a] hover:brightness-110 disabled:opacity-50"
                    >
                      Aggiorna Sistema
                    </button>
                  }
                </div>

                @if (st.latestReleaseDate || st.latestReleaseVersion) {
                  <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                    @if (st.latestReleaseVersion) {
                      <span class="rounded bg-[#38bdf8]/15 px-2 py-0.5 font-mono text-[#38bdf8]">
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
                  <div class="max-h-40 overflow-y-auto rounded-lg bg-black/40 p-2.5 text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap">{{ formatNotes(st.latestReleaseNotes) }}</div>
                }
              </div>
            }
          </div>
        }
      </div>

      <!-- Password Dialog for Update -->
      @if (showAuthPrompt()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <form
            (ngSubmit)="startUpdate()"
            class="w-full max-w-sm rounded-2xl border border-[#1e293b] bg-[#0f172a] p-6 shadow-2xl space-y-4"
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
              class="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
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
                class="rounded-xl bg-[#00ff88] px-4 py-2 text-xs font-semibold text-[#090e1a] hover:brightness-110 disabled:opacity-50"
              >
                Conferma e Aggiorna
              </button>
            </div>
          </form>
        </div>
      }

      <!-- Updating Progress Blocking Dialog -->
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
    }
  `,
})
export class SettingsAppComponent implements OnInit {
  private readonly api = inject(ApiService);

  @Input() isAdmin = true;
  @Input() set initialCategory(cat: SettingsCategory | null) {
    if (cat) this.activeCategory.set(cat);
  }
  @Output() updated = new EventEmitter<NasSettingsResponse['settings']>();

  activeCategory = signal<SettingsCategory>('desktop');

  categories: Array<{
    id: SettingsCategory;
    label: string;
    subtitle: string;
    icon: string;
  }> = [
      { id: 'desktop', label: 'Aspetto', subtitle: 'Nome & Wallpaper', icon: '🎨' },
      { id: 'login', label: 'Schermata Login', subtitle: 'Testi & Sfondo', icon: '🔐' },
      { id: 'storage', label: 'Dischi & Storage', subtitle: 'Mount, RAID & SMART', icon: '🖴' },
      { id: 'shares', label: 'Condivisioni', subtitle: 'SMB, NFS & FTP', icon: '🔗' },
      { id: 'users', label: 'Utenti & Permessi', subtitle: 'Account & Password', icon: '👤' },
      { id: 'services', label: 'Servizi & Firewall', subtitle: 'Porte, Nginx & UFW', icon: '🔌' },
      { id: 'network', label: 'Rete & Hostname', subtitle: 'IP & Interfacce', icon: '🌐' },
      { id: 'ai', label: 'Assistente AI', subtitle: 'Cloud o LLM Locale', icon: '🤖' },
      { id: 'updates', label: 'Aggiornamenti', subtitle: 'SiloOs & Debian', icon: '🔄' },
    ];

  nasName = 'SiloOs';
  hostname = '';
  wallpaper: WallpaperType = 'silo-landscape';
  loginScreen: LoginScreenSettings = {
    title: 'SiloOs',
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
  physicalInterfaces = signal<NetworkInterfaceConfig[]>([]);
  selectedIfaceName = signal<string>('');
  loadingNetwork = signal(false);
  savingNetwork = signal(false);
  networkFeedback = signal<string | null>(null);
  networkFeedbackOk = signal(true);
  redirectIpUrl = signal<string | null>(null);

  netForm: {
    method: 'auto' | 'manual';
    ip: string;
    netmask: string;
    gateway: string;
    dns: string;
  } = {
    method: 'auto',
    ip: '',
    netmask: '255.255.255.0',
    gateway: '',
    dns: '1.1.1.1, 8.8.8.8',
  };

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
        label: 'SiloOs Peak',
        preview: 'bg-gradient-to-br from-[#090e1a] via-[#141e33] to-[#38bdf8]/40',
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
      error: () => { },
    });
    this.loadPhysicalInterfaces();
  }

  prefixToNetmask(prefix: number): string {
    const p = Math.max(0, Math.min(32, Math.floor(prefix || 24)));
    const mask = p === 0 ? 0 : (~0 << (32 - p)) >>> 0;
    return [
      (mask >>> 24) & 255,
      (mask >>> 16) & 255,
      (mask >>> 8) & 255,
      mask & 255,
    ].join('.');
  }

  loadPhysicalInterfaces(): void {
    this.loadingNetwork.set(true);
    this.api.getNetworkInterfaces().subscribe({
      next: (res) => {
        this.loadingNetwork.set(false);
        this.physicalInterfaces.set(res.interfaces);
        const currentSelected = this.selectedIfaceName();
        const found =
          res.interfaces.find((i) => i.name === currentSelected) ??
          res.interfaces.find((i) => i.state.startsWith('connected')) ??
          res.interfaces[0];
        if (found) {
          this.selectNetworkInterface(found, false);
        }
      },
      error: () => {
        this.loadingNetwork.set(false);
      },
    });
  }

  selectNetworkInterface(iface: NetworkInterfaceConfig, clearFeedback = true): void {
    this.selectedIfaceName.set(iface.name);
    if (clearFeedback) {
      this.networkFeedback.set(null);
      this.redirectIpUrl.set(null);
    }
    this.netForm = {
      method: iface.method,
      ip: iface.ip || iface.activeIp || '',
      netmask: this.prefixToNetmask(iface.prefix || iface.activePrefix || 24),
      gateway: iface.gateway || iface.activeGateway || '',
      dns: (iface.dns.length > 0 ? iface.dns : iface.activeDns).join(', '),
    };
  }

  saveNetworkConfig(): void {
    const iface = this.selectedIfaceName();
    if (!iface) return;

    this.savingNetwork.set(true);
    this.networkFeedback.set(null);
    this.redirectIpUrl.set(null);

    const dnsArray = this.netForm.dns
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    this.api
      .saveNetworkInterface(iface, {
        method: this.netForm.method,
        ip: this.netForm.method === 'manual' ? this.netForm.ip.trim() : undefined,
        netmask: this.netForm.method === 'manual' ? this.netForm.netmask.trim() : undefined,
        gateway: this.netForm.method === 'manual' ? this.netForm.gateway.trim() : undefined,
        dns: this.netForm.method === 'manual' ? dnsArray : undefined,
      })
      .subscribe({
        next: (res) => {
          this.savingNetwork.set(false);
          this.networkFeedbackOk.set(true);
          if (res.method === 'manual' && res.ip) {
            this.networkFeedback.set(
              `Configurazione statica applicata su ${res.iface} (${res.ip}/${res.prefix}).`
            );
            if (res.ip !== window.location.hostname) {
              const port = window.location.port ? `:${window.location.port}` : '';
              this.redirectIpUrl.set(`${window.location.protocol}//${res.ip}${port}`);
            }
          } else {
            this.networkFeedback.set(`Modalità DHCP ripristinata su ${res.iface}.`);
          }
          setTimeout(() => this.loadPhysicalInterfaces(), 2200);
        },
        error: (err) => {
          this.savingNetwork.set(false);
          this.networkFeedbackOk.set(false);
          this.networkFeedback.set(
            err?.error?.error ?? 'Errore durante il salvataggio della configurazione di rete'
          );
        },
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

  async startUpdate(): Promise<void> {
    const pwd = this.authPassword;
    if (!pwd) return;
    this.updateError.set(null);

    try {
      const res = await fetch('/api/settings/updates/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });

      const contentType = res.headers.get('content-type') ?? '';

      if (!res.ok) {
        let errMsg = 'Password amministratore non valida';
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) errMsg = data.error;
        } catch {
          // ignore parse error
        }
        this.updateError.set(errMsg);
        return;
      }

      this.authPassword = '';
      this.showAuthPrompt.set(false);
      this.updatingSystem.set(true);
      this.updateStage.set('Aggiornamento pacchetti Debian e SiloOs in corso...');

      if (contentType.includes('text/event-stream') && res.body) {
        await this.consumeLegacySseUpdate(res.body);
      } else {
        this.pollUpdateUntilDone();
      }
    } catch (err) {
      this.updateError.set(
        err instanceof Error ? err.message : "Errore avvio aggiornamento"
      );
    }
  }

  private async consumeLegacySseUpdate(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'message';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (currentEvent === 'error') {
              this.updatingSystem.set(false);
              this.feedbackOk.set(false);
              this.feedback.set(payload || "Errore durante l'aggiornamento");
              return;
            }
            if (currentEvent === 'log' && payload) {
              this.updateStage.set(payload.slice(0, 120));
            }
            if (currentEvent === 'done') {
              this.updateStage.set('Riavvio servizi SiloOs in corso...');
              this.pollUpdateUntilDone();
              return;
            }
          }
        }
      }
    } catch {
      // Connection often drops when backend restarts mid-update
    }

    this.updateStage.set('Riavvio servizi SiloOs in corso...');
    this.pollUpdateUntilDone();
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
            this.feedback.set(prog.message || "Errore durante l'aggiornamento");
            return;
          }

          if (prog.state === 'done') {
            if (sawDoneOrRestart) {
              clearInterval(timer);
              this.updateStage.set('✓ Aggiornamento completato! Ricaricamento pagina...');
              setTimeout(() => {
                this.updatingSystem.set(false);
                window.location.href = window.location.pathname;
              }, 1200);
            } else {
              sawDoneOrRestart = true;
              this.updateStage.set('Riavvio servizi SiloOs in corso...');
            }
          }
        },
        error: () => {
          sawDoneOrRestart = true;
          this.updateStage.set('Riavvio servizi SiloOs in corso...');
          this.api.checkHealth().subscribe({
            next: () => {
              clearInterval(timer);
              this.updateStage.set('✓ Servizi riavviati! Ricaricamento pagina...');
              setTimeout(() => {
                this.updatingSystem.set(false);
                window.location.href = window.location.pathname;
              }, 1200);
            },
            error: () => {},
          });
        },
      });
    }, 2500);
  }
}
