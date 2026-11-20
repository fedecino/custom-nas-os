import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  FanMode,
  FanProfile,
  FanStatusResponse,
} from '../../services/api.service';

@Component({
  selector: 'app-fan-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-5">
      <!-- Header -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="flex items-center gap-2.5">
              <h3 class="text-sm font-semibold text-white">Ventole & Temperature (hwmon)</h3>
              @if (status(); as st) {
                <span
                  class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase"
                  [ngClass]="
                    st.pwms.length > 0
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-amber-500/20 text-amber-300'
                  "
                >
                  {{ st.pwms.length > 0 ? st.pwms.length + ' Canali PWM' : 'Solo Lettura / BIOS' }}
                </span>
              }
            </div>
            <p class="mt-0.5 text-xs text-slate-400">
              Monitora le temperature in tempo reale e regola la velocità delle ventole con protezione termica automatica (failsafe a 75 °C).
            </p>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              (click)="installAndProbeSensors()"
              [disabled]="probing()"
              class="rounded-xl border border-[#38bdf8]/40 bg-[#38bdf8]/15 px-3.5 py-1.5 text-xs font-medium text-[#38bdf8] hover:bg-[#38bdf8]/25 disabled:opacity-50"
            >
              {{ probing() ? 'Rilevamento...' : '🔍 Rileva Sensori / lm-sensors' }}
            </button>
            <button
              type="button"
              (click)="loadStatus()"
              class="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
            >
              ↻ Aggiorna
            </button>
          </div>
        </div>
      </div>

      @if (feedback()) {
        <div
          class="rounded-xl border px-4 py-2.5 text-xs"
          [ngClass]="
            feedbackOk()
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          "
        >
          {{ feedback() }}
        </div>
      }

      <!-- Live Temperatures & Fans -->
      @if (status(); as st) {
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <!-- Temperatures -->
          <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 space-y-3">
            <div class="flex items-center justify-between">
              <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Temperature Rilevate
              </h4>
              @if (st.maxTempC !== null) {
                <span
                  class="font-mono text-xs font-semibold"
                  [ngClass]="
                    st.maxTempC >= 70
                      ? 'text-rose-400'
                      : st.maxTempC >= 55
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                  "
                >
                  Max: {{ st.maxTempC }} °C
                </span>
              }
            </div>

            @if (st.temps.length === 0) {
              <p class="text-xs text-slate-400">
                Nessun sensore di temperatura rilevato. Clicca <strong>Rileva Sensori</strong>.
              </p>
            } @else {
              <div class="grid grid-cols-2 gap-2">
                @for (t of st.temps; track t.id) {
                  <div class="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                    <div class="truncate text-[11px] text-slate-400">{{ t.label }}</div>
                    <div
                      class="mt-0.5 font-mono text-sm font-bold"
                      [ngClass]="
                        t.tempC >= 70
                          ? 'text-rose-400'
                          : t.tempC >= 55
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                      "
                    >
                      {{ t.tempC }} °C
                    </div>
                  </div>
                }
              </div>
            }
          </div>

          <!-- Fans RPM & PWM -->
          <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 space-y-3">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Ventole & Canali PWM
            </h4>

            @if (st.fans.length === 0 && st.pwms.length === 0) {
              <p class="text-xs text-slate-400">
                Nessuna ventola o canale PWM esposto dal kernel. Su NAS come TerraMaster prova <strong>Rileva Sensori</strong> (carica i moduli <span class="font-mono text-sky-300">it87</span> / <span class="font-mono text-sky-300">nct6775</span>).
              </p>
            } @else {
              <div class="space-y-2">
                @for (f of st.fans; track f.id) {
                  <div class="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-xs">
                    <span class="text-slate-300">🌀 {{ f.label }}</span>
                    <span class="font-mono font-semibold text-[#38bdf8]">{{ f.rpm }} RPM</span>
                  </div>
                }
                @for (p of st.pwms; track p.id) {
                  <div class="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-xs">
                    <span class="font-mono text-slate-300">{{ p.chip }} ({{ p.id.split(':')[1] }})</span>
                    <span class="font-mono font-semibold text-emerald-300">{{ p.percent }}%</span>
                  </div>
                }
              </div>
            }
          </div>
        </div>

        <!-- Fan Control Mode Configuration -->
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 class="text-sm font-semibold text-white">Modalità di Controllo Ventole</h4>
              <p class="text-xs text-slate-400">
                Scegli se lasciare la gestione al BIOS oppure usare il controller integrato di SiloOs
              </p>
            </div>

            <div class="inline-flex rounded-xl border border-white/10 bg-slate-950/70 p-1 text-xs">
              <button
                type="button"
                (click)="mode = 'bios'"
                class="rounded-lg px-3 py-1.5 font-medium transition"
                [ngClass]="mode === 'bios' ? 'bg-[#38bdf8] text-[#090e1a] font-semibold' : 'text-slate-300 hover:text-white'"
              >
                BIOS (Auto)
              </button>
              <button
                type="button"
                (click)="mode = 'curve'"
                class="rounded-lg px-3 py-1.5 font-medium transition"
                [ngClass]="mode === 'curve' ? 'bg-[#38bdf8] text-[#090e1a] font-semibold' : 'text-slate-300 hover:text-white'"
              >
                Curva SiloOs
              </button>
              <button
                type="button"
                (click)="mode = 'manual'"
                class="rounded-lg px-3 py-1.5 font-medium transition"
                [ngClass]="mode === 'manual' ? 'bg-[#38bdf8] text-[#090e1a] font-semibold' : 'text-slate-300 hover:text-white'"
              >
                Manuale
              </button>
            </div>
          </div>

          @if (mode === 'bios') {
            <div class="rounded-xl border border-white/10 bg-black/25 p-3.5 text-xs text-slate-300">
              Le ventole vengono gestite automaticamente dal firmware/BIOS della scheda madre (<span class="font-mono text-sky-300">pwm_enable = 2</span>).
            </div>
          } @else if (mode === 'curve') {
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              @for (prof of profiles; track prof.id) {
                <button
                  type="button"
                  (click)="profile = prof.id"
                  class="rounded-xl border p-3.5 text-left transition"
                  [ngClass]="
                    profile === prof.id
                      ? 'border-[#38bdf8] bg-[#38bdf8]/15 text-white'
                      : 'border-white/10 bg-black/25 text-slate-300 hover:bg-white/10'
                  "
                >
                  <div class="text-xs font-semibold text-white">{{ prof.icon }} {{ prof.label }}</div>
                  <div class="mt-1 text-[11px] text-slate-400">{{ prof.desc }}</div>
                </button>
              }
            </div>
          } @else {
            <div class="rounded-xl border border-white/10 bg-black/25 p-4 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-300">Velocità Ventola Manuale (min. 25% per sicurezza)</span>
                <span class="font-mono text-sm font-bold text-[#38bdf8]">{{ manualPercent }}%</span>
              </div>
              <input
                type="range"
                min="25"
                max="100"
                step="5"
                [(ngModel)]="manualPercent"
                class="w-full accent-[#38bdf8]"
              />
              <p class="text-[11px] text-amber-300/90">
                Sicurezza attiva: se la temperatura supera 78 °C, le ventole passano automaticamente al 100%.
              </p>
            </div>
          }

          <div class="flex justify-end">
            <button
              type="button"
              (click)="saveConfig()"
              [disabled]="saving()"
              class="rounded-xl bg-[#00ff88] px-5 py-2 text-xs font-semibold text-[#062417] hover:brightness-110 disabled:opacity-50"
            >
              {{ saving() ? 'Applicazione...' : 'Applica Configurazione Ventole' }}
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class FanManagerComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);

  status = signal<FanStatusResponse | null>(null);
  saving = signal(false);
  probing = signal(false);
  feedback = signal<string | null>(null);
  feedbackOk = signal(true);

  mode: FanMode = 'bios';
  profile: FanProfile = 'balanced';
  manualPercent = 50;

  profiles: Array<{ id: FanProfile; label: string; icon: string; desc: string }> = [
    {
      id: 'silent',
      label: 'Silenzioso',
      icon: '🔇',
      desc: '30% fino a 45°C, sale gradualmente, 100% sopra 75°C.',
    },
    {
      id: 'balanced',
      label: 'Bilanciato',
      icon: '⚖️',
      desc: '40% fino a 40°C, 60% a 50°C, 100% sopra 70°C.',
    },
    {
      id: 'performance',
      label: 'Raffreddamento Max',
      icon: '❄️',
      desc: '60% base, 90% a 55°C, 100% sopra 65°C.',
    },
  ];

  private pollTimer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.loadStatus(true);
    this.pollTimer = setInterval(() => this.loadStatus(false), 5000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  loadStatus(syncForm = false): void {
    this.api.getFanStatus().subscribe({
      next: (res) => {
        this.status.set(res);
        if (syncForm) {
          this.mode = res.config.mode;
          this.profile = res.config.profile;
          this.manualPercent = res.config.manualPercent;
        }
      },
      error: () => {},
    });
  }

  saveConfig(): void {
    this.saving.set(true);
    this.feedback.set(null);
    this.api
      .saveFanConfig({
        mode: this.mode,
        profile: this.profile,
        manualPercent: this.manualPercent,
      })
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          if (res.warnings?.length) {
            this.feedbackOk.set(false);
            this.feedback.set(res.warnings[0]);
          } else {
            this.feedbackOk.set(true);
            this.feedback.set(
              res.targetPercent !== null
                ? `Configurazione ventole applicata (${res.targetPercent}% su ${res.appliedCount} canali PWM)`
                : `Controllo ventole impostato su Automatico (BIOS)`
            );
          }
          this.loadStatus(false);
        },
        error: (err) => {
          this.saving.set(false);
          this.feedbackOk.set(false);
          this.feedback.set(err?.error?.error ?? 'Errore salvataggio controllo ventole');
        },
      });
  }

  installAndProbeSensors(): void {
    this.probing.set(true);
    this.feedback.set(null);
    this.api.installFanSensors().subscribe({
      next: () => {
        this.probing.set(false);
        this.feedbackOk.set(true);
        this.feedback.set('Rilevamento sensori e moduli kernel (coretemp, it87, nct6775) completato!');
        this.loadStatus(false);
      },
      error: (err) => {
        this.probing.set(false);
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore rilevamento sensori');
      },
    });
  }
}
