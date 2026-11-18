import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  FirewallStatusResponse,
  ListeningPort,
  ManagedSystemService,
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
                    <div class="inline-flex gap-1.5">
                      <button
                        type="button"
                        (click)="quickPortRule(p.port, p.protocol, 'allow')"
                        class="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/25"
                      >
                        Apri
                      </button>
                      <button
                        type="button"
                        (click)="quickPortRule(p.port, p.protocol, 'deny')"
                        class="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/25"
                      >
                        Chiudi
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class ServicesManagerComponent implements OnInit {
  private readonly api = inject(ApiService);

  ports = signal<ListeningPort[]>([]);
  services = signal<ManagedSystemService[]>([]);
  firewall = signal<FirewallStatusResponse | null>(null);
  feedback = signal<string | null>(null);
  feedbackOk = signal(true);
  portFilter = '';

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
      error: () => {},
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

  action(name: string, act: 'start' | 'stop' | 'restart'): void {
    this.api.controlSystemService(name, act).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Servizio "${name}": ${act} completato`);
        this.load();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? `Errore su "${name}"`);
      },
    });
  }

  toggleFirewall(enabled: boolean): void {
    this.api.toggleFirewall(enabled).subscribe({
      next: (fw) => {
        this.firewall.set(fw);
        this.feedbackOk.set(true);
        this.feedback.set(
          fw.enabled
            ? 'Firewall attivato (porte 80 e 22 aperte)'
            : 'Firewall disattivato'
        );
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore cambio stato firewall');
      },
    });
  }

  addRule(): void {
    this.api.addFirewallRule(this.fwPort, this.fwProtocol, this.fwAction).subscribe({
      next: (fw) => {
        this.firewall.set(fw);
        this.feedbackOk.set(true);
        this.feedback.set(`Regola firewall applicata su porta ${this.fwPort}`);
        this.fwPort = '';
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore aggiunta regola firewall');
      },
    });
  }

  quickPortRule(port: number, protocol: string, act: 'allow' | 'deny'): void {
    const proto = protocol.toLowerCase() === 'udp' ? 'udp' : 'tcp';
    this.api.addFirewallRule(port, proto, act).subscribe({
      next: (fw) => {
        this.firewall.set(fw);
        this.feedbackOk.set(true);
        this.feedback.set(
          `Porta ${port}/${proto} ${act === 'allow' ? 'aperta' : 'chiusa'} nel firewall`
        );
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore regola firewall');
      },
    });
  }

  deleteRule(index: number): void {
    this.api.deleteFirewallRule(index).subscribe({
      next: (fw) => {
        this.firewall.set(fw);
        this.feedbackOk.set(true);
        this.feedback.set(`Regola #${index} eliminata`);
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore eliminazione regola');
      },
    });
  }
}
