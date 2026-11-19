import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  FirewallStatusResponse,
  ListeningPort,
  ManagedSystemService,
  ProxyRoute,
  SslStatusResponse,
} from '../../services/api.service';

@Component({
  selector: 'app-services-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-white">
            Servizi, Porte Attive & Firewall
          </h2>
          <p class="text-xs text-slate-400">
            Controlla i servizi systemd, scopri a cosa serve ogni porta aperta e gestisci il firewall (UFW)
          </p>
        </div>
        <button
          type="button"
          (click)="load()"
          class="rounded-xl border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-slate-200 hover:bg-white/10"
        >
          Aggiorna
        </button>
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

      <!-- Reverse Proxy Nginx (Custom Container URLs) -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
        <div>
          <h3 class="text-sm font-semibold text-white">
            Reverse Proxy Nginx (Percorsi Personalizzati)
          </h3>
          <p class="mt-0.5 text-[11px] text-slate-400">
            Reindirizza percorsi come <span class="font-mono text-[#38bdf8]">/{{ '{' }}nome{{ '}' }}</span> (es. <span class="font-mono text-[#38bdf8]">/jellyfin</span>) direttamente verso un container o servizio locale.
          </p>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-12">
          <input
            type="text"
            [(ngModel)]="proxyPath"
            placeholder="Percorso (es. /jellyfin)"
            class="rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none sm:col-span-3"
          />
          <select
            (change)="onContainerQuickPick($event)"
            class="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-200 sm:col-span-4"
          >
            <option value="">Scegli da container attivi (opzionale)...</option>
            @for (p of containerPorts(); track p.port) {
              <option [value]="p.containerName + '|' + p.port">
                🐳 {{ p.containerName }} (:{{ p.port }})
              </option>
            }
          </select>
          <input
            type="text"
            [(ngModel)]="proxyTarget"
            placeholder="Target (es. http://127.0.0.1:8096)"
            class="rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none sm:col-span-5"
          />
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <label class="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" [(ngModel)]="proxyStripPrefix" class="accent-[#38bdf8]" />
            <span>Rimuovi prefisso percorso (strip prefix — utile per app che non supportano subpath)</span>
          </label>
          <button
            type="button"
            (click)="addProxyRoute()"
            [disabled]="!proxyPath.trim() || !proxyTarget.trim()"
            class="rounded-xl bg-[#38bdf8] px-4 py-1.5 text-xs font-semibold text-[#090e1a] hover:brightness-110 disabled:opacity-50"
          >
            Aggiungi Rotta Nginx
          </button>
        </div>

        @if (proxyRoutes().length > 0) {
          <div class="overflow-x-auto rounded-xl border border-white/10 bg-black/25">
            <table class="w-full text-left text-xs">
              <thead class="border-b border-white/10 text-[10px] uppercase text-slate-400">
                <tr>
                  <th class="px-3 py-2">Percorso</th>
                  <th class="px-3 py-2">Destinazione</th>
                  <th class="px-3 py-2">Modalità</th>
                  <th class="px-3 py-2 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                @for (r of proxyRoutes(); track r.slug) {
                  <tr>
                    <td class="px-3 py-2">
                      <a
                        [href]="r.path + '/'"
                        target="_blank"
                        rel="noopener"
                        class="font-mono font-semibold text-[#38bdf8] hover:underline"
                      >
                        {{ r.path }} ↗
                      </a>
                    </td>
                    <td class="px-3 py-2 font-mono text-slate-300">{{ r.target }}</td>
                    <td class="px-3 py-2 text-[11px] text-slate-400">
                      {{ r.stripPrefix ? 'Strip prefix' : 'Mantieni prefisso' }}
                    </td>
                    <td class="px-3 py-2 text-right">
                      <button
                        type="button"
                        (click)="removeProxyRoute(r.slug)"
                        class="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/25"
                      >
                        Elimina
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <!-- HTTPS / SSL Certificate (Nginx) -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="flex items-center gap-2.5">
              <h3 class="text-sm font-semibold text-white">Certificato SSL / HTTPS (Nginx)</h3>
              <span
                class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase"
                [ngClass]="
                  sslStatus()?.config?.enabled
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-slate-700 text-slate-300'
                "
              >
                {{ sslStatus()?.config?.enabled ? 'HTTPS Attivo (:443)' : 'Solo HTTP (:80)' }}
              </span>
            </div>
            <p class="mt-0.5 text-[11px] text-slate-400">
              Abilita HTTPS su porta 443 con validazione automatica <span class="font-mono text-sky-300">nginx -t</span> e rollback di sicurezza, preservato anche dopo gli aggiornamenti.
            </p>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              (click)="generateSelfSigned()"
              [disabled]="sslBusy()"
              class="rounded-xl bg-[#00ff88] px-4 py-2 text-xs font-semibold text-[#062417] hover:brightness-110 disabled:opacity-50"
            >
              {{ sslBusy() ? 'Configurazione...' : '🔒 Genera Self-Signed & Attiva HTTPS' }}
            </button>
            @if (sslStatus()?.config?.enabled) {
              <button
                type="button"
                (click)="disableSsl()"
                [disabled]="sslBusy()"
                class="rounded-xl bg-rose-500/20 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/30 disabled:opacity-50"
              >
                Disattiva HTTPS
              </button>
            }
          </div>
        </div>

        @if (sslStatus(); as ssl) {
          <div class="rounded-xl border border-white/10 bg-black/25 p-3.5 text-xs space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2 text-slate-300">
              <span>
                Modalità: <strong class="text-white">{{ ssl.config.mode === 'custom' ? 'Certificato Personalizzato' : 'Self-Signed (LAN)' }}</strong>
              </span>
              @if (ssl.certExpires) {
                <span class="font-mono text-[11px] text-slate-400">
                  Scadenza: {{ ssl.certExpires }}
                </span>
              }
            </div>

            <label class="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" [(ngModel)]="sslForceHttps" class="accent-[#38bdf8]" />
              <span>Reindirizza automaticamente HTTP (80) → HTTPS (443)</span>
            </label>

            <div class="grid grid-cols-1 gap-2.5 pt-2 sm:grid-cols-2">
              <div>
                <label class="block text-[11px] text-slate-400">Percorso Certificato (.crt / fullchain.pem)</label>
                <input
                  type="text"
                  [(ngModel)]="sslCertPath"
                  placeholder="/etc/letsencrypt/live/.../fullchain.pem"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                />
              </div>
              <div>
                <label class="block text-[11px] text-slate-400">Percorso Chiave Privata (.key / privkey.pem)</label>
                <input
                  type="text"
                  [(ngModel)]="sslKeyPath"
                  placeholder="/etc/letsencrypt/live/.../privkey.pem"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                />
              </div>
            </div>

            <div class="flex justify-end pt-1">
              <button
                type="button"
                (click)="applyCustomSsl()"
                [disabled]="sslBusy()"
                class="rounded-xl border border-[#38bdf8]/40 bg-[#38bdf8]/15 px-4 py-1.5 text-xs font-semibold text-[#38bdf8] hover:bg-[#38bdf8]/25 disabled:opacity-50"
              >
                Applica Configurazione SSL
              </button>
            </div>
          </div>
        }
      </div>

      <!-- Firewall NAS (UFW) -->
      @if (firewall(); as fw) {
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="flex items-center gap-2.5">
                <h3 class="text-sm font-semibold text-white">Firewall NAS (UFW)</h3>
                <span
                  class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase"
                  [ngClass]="
                    fw.enabled
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-slate-700 text-slate-300'
                  "
                >
                  {{ !fw.installed ? 'Non installato' : fw.enabled ? 'Attivo' : 'Disattivo' }}
                </span>
              </div>
              <p class="mt-0.5 text-[11px] text-slate-400">
                All'attivazione le porte 80 (Web UI) e 22 (SSH) vengono aperte automaticamente per non perdere l'accesso.
              </p>
            </div>

            @if (fw.installed) {
              <button
                type="button"
                (click)="toggleFirewall(!fw.enabled)"
                class="rounded-xl px-4 py-2 text-xs font-semibold transition"
                [ngClass]="
                  fw.enabled
                    ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                    : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                "
              >
                {{ fw.enabled ? 'Disattiva Firewall' : 'Attiva Firewall' }}
              </button>
            }
          </div>

          @if (fw.installed) {
            <!-- Add Rule Form -->
            <div class="flex flex-wrap items-center gap-2.5 border-t border-white/10 pt-4">
              <input
                type="text"
                [(ngModel)]="fwPort"
                placeholder="Porta (es. 445, 8096, 8000:8010)"
                class="w-52 rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
              />
              <select
                [(ngModel)]="fwProtocol"
                class="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white"
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="any">TCP + UDP</option>
              </select>
              <select
                [(ngModel)]="fwAction"
                class="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white"
              >
                <option value="allow">Apri (Allow)</option>
                <option value="deny">Chiudi (Deny)</option>
              </select>
              <button
                type="button"
                (click)="addRule()"
                [disabled]="!fwPort.trim()"
                class="rounded-xl bg-sky-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
              >
                Applica Regola
              </button>
            </div>

            <!-- Active Firewall Rules -->
            @if (fw.rules.length > 0) {
              <div class="overflow-x-auto rounded-xl border border-white/10 bg-black/25">
                <table class="w-full text-left text-xs">
                  <thead class="border-b border-white/10 text-[10px] uppercase text-slate-400">
                    <tr>
                      <th class="px-3 py-2">#</th>
                      <th class="px-3 py-2">Porta / Destinazione</th>
                      <th class="px-3 py-2">Azione</th>
                      <th class="px-3 py-2">Origine</th>
                      <th class="px-3 py-2 text-right">Rimuovi</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-white/5">
                    @for (r of fw.rules; track r.index) {
                      <tr>
                        <td class="px-3 py-2 font-mono text-slate-500">{{ r.index }}</td>
                        <td class="px-3 py-2 font-mono text-white">{{ r.to }}</td>
                        <td class="px-3 py-2">
                          <span
                            class="rounded px-2 py-0.5 text-[10px] font-semibold"
                            [ngClass]="
                              r.action.includes('ALLOW')
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-rose-500/15 text-rose-300'
                            "
                          >
                            {{ r.action }}
                          </span>
                        </td>
                        <td class="px-3 py-2 font-mono text-slate-400">{{ r.from }}</td>
                        <td class="px-3 py-2 text-right">
                          <button
                            type="button"
                            (click)="deleteRule(r.index)"
                            class="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/25"
                          >
                            Elimina
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        </div>
      }

      <!-- System Services -->
      <div>
        <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Servizi di Sistema (systemd)
        </h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          @for (svc of services(); track svc.id) {
            <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-xs font-semibold text-white">
                  {{ svc.label }}
                </span>
                <span
                  class="h-2.5 w-2.5 shrink-0 rounded-full"
                  [ngClass]="svc.active ? 'bg-emerald-400' : 'bg-slate-500'"
                ></span>
              </div>
              <p class="mt-1 text-[11px] text-slate-400">{{ svc.description }}</p>
              <div class="mt-3 flex gap-1.5">
                @if (!svc.active) {
                  <button
                    type="button"
                    (click)="action(svc.id, 'start')"
                    class="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/25"
                  >
                    Avvia
                  </button>
                } @else {
                  <button
                    type="button"
                    (click)="action(svc.id, 'restart')"
                    class="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/15"
                  >
                    Riavvia
                  </button>
                  <button
                    type="button"
                    (click)="action(svc.id, 'stop')"
                    class="rounded-lg bg-rose-500/15 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-rose-500/25"
                  >
                    Stop
                  </button>
                }
              </div>
            </div>
          }
        </div>
      </div>

      <!-- Listening Ports Table -->
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Porte in Ascolto ({{ filteredPorts().length }})
          </h3>
          <input
            type="text"
            [(ngModel)]="portFilter"
            placeholder="Filtra per porta, app o descrizione..."
            class="w-64 rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
          />
        </div>

        <div class="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60">
          <table class="w-full text-left text-xs">
            <thead class="border-b border-white/10 bg-black/30 text-[11px] uppercase text-slate-400">
              <tr>
                <th class="px-4 py-3">Porta</th>
                <th class="px-4 py-3">Applicazione / Container</th>
                <th class="px-4 py-3">Descrizione / A cosa serve</th>
                <th class="px-4 py-3 text-right">Firewall</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              @for (p of filteredPorts(); track p.protocol + ':' + p.port + ':' + p.processName) {
                <tr class="hover:bg-white/[0.03]">
                  <td class="px-4 py-2.5 whitespace-nowrap">
                    <span class="font-mono font-semibold text-sky-300">:{{ p.port }}</span>
                    <span class="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                      {{ p.protocol }}
                    </span>
                  </td>
                  <td class="px-4 py-2.5 whitespace-nowrap">
                    @if (p.containerName) {
                      <span class="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">
                        🐳 {{ p.containerName }}
                      </span>
                    } @else {
                      <span class="font-medium text-white">{{ p.processName }}</span>
                    }
                  </td>
                  <td class="px-4 py-2.5 text-slate-300">
                    {{ p.description }}
                  </td>
                  <td class="px-4 py-2.5 whitespace-nowrap text-right">
                    @if (isPortOpen(p.port, p.protocol)) {
                      <div class="inline-flex items-center gap-2">
                        <span class="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                          ● Aperta
                        </span>
                        <button
                          type="button"
                          (click)="quickPortRule(p.port, p.protocol, 'deny')"
                          class="rounded-lg bg-rose-500/20 px-2.5 py-1 text-[10px] font-semibold text-rose-200 hover:bg-rose-500/35"
                        >
                          Chiudi
                        </button>
                      </div>
                    } @else {
                      <div class="inline-flex items-center gap-2">
                        <span class="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                          ● Chiusa
                        </span>
                        <button
                          type="button"
                          (click)="quickPortRule(p.port, p.protocol, 'allow')"
                          class="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/35"
                        >
                          Apri
                        </button>
                      </div>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- Floating Toast Notification (always visible even when scrolled) -->
      @if (toast(); as t) {
        <div
          class="fixed bottom-5 right-5 z-[90] flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-xs font-medium shadow-2xl backdrop-blur-xl transition-all"
          [ngClass]="
            t.ok
              ? 'border-emerald-500/40 bg-slate-950/95 text-emerald-200'
              : 'border-rose-500/40 bg-slate-950/95 text-rose-200'
          "
        >
          <span>{{ t.ok ? '✓' : '✕' }}</span>
          <span>{{ t.message }}</span>
        </div>
      }
    </div>
  `,
})
export class ServicesManagerComponent implements OnInit {
  private readonly api = inject(ApiService);

  ports = signal<ListeningPort[]>([]);
  services = signal<ManagedSystemService[]>([]);
  firewall = signal<FirewallStatusResponse | null>(null);
  proxyRoutes = signal<ProxyRoute[]>([]);
  sslStatus = signal<SslStatusResponse | null>(null);
  sslBusy = signal(false);
  sslForceHttps = false;
  sslCertPath = '';
  sslKeyPath = '';
  feedback = signal<string | null>(null);
  feedbackOk = signal(true);
  toast = signal<{ message: string; ok: boolean } | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;
  portFilter = '';

  proxyPath = '';
  proxyTarget = '';
  proxyStripPrefix = false;

  fwPort = '';
  fwProtocol: 'tcp' | 'udp' | 'any' = 'tcp';
  fwAction: 'allow' | 'deny' = 'allow';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.getSystemPortsAndServices().subscribe({
      next: (res) => {
        this.ports.set(res.ports);
        this.services.set(res.services);
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore lettura servizi e porte');
      },
    });

    this.api.getFirewallStatus().subscribe({
      next: (fw) => this.firewall.set(fw),
      error: () => { },
    });

    this.api.getProxyRoutes().subscribe({
      next: (res) => this.proxyRoutes.set(res.routes),
      error: () => { },
    });

    this.api.getSslConfig().subscribe({
      next: (res) => {
        this.sslStatus.set(res);
        this.sslForceHttps = res.config.forceHttps;
        this.sslCertPath = res.config.certPath;
        this.sslKeyPath = res.config.keyPath;
      },
      error: () => { },
    });
  }

  generateSelfSigned(): void {
    this.sslBusy.set(true);
    this.api.generateSelfSignedSsl(this.sslForceHttps).subscribe({
      next: () => {
        this.sslBusy.set(false);
        this.feedbackOk.set(true);
        this.feedback.set('Certificato SSL Self-Signed generato e HTTPS (:443) attivato!');
        this.load();
      },
      error: (err) => {
        this.sslBusy.set(false);
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore generazione certificato SSL');
      },
    });
  }

  applyCustomSsl(): void {
    this.sslBusy.set(true);
    this.api
      .saveSslConfig({
        enabled: true,
        forceHttps: this.sslForceHttps,
        mode: 'custom',
        certPath: this.sslCertPath.trim(),
        keyPath: this.sslKeyPath.trim(),
      })
      .subscribe({
        next: () => {
          this.sslBusy.set(false);
          this.feedbackOk.set(true);
          this.feedback.set('Configurazione SSL applicata con successo!');
          this.load();
        },
        error: (err) => {
          this.sslBusy.set(false);
          this.feedbackOk.set(false);
          this.feedback.set(err?.error?.error ?? 'Errore configurazione SSL (eseguito rollback)');
        },
      });
  }

  disableSsl(): void {
    this.sslBusy.set(true);
    this.api.saveSslConfig({ enabled: false, forceHttps: false }).subscribe({
      next: () => {
        this.sslBusy.set(false);
        this.feedbackOk.set(true);
        this.feedback.set('HTTPS disattivato: Nginx attivo su HTTP (:80).');
        this.load();
      },
      error: (err) => {
        this.sslBusy.set(false);
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore disattivazione HTTPS');
      },
    });
  }

  containerPorts(): ListeningPort[] {
    return this.ports().filter((p) => Boolean(p.containerName));
  }

  onContainerQuickPick(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    if (!val) return;
    const [name, port] = val.split('|');
    if (name && port) {
      this.proxyPath = `/${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      this.proxyTarget = `http://127.0.0.1:${port}`;
    }
  }

  addProxyRoute(): void {
    this.api
      .saveProxyRoute({
        path: this.proxyPath,
        target: this.proxyTarget,
        stripPrefix: this.proxyStripPrefix,
      })
      .subscribe({
        next: (res) => {
          this.proxyRoutes.set(res.routes);
          this.feedbackOk.set(true);
          this.feedback.set(
            res.warnings?.length
              ? `Rotta salvata (${res.warnings[0]})`
              : `Rotta Nginx ${this.proxyPath} attivata!`
          );
          this.proxyPath = '';
          this.proxyTarget = '';
        },
        error: (err) => {
          this.feedbackOk.set(false);
          this.feedback.set(err?.error?.error ?? 'Errore salvataggio rotta Nginx');
        },
      });
  }

  removeProxyRoute(slug: string): void {
    this.api.deleteProxyRoute(slug).subscribe({
      next: (res) => {
        this.proxyRoutes.set(res.routes);
        this.feedbackOk.set(true);
        this.feedback.set(`Rotta /${slug} rimossa`);
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore rimozione rotta Nginx');
      },
    });
  }

  filteredPorts(): ListeningPort[] {
    const q = this.portFilter.trim().toLowerCase();
    if (!q) return this.ports();
    return this.ports().filter(
      (p) =>
        String(p.port).includes(q) ||
        p.processName.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.containerName?.toLowerCase().includes(q) ?? false)
    );
  }

  showToast(message: string, ok = true, durationMs = 1500): void {
    this.feedbackOk.set(ok);
    this.feedback.set(message);
    this.toast.set({ message, ok });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.set(null);
    }, durationMs);
  }

  isPortOpen(port: number, protocol: string): boolean {
    const fw = this.firewall();
    if (!fw || !fw.installed) return true;
    const proto = protocol.toLowerCase() === 'udp' ? 'udp' : 'tcp';
    const portStr = String(port);

    for (const r of fw.rules) {
      const target = r.to.replace(/\s*\(v6\)\s*/i, '').trim().toLowerCase();
      const matches = target === `${portStr}/${proto}` || target === portStr;
      if (matches) {
        const act = r.action.toUpperCase();
        if (act.includes('ALLOW')) return true;
        if (act.includes('DENY') || act.includes('REJECT')) return false;
      }
    }
    return !fw.enabled;
  }

  action(name: string, act: 'start' | 'stop' | 'restart'): void {
    this.api.controlSystemService(name, act).subscribe({
      next: () => {
        this.showToast(`Servizio "${name}": ${act} completato`, true);
        this.load();
      },
      error: (err) => {
        this.showToast(err?.error?.error ?? `Errore su "${name}"`, false, 3000);
      },
    });
  }

  toggleFirewall(enabled: boolean): void {
    this.api.toggleFirewall(enabled).subscribe({
      next: (fw) => {
        this.firewall.set(fw);
          this.showToast(
            fw.enabled
              ? 'Firewall attivato (porte 80 e 22 aperte)'
            : 'Firewall disattivato',
            true
          );
      },
      error: (err) => {
        this.showToast(err?.error?.error ?? 'Errore cambio stato firewall', false, 3000);
      },
    });
  }

  addRule(): void {
    this.api.addFirewallRule(this.fwPort, this.fwProtocol, this.fwAction).subscribe({
      next: (fw) => {
        this.firewall.set(fw);
        this.showToast(`Regola firewall applicata su porta ${this.fwPort}`, true);
        this.fwPort = '';
      },
      error: (err) => {
        this.showToast(err?.error?.error ?? 'Errore aggiunta regola firewall', false, 3000);
      },
    });
  }

  quickPortRule(port: number, protocol: string, act: 'allow' | 'deny'): void {
    const proto = protocol.toLowerCase() === 'udp' ? 'udp' : 'tcp';
    this.api.addFirewallRule(port, proto, act).subscribe({
      next: (fw) => {
        this.firewall.set(fw);
        this.showToast(
            `Porta ${port}/${proto} ${act === 'allow' ? 'aperta' : 'chiusa'} nel firewall`,
            true
          );
      },
      error: (err) => {
        this.showToast(err?.error?.error ?? 'Errore regola firewall', false, 3000);
      },
    });
  }

  deleteRule(index: number): void {
    this.api.deleteFirewallRule(index).subscribe({
      next: (fw) => {
        this.firewall.set(fw);
        this.showToast(`Regola #${index} eliminata`, true);
      },
      error: (err) => {
        this.showToast(err?.error?.error ?? 'Errore eliminazione regola', false, 3000);
      },
    });
  }
}
