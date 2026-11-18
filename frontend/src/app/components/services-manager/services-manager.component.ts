import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
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
          <h2 class="text-lg font-semibold text-white">Servizi & Porte Attive</h2>
          <p class="text-xs text-slate-400">
            Controlla i servizi systemd del NAS e verifica quali applicazioni o container Docker usano ciascuna porta
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
            placeholder="Filtra per porta, app o container..."
            class="w-64 rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
          />
        </div>

        <div class="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60">
          <table class="w-full text-left text-xs">
            <thead class="border-b border-white/10 bg-black/30 text-[11px] uppercase text-slate-400">
              <tr>
                <th class="px-4 py-3">Porta</th>
                <th class="px-4 py-3">Protocollo</th>
                <th class="px-4 py-3">Indirizzo</th>
                <th class="px-4 py-3">Applicazione / Container</th>
                <th class="px-4 py-3">PID</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              @for (p of filteredPorts(); track p.protocol + ':' + p.port + ':' + p.processName) {
                <tr class="hover:bg-white/[0.03]">
                  <td class="px-4 py-2.5 font-mono font-semibold text-sky-300">
                    :{{ p.port }}
                  </td>
                  <td class="px-4 py-2.5">
                    <span class="rounded bg-white/10 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                      {{ p.protocol }}
                    </span>
                  </td>
                  <td class="px-4 py-2.5 font-mono text-slate-400">{{ p.address }}</td>
                  <td class="px-4 py-2.5">
                    @if (p.containerName) {
                      <span class="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">
                        🐳 {{ p.containerName }}
                      </span>
                      <span class="ml-1.5 text-[10px] text-slate-500">({{ p.processName }})</span>
                    } @else {
                      <span class="font-medium text-white">{{ p.processName }}</span>
                    }
                  </td>
                  <td class="px-4 py-2.5 font-mono text-slate-400">{{ p.pid || '—' }}</td>
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
  feedback = signal<string | null>(null);
  feedbackOk = signal(true);
  portFilter = '';

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
  }

  filteredPorts(): ListeningPort[] {
    const q = this.portFilter.trim().toLowerCase();
    if (!q) return this.ports();
    return this.ports().filter(
      (p) =>
        String(p.port).includes(q) ||
        p.processName.toLowerCase().includes(q) ||
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
}
