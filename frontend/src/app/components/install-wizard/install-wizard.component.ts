import { Component, OnInit, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, InstallTargetDisk } from '../../services/api.service';

@Component({
  selector: 'app-install-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="relative flex min-h-screen flex-col items-center justify-center overflow-x-hidden bg-[#090e1a] px-4 py-8 text-slate-100">
      <!-- Ambient glow -->
      <div class="pointer-events-none fixed inset-0 overflow-hidden">
        <div class="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-sky-500/15 blur-[140px]"></div>
        <div class="absolute -bottom-24 right-0 h-96 w-96 rounded-full bg-emerald-500/10 blur-[140px]"></div>
      </div>

      <div class="relative z-10 w-full max-w-2xl rounded-3xl border border-white/15 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        <!-- Header -->
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
          <div class="flex items-center gap-3">
            <img src="/siloos-icon-disco.svg" alt="SiloOs" class="h-10 w-10 rounded-xl shadow" />
            <div>
              <h1 class="text-lg font-bold text-white">
                Installazione Guidata Silo<span class="text-sky-400">Os</span>
              </h1>
              <p class="text-xs text-slate-400">
                Installazione headless via browser (Dual-Boot BIOS Legacy + UEFI)
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
              Live USB
            </span>
            <span class="rounded-full border border-sky-400/30 bg-sky-500/15 px-2.5 py-1 font-mono text-[11px] text-sky-300">
              {{ bootMode() === 'uefi' ? 'UEFI' : 'BIOS Legacy' }}
            </span>
          </div>
        </div>

        @if (errorMsg()) {
          <div class="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-xs text-rose-200 space-y-2">
            <div>{{ errorMsg() }}</div>
            @if (phase() === 'config' && logs().length > 0) {
              <div class="max-h-44 overflow-y-auto rounded-lg border border-rose-500/20 bg-black/60 p-2.5 font-mono text-[10px] leading-relaxed text-slate-300">
                @for (line of logs().slice(-40); track $index) {
                  <div class="whitespace-pre-wrap break-all">{{ line }}</div>
                }
              </div>
            }
          </div>
        }

        <!-- STEP 1-3: CONFIGURATION FORM -->
        @if (phase() === 'config') {
          <div class="mt-6 space-y-6">
            <!-- Disk Selection -->
            <div>
              <div class="mb-2 flex items-center justify-between">
                <label class="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  1. Seleziona il disco di destinazione
                </label>
                <button
                  type="button"
                  (click)="loadDisks()"
                  [disabled]="loadingDisks()"
                  class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10 disabled:opacity-50"
                >
                  {{ loadingDisks() ? 'Scansione...' : '🔄 Aggiorna dischi' }}
                </button>
              </div>

              @if (disks().length === 0 && !loadingDisks()) {
                <div class="rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-slate-400">
                  Nessun disco rilevato. Collega un SSD/HDD interno o una seconda chiavetta USB e clicca Aggiorna.
                </div>
              } @else {
                <div class="space-y-2">
                  @for (d of disks(); track d.path) {
                    <button
                      type="button"
                      [disabled]="d.isLiveMedium"
                      (click)="selectDisk(d)"
                      class="flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition"
                      [ngClass]="
                        d.isLiveMedium
                          ? 'cursor-not-allowed border-white/5 bg-black/20 opacity-55'
                          : selectedDisk() === d.path
                            ? 'border-sky-400 bg-sky-500/15'
                            : 'border-white/10 bg-black/30 hover:border-white/25 hover:bg-white/5'
                      "
                    >
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="font-mono text-sm font-semibold text-white">{{ d.path }}</span>
                          <span class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                            {{ d.transport }}
                          </span>
                          @if (d.isLiveMedium) {
                            <span class="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                              Chiavetta Live in uso
                            </span>
                          }
                        </div>
                        <div class="mt-0.5 truncate text-xs text-slate-400">{{ d.model }}</div>
                      </div>
                      <div class="shrink-0 pl-3 text-right">
                        <div class="font-mono text-sm font-semibold text-sky-300">
                          {{ formatBytes(d.sizeBytes) }}
                        </div>
                        @if (selectedDisk() === d.path) {
                          <div class="text-[10px] font-semibold text-emerald-400">✓ Selezionato</div>
                        }
                      </div>
                    </button>
                  }
                </div>
              }

              <p class="mt-2 text-[11px] text-slate-400">
                Il disco scelto verrà formattato in GPT con supporto <strong>Dual-Boot BIOS Legacy + UEFI</strong>.
                Per installare su chiavetta USB, inserisci una <strong>seconda chiavetta USB</strong> diversa da quella Live.
              </p>
            </div>

            <!-- Account & Hostname -->
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label class="mb-1 block text-xs font-semibold text-slate-300">
                  2. Nome NAS (Hostname)
                </label>
                <input
                  type="text"
                  [(ngModel)]="hostname"
                  placeholder="siloos"
                  class="w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
                />
                <span class="mt-1 block text-[10px] text-slate-500">
                  Raggiungibile come http://{{ hostname || 'siloos' }}.local
                </span>
              </div>

              <div>
                <label class="mb-1 block text-xs font-semibold text-slate-300">
                  3. Utente Amministratore
                </label>
                <input
                  type="text"
                  [(ngModel)]="username"
                  placeholder="nas"
                  class="w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
                />
                <span class="mt-1 block text-[10px] text-slate-500">
                  Lettere minuscole, numeri, _ o -
                </span>
              </div>

              <div>
                <label class="mb-1 block text-xs font-semibold text-slate-300">
                  Password Amministratore
                </label>
                <input
                  type="password"
                  [(ngModel)]="password"
                  placeholder="Minimo 6 caratteri"
                  class="w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
                />
              </div>

              <div>
                <label class="mb-1 block text-xs font-semibold text-slate-300">
                  Conferma Password
                </label>
                <input
                  type="password"
                  [(ngModel)]="confirmPassword"
                  placeholder="Ripeti la password"
                  class="w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
                />
              </div>
            </div>

            <!-- Warning & Confirm -->
            <div class="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
              <label class="flex cursor-pointer items-start gap-3 text-xs text-rose-100">
                <input
                  type="checkbox"
                  [(ngModel)]="confirmWipe"
                  class="mt-0.5 h-4 w-4 rounded border-rose-400 bg-black/40 text-sky-500"
                />
                <span>
                  Confermo che <strong>tutti i dati presenti su {{ selectedDisk() || 'il disco selezionato' }}</strong>
                  verranno cancellati definitivamente per installare SiloOs.
                </span>
              </label>
            </div>

            <div class="flex justify-end">
              <button
                type="button"
                (click)="startInstall()"
                [disabled]="!canStartInstall()"
                class="rounded-xl bg-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                🚀 Avvia Installazione su Disco
              </button>
            </div>
          </div>
        }

        <!-- PHASE: INSTALLING -->
        @if (phase() === 'installing') {
          <div class="mt-6 space-y-5">
            <div>
              <div class="flex items-center justify-between text-xs">
                <span class="font-semibold text-sky-300">{{ currentStepLabel() }}</span>
                <span class="font-mono text-slate-400">{{ progressPercent() }}%</span>
              </div>
              <div class="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  class="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-500"
                  [style.width.%]="progressPercent()"
                ></div>
              </div>
            </div>

            <div class="max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/60 p-3.5 font-mono text-[11px] leading-relaxed text-slate-300">
              @for (line of logs(); track $index) {
                <div class="whitespace-pre-wrap break-all">{{ line }}</div>
              }
            </div>

            <p class="text-center text-xs text-slate-400">
              Non spegnere il NAS e non rimuovere la chiavetta USB finché l'installazione non è terminata.
            </p>
          </div>
        }

        <!-- PHASE: DONE -->
        @if (phase() === 'done') {
          <div class="mt-6 space-y-5 text-center">
            <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/20 text-3xl text-emerald-400">
              ✅
            </div>
            <div>
              <h2 class="text-xl font-bold text-white">Installazione Completata!</h2>
              <p class="mt-1.5 text-sm text-slate-300">
                SiloOs è stato installato su <span class="font-mono text-sky-300">{{ selectedDisk() }}</span>
                con bootloader <strong>BIOS Legacy + UEFI</strong>.
              </p>
            </div>

            <div class="rounded-2xl border border-white/10 bg-black/30 p-4 text-left text-xs text-slate-300 space-y-1.5">
              <div><strong>1.</strong> Clicca <strong>Spegni NAS</strong> qui sotto (consigliato).</div>
              <div><strong>2.</strong> Rimuovi la chiavetta USB Live dal NAS.</div>
              <div>
                <strong>3.</strong> Riaccendi il NAS e collegati a
                <span class="font-mono text-sky-300">http://{{ hostname || 'siloos' }}.local</span>
                con l'utente <span class="font-mono text-emerald-300">{{ username }}</span>.
              </div>
            </div>

            @if (powerMessage()) {
              <div class="rounded-xl border border-sky-400/30 bg-sky-500/15 px-4 py-3 text-xs text-sky-200">
                {{ powerMessage() }}
              </div>
            } @else {
              <div class="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  (click)="triggerPower('poweroff')"
                  class="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  ⏻ Spegni NAS (rimuovi USB)
                </button>
                <button
                  type="button"
                  (click)="triggerPower('reboot')"
                  class="rounded-xl border border-white/15 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/20"
                >
                  🔄 Riavvia NAS
                </button>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class InstallWizardComponent implements OnInit {
  private readonly api = inject(ApiService);

  initialBootMode = input<'uefi' | 'bios'>('uefi');

  phase = signal<'config' | 'installing' | 'done'>('config');
  bootMode = signal<'uefi' | 'bios'>('uefi');
  disks = signal<InstallTargetDisk[]>([]);
  loadingDisks = signal(false);
  selectedDisk = signal<string>('');
  errorMsg = signal<string | null>(null);

  hostname = 'siloos';
  username = 'nas';
  password = '';
  confirmPassword = '';
  confirmWipe = false;

  currentStep = signal(0);
  totalSteps = signal(5);
  currentStepLabel = signal('Preparazione installazione...');
  logs = signal<string[]>([]);
  powerMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.bootMode.set(this.initialBootMode());
    this.loadDisks();
  }

  loadDisks(): void {
    this.loadingDisks.set(true);
    this.errorMsg.set(null);
    this.api.getInstallDisks().subscribe({
      next: (res) => {
        this.bootMode.set(res.bootMode);
        this.disks.set(res.disks);
        this.loadingDisks.set(false);
        const firstValid = res.disks.find((d) => !d.isLiveMedium);
        if (!this.selectedDisk() && firstValid) {
          this.selectedDisk.set(firstValid.path);
        }
      },
      error: (err) => {
        this.loadingDisks.set(false);
        this.errorMsg.set(err?.error?.error || 'Impossibile elencare i dischi del sistema.');
      },
    });
  }

  selectDisk(disk: InstallTargetDisk): void {
    if (disk.isLiveMedium) return;
    this.selectedDisk.set(disk.path);
  }

  canStartInstall(): boolean {
    return (
      Boolean(this.selectedDisk()) &&
      /^[a-z_][a-z0-9_-]{1,30}$/.test(this.username.trim()) &&
      /^[a-zA-Z0-9-]{1,63}$/.test(this.hostname.trim()) &&
      this.password.length >= 6 &&
      this.password === this.confirmPassword &&
      this.confirmWipe
    );
  }

  progressPercent(): number {
    const total = Math.max(1, this.totalSteps());
    return Math.min(100, Math.round((this.currentStep() / total) * 100));
  }

  async startInstall(): Promise<void> {
    this.errorMsg.set(null);
    if (this.password !== this.confirmPassword) {
      this.errorMsg.set('Le password non coincidono.');
      return;
    }
    if (!this.canStartInstall()) {
      this.errorMsg.set('Compila tutti i campi richiesti e spunta la conferma.');
      return;
    }

    this.phase.set('installing');
    this.currentStep.set(0);
    this.logs.set([]);

    try {
      await this.api.runWebInstall(
        {
          targetDisk: this.selectedDisk(),
          username: this.username.trim(),
          password: this.password,
          hostname: this.hostname.trim(),
        },
        (evt) => {
          if (evt.type === 'step') {
            if (typeof evt.step === 'number') this.currentStep.set(evt.step);
            if (typeof evt.total === 'number') this.totalSteps.set(evt.total);
            if (evt.label) this.currentStepLabel.set(evt.label);
          } else if (evt.type === 'log' && evt.message) {
            this.logs.update((list) => [...list.slice(-200), evt.message!]);
          } else if (evt.type === 'error' && evt.message) {
            this.errorMsg.set(evt.message);
          } else if (evt.type === 'done') {
            if (evt.success) {
              this.phase.set('done');
            } else {
              this.errorMsg.set(
                `Installazione terminata con errore (codice ${evt.exitCode ?? 1}). Controlla i log sopra.`
              );
              this.phase.set('config');
            }
          }
        }
      );
    } catch (err) {
      this.errorMsg.set(err instanceof Error ? err.message : 'Errore durante l\'installazione');
      this.phase.set('config');
    }
  }

  triggerPower(action: 'reboot' | 'poweroff'): void {
    this.api.triggerInstallPower(action).subscribe({
      next: () => {
        this.powerMessage.set(
          action === 'poweroff'
            ? 'Spegnimento del NAS in corso... Attendi che si spenga, rimuovi la chiavetta USB e riaccendilo.'
            : 'Riavvio del NAS in corso... Rimuovi la chiavetta USB e attendi circa 30 secondi.'
        );
      },
      error: () => {
        this.errorMsg.set('Impossibile inviare il comando di spegnimento/riavvio.');
      },
    });
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let val = bytes;
    let idx = 0;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx++;
    }
    return `${val.toFixed(val >= 10 ? 1 : 2)} ${units[idx]}`;
  }
}
