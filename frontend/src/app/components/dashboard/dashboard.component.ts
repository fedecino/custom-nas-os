import {
  Component,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ApiService,
  ContainerInfo,
  StackInfo,
  SystemInfo,
} from '../../services/api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight text-white">
            System Dashboard
          </h1>
          <p class="text-sm text-slate-400">
            Telemetria hardware, dischi montati e gestione container Docker
          </p>
        </div>
        <div class="flex items-center gap-3">
          @if (systemInfo(); as sys) {
            <span
              class="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300"
            >
              <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              {{ sys.hostname }} · {{ sys.osName }}
            </span>
          }
          <button
            (click)="refreshAll()"
            [disabled]="loading()"
            class="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
          >
            <svg
              class="h-4 w-4"
              [class.animate-spin]="loading()"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Aggiorna
          </button>
        </div>
      </div>

      <!-- Telemetry Cards -->
      @if (systemInfo(); as sys) {
        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <!-- CPU -->
          <div
            class="rounded-2xl border border-nas-border bg-nas-card/90 p-5 shadow-lg backdrop-blur"
          >
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium uppercase tracking-wider text-slate-400">
                CPU Load
              </span>
              <span class="rounded-md bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-300">
                {{ sys.cpu.cores }} vCPU
              </span>
            </div>
            <div class="mt-3 flex items-baseline gap-2">
              <span class="text-3xl font-bold text-white">
                {{ sys.cpu.usagePercent }}%
              </span>
              <span class="text-xs text-slate-400">
                load: {{ sys.cpu.loadAverage.join(' / ') }}
              </span>
            </div>
            <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                class="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-300 transition-all duration-500"
                [style.width.%]="Math.min(100, sys.cpu.usagePercent)"
              ></div>
            </div>
            <p class="mt-3 truncate text-xs text-slate-400" [title]="sys.cpu.model">
              {{ sys.cpu.model }}
            </p>
          </div>

          <!-- RAM -->
          <div
            class="rounded-2xl border border-nas-border bg-nas-card/90 p-5 shadow-lg backdrop-blur"
          >
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium uppercase tracking-wider text-slate-400">
                Memoria RAM
              </span>
              <span class="rounded-md bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-300">
                {{ formatBytes(sys.memory.totalBytes) }}
              </span>
            </div>
            <div class="mt-3 flex items-baseline gap-2">
              <span class="text-3xl font-bold text-white">
                {{ sys.memory.usedPercent }}%
              </span>
              <span class="text-xs text-slate-400">
                {{ formatBytes(sys.memory.usedBytes) }} usati
              </span>
            </div>
            <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                class="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-400 transition-all duration-500"
                [style.width.%]="Math.min(100, sys.memory.usedPercent)"
              ></div>
            </div>
            <p class="mt-3 text-xs text-slate-400">
              Disponibile: {{ formatBytes(sys.memory.availableBytes) }}
            </p>
          </div>

          <!-- Uptime & Containers Summary -->
          <div
            class="rounded-2xl border border-nas-border bg-nas-card/90 p-5 shadow-lg backdrop-blur"
          >
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium uppercase tracking-wider text-slate-400">
                Sistema & Docker
              </span>
              <span class="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                {{ sys.arch }}
              </span>
            </div>
            <div class="mt-3 flex items-baseline gap-2">
              <span class="text-3xl font-bold text-white">
                {{ stacks().length }}
              </span>
              <span class="text-sm text-slate-400">stack configurati</span>
            </div>
            <div class="mt-3 flex items-center gap-4 text-xs text-slate-300">
              <span>
                Container attivi:
                <strong class="text-emerald-400">{{ runningContainersCount() }}</strong>
              </span>
              <span>
                Totali:
                <strong class="text-white">{{ totalContainersCount() }}</strong>
              </span>
            </div>
            <p class="mt-3 text-xs text-slate-400">
              Uptime: {{ formatUptime(sys.uptimeSeconds) }} · Kernel {{ sys.kernel }}
            </p>
          </div>
        </div>

        <!-- Mounted Disks -->
        <div class="rounded-2xl border border-nas-border bg-nas-card/90 p-5 shadow-lg">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Dischi & Volumi Montati
          </h2>
          @if (sys.disks.length === 0) {
            <p class="mt-3 text-sm text-slate-400">Nessun disco montato rilevato.</p>
          } @else {
            <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              @for (disk of sys.disks; track disk.mountpoint) {
                <div
                  class="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="truncate font-mono text-xs font-semibold text-sky-300">
                      {{ disk.mountpoint }}
                    </span>
                    <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {{ disk.fsType }}
                    </span>
                  </div>
                  <div class="mt-1 truncate text-[11px] text-slate-500">
                    {{ disk.filesystem }}
                  </div>
                  <div class="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      class="h-full rounded-full transition-all"
                      [class.bg-emerald-400]="disk.usedPercent < 75"
                      [class.bg-amber-400]="disk.usedPercent >= 75 && disk.usedPercent < 90"
                      [class.bg-rose-500]="disk.usedPercent >= 90"
                      [style.width.%]="disk.usedPercent"
                    ></div>
                  </div>
                  <div class="mt-2 flex justify-between text-xs text-slate-400">
                    <span>{{ formatBytes(disk.usedBytes) }} / {{ formatBytes(disk.sizeBytes) }}</span>
                    <span class="font-medium text-slate-200">{{ disk.usedPercent }}%</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Active Stacks -->
      <div class="rounded-2xl border border-nas-border bg-nas-card/90 p-5 shadow-lg">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-300">
            App & Stack Docker (/DATA/Stacks)
          </h2>
          <button
            (click)="openAppStore.emit()"
            class="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-sky-400"
          >
            <span>+ Nuova App da Docker Hub</span>
          </button>
        </div>

        @if (actionError()) {
          <div
            class="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200"
          >
            {{ actionError() }}
          </div>
        }

        @if (stacks().length === 0 && standaloneContainers().length === 0) {
          <div
            class="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 py-12 text-center"
          >
            <p class="text-sm font-medium text-slate-300">
              Nessun container o stack Docker presente
            </p>
            <p class="mt-1 text-xs text-slate-500">
              Apri l'App Store per cercare un'immagine su Docker Hub e generare il tuo primo stack.
            </p>
            <button
              (click)="openAppStore.emit()"
              class="mt-4 rounded-lg border border-sky-500/40 bg-sky-500/15 px-4 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
            >
              Esplora Docker App Store
            </button>
          </div>
        } @else {
          <div class="mt-4 space-y-3">
            @for (stack of stacks(); track stack.name) {
              <div
                class="rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-slate-700"
              >
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="flex items-center gap-3">
                    <span
                      class="h-2.5 w-2.5 rounded-full"
                      [class.bg-emerald-400]="stack.status === 'running'"
                      [class.bg-amber-400]="stack.status === 'partial'"
                      [class.bg-slate-500]="stack.status === 'stopped'"
                    ></span>
                    <div>
                      <div class="flex items-center gap-2">
                        <h3 class="font-semibold text-white">{{ stack.name }}</h3>
                        <span
                          class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                          [ngClass]="{
                            'bg-emerald-500/15 text-emerald-300': stack.status === 'running',
                            'bg-amber-500/15 text-amber-300': stack.status === 'partial',
                            'bg-slate-700 text-slate-300': stack.status === 'stopped'
                          }"
                        >
                          {{ stack.status }}
                        </span>
                      </div>
                      <p class="font-mono text-[11px] text-slate-500">
                        {{ stack.composePath }}
                      </p>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center gap-2">
                    @if (stack.status !== 'running') {
                      <button
                        (click)="runAction(stack.name, 'start')"
                        [disabled]="busyStack() === stack.name"
                        class="rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                      >
                        Avvia
                      </button>
                    }
                    @if (stack.status !== 'stopped') {
                      <button
                        (click)="runAction(stack.name, 'stop')"
                        [disabled]="busyStack() === stack.name"
                        class="rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
                      >
                        Stop
                      </button>
                      <button
                        (click)="runAction(stack.name, 'restart')"
                        [disabled]="busyStack() === stack.name"
                        class="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                      >
                        Riavvia
                      </button>
                    }
                    @if (stack.hasComposeFile) {
                      <button
                        (click)="editStack.emit(stack.name)"
                        class="rounded-lg bg-sky-500/15 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
                      >
                        YAML
                      </button>
                      <button
                        (click)="viewLogs.emit(stack.name)"
                        class="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                      >
                        Logs
                      </button>
                      <button
                        (click)="runAction(stack.name, 'remove')"
                        [disabled]="busyStack() === stack.name"
                        class="rounded-lg bg-rose-500/15 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
                      >
                        Rimuovi
                      </button>
                    }
                  </div>
                </div>

                @if (stack.containers.length > 0) {
                  <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    @for (c of stack.containers; track c.id) {
                      <div
                        class="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2 text-xs"
                      >
                        <div class="min-w-0">
                          <div class="truncate font-medium text-slate-200">
                            {{ c.name }}
                          </div>
                          <div class="truncate font-mono text-[11px] text-slate-500">
                            {{ c.image }}
                          </div>
                        </div>
                        <div class="ml-3 text-right">
                          <div
                            class="text-[11px] font-medium"
                            [class.text-emerald-400]="c.state === 'running'"
                            [class.text-slate-400]="c.state !== 'running'"
                          >
                            {{ c.status }}
                          </div>
                          @if (c.ports) {
                            <div class="max-w-[180px] truncate font-mono text-[10px] text-sky-400">
                              {{ c.ports }}
                            </div>
                          }
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            }

            @if (standaloneContainers().length > 0) {
              <div class="mt-4 pt-3 border-t border-slate-800">
                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Container Standalone
                </h3>
                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                  @for (c of standaloneContainers(); track c.id) {
                    <div
                      class="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-2.5 text-xs"
                    >
                      <div class="min-w-0">
                        <div class="truncate font-medium text-white">{{ c.name }}</div>
                        <div class="truncate font-mono text-[11px] text-slate-500">
                          {{ c.image }}
                        </div>
                      </div>
                      <span
                        class="ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        [ngClass]="
                          c.state === 'running'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-slate-800 text-slate-400'
                        "
                      >
                        {{ c.status }}
                      </span>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  protected readonly Math = Math;

  @Output() openAppStore = new EventEmitter<void>();
  @Output() editStack = new EventEmitter<string>();
  @Output() viewLogs = new EventEmitter<string>();

  systemInfo = signal<SystemInfo | null>(null);
  stacks = signal<StackInfo[]>([]);
  standaloneContainers = signal<ContainerInfo[]>([]);
  loading = signal(false);
  busyStack = signal<string | null>(null);
  actionError = signal<string | null>(null);

  private refreshTimer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.refreshAll();
    this.refreshTimer = setInterval(() => this.refreshAll(true), 5000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  refreshAll(silent = false): void {
    if (!silent) this.loading.set(true);

    this.api.getSystemInfo().subscribe({
      next: (info) => this.systemInfo.set(info),
      error: () => {},
    });

    this.api.getStacks().subscribe({
      next: (res) => {
        this.stacks.set(res.stacks);
        this.standaloneContainers.set(res.standaloneContainers);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  runningContainersCount(): number {
    const stackRunning = this.stacks().reduce(
      (sum, s) => sum + s.containers.filter((c) => c.state === 'running').length,
      0
    );
    const standaloneRunning = this.standaloneContainers().filter(
      (c) => c.state === 'running'
    ).length;
    return stackRunning + standaloneRunning;
  }

  totalContainersCount(): number {
    const stackTotal = this.stacks().reduce((sum, s) => sum + s.containers.length, 0);
    return stackTotal + this.standaloneContainers().length;
  }

  runAction(stackName: string, action: 'start' | 'stop' | 'restart' | 'remove'): void {
    if (
      action === 'remove' &&
      !confirm(`Rimuovere lo stack "${stackName}" e fermare i suoi container?`)
    ) {
      return;
    }

    this.busyStack.set(stackName);
    this.actionError.set(null);

    this.api.stackAction(stackName, action).subscribe({
      next: () => {
        this.busyStack.set(null);
        this.refreshAll();
      },
      error: (err) => {
        this.busyStack.set(null);
        this.actionError.set(err?.error?.error ?? `Azione "${action}" fallita su ${stackName}`);
      },
    });
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
  }

  formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }
}
