import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  BackupJob,
  BackupRepositoryView,
  BackupStatusResponse,
  MountedDisk,
  NetworkMountEntry,
  ResticSnapshot,
} from '../../services/api.service';
import { DialogService } from '../../services/dialog.service';

type BackupTab = 'jobs' | 'repos' | 'snapshots';

@Component({
  selector: 'app-backup-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-5">
      <!-- Header & Restic Status -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="flex items-center gap-2.5">
              <h3 class="text-sm font-semibold text-white">Backup Cifrati & Deduplicati (Restic)</h3>
              @if (status(); as st) {
                <span
                  class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase"
                  [ngClass]="
                    st.installed
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-amber-500/20 text-amber-300'
                  "
                >
                  {{ st.installed ? 'Restic Pronto' : 'Restic Non Installato' }}
                </span>
              }
            </div>
            <p class="mt-0.5 text-xs text-slate-400">
              @if (status()?.version) {
                {{ status()?.version }} · Backup incrementali cifrati su disco locale/USB, SFTP o Cloud S3.
              } @else {
                Configura repository cifrati, backup pianificati automatici e ripristino snapshot.
              }
            </p>
          </div>

          <div class="flex items-center gap-2">
            @if (status() && !status()!.installed) {
              <button
                type="button"
                (click)="installRestic()"
                [disabled]="installingRestic()"
                class="rounded-xl bg-[#00ff88] px-4 py-2 text-xs font-semibold text-[#062417] hover:brightness-110 disabled:opacity-50"
              >
                {{ installingRestic() ? 'Installazione Restic...' : '⬇ Installa Restic' }}
              </button>
            }
            <button
              type="button"
              (click)="loadStatus()"
              class="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
            >
              ↻ Aggiorna
            </button>
          </div>
        </div>

        <!-- Horizontal Tabs -->
        <div class="mt-4 flex items-center gap-2 overflow-x-auto border-b border-white/10 text-xs">
          <button
            type="button"
            (click)="activeTab.set('jobs')"
            class="whitespace-nowrap border-b-2 px-3.5 py-2 font-medium transition"
            [ngClass]="
              activeTab() === 'jobs'
                ? 'border-[#38bdf8] text-[#38bdf8] font-semibold'
                : 'border-transparent text-slate-400 hover:text-white'
            "
          >
            🕒 Job di Backup ({{ status()?.jobs?.length ?? 0 }})
          </button>
          <button
            type="button"
            (click)="activeTab.set('repos')"
            class="whitespace-nowrap border-b-2 px-3.5 py-2 font-medium transition"
            [ngClass]="
              activeTab() === 'repos'
                ? 'border-[#38bdf8] text-[#38bdf8] font-semibold'
                : 'border-transparent text-slate-400 hover:text-white'
            "
          >
            🗄️ Repository ({{ status()?.repos?.length ?? 0 }})
          </button>
          <button
            type="button"
            (click)="openSnapshotsTab()"
            class="whitespace-nowrap border-b-2 px-3.5 py-2 font-medium transition"
            [ngClass]="
              activeTab() === 'snapshots'
                ? 'border-[#38bdf8] text-[#38bdf8] font-semibold'
                : 'border-transparent text-slate-400 hover:text-white'
            "
          >
            📸 Snapshot & Ripristino
          </button>
        </div>
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
          <div>{{ feedback() }}</div>
          @if (lastOutput()) {
            <pre class="mt-2 max-h-40 overflow-auto rounded-lg bg-black/50 p-2.5 font-mono text-[11px] text-slate-300">{{ lastOutput() }}</pre>
          }
        </div>
      }

      <!-- TAB 1: BACKUP JOBS -->
      @if (activeTab() === 'jobs') {
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
          <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Nuovo Job di Backup
          </h4>

          @if ((status()?.repos?.length ?? 0) === 0) {
            <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              Crea prima almeno un <strong>Repository Restic</strong> nella scheda <strong>🗄️ Repository</strong> (es. un disco esterno USB, una cartella locale, un server SFTP o uno spazio S3).
            </div>
          } @else {
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label class="block text-xs font-medium text-slate-300">Nome Job</label>
                <input
                  type="text"
                  [(ngModel)]="jobForm.name"
                  placeholder="es. Backup Notturno NAS"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-300">Repository Destinazione</label>
                <select
                  [(ngModel)]="jobForm.repoId"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                >
                  @for (repo of status()?.repos ?? []; track repo.id) {
                    <option [value]="repo.id">{{ repo.name }} ({{ repo.url }})</option>
                  }
                </select>
              </div>
            </div>

            <!-- Quick Sources Checkboxes -->
            <div>
              <label class="block text-xs font-medium text-slate-300">Cartelle da includere</label>
              <div class="mt-2 flex flex-wrap gap-2">
                @for (src of presetSources; track src) {
                  <button
                    type="button"
                    (click)="togglePresetSource(src)"
                    class="rounded-xl border px-3 py-1.5 font-mono text-[11px] transition"
                    [ngClass]="
                      selectedPresetSources.has(src)
                        ? 'border-[#38bdf8] bg-[#38bdf8]/20 text-[#38bdf8] font-semibold'
                        : 'border-white/10 bg-black/30 text-slate-300 hover:bg-white/10'
                    "
                  >
                    {{ selectedPresetSources.has(src) ? '✓ ' : '+ ' }}{{ src }}
                  </button>
                }
              </div>
              <input
                type="text"
                [(ngModel)]="jobForm.extraSources"
                placeholder="Altri percorsi separati da virgola (opzionale, es. /etc, /DATA/Media)"
                class="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
              />
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label class="block text-xs font-medium text-slate-300">Pianificazione</label>
                <div class="mt-1 flex gap-2">
                  <select
                    [(ngModel)]="jobForm.schedule"
                    class="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                  >
                    <option value="manual">Manuale</option>
                    <option value="hourly">Ogni ora</option>
                    <option value="daily">Giornaliero</option>
                    <option value="weekly">Settimanale (Domenica)</option>
                  </select>
                  @if (jobForm.schedule !== 'manual') {
                    <input
                      type="time"
                      [(ngModel)]="jobForm.scheduleTime"
                      class="w-28 rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                    />
                  }
                </div>
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-300">Esclusioni (separate da virgola)</label>
                <input
                  type="text"
                  [(ngModel)]="jobForm.excludes"
                  placeholder="*.tmp, .cache, node_modules"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                />
              </div>
            </div>

            <!-- Retention Policy -->
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="block text-[11px] text-slate-400">Mantieni Giornalieri</label>
                <input
                  type="number"
                  min="0"
                  [(ngModel)]="jobForm.keepDaily"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label class="block text-[11px] text-slate-400">Mantieni Settimanali</label>
                <input
                  type="number"
                  min="0"
                  [(ngModel)]="jobForm.keepWeekly"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label class="block text-[11px] text-slate-400">Mantieni Mensili</label>
                <input
                  type="number"
                  min="0"
                  [(ngModel)]="jobForm.keepMonthly"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-white"
                />
              </div>
            </div>

            <div class="flex justify-end">
              <button
                type="button"
                (click)="createJob()"
                [disabled]="savingJob() || !jobForm.name.trim() || !jobForm.repoId"
                class="rounded-xl bg-[#38bdf8] px-5 py-2 text-xs font-semibold text-[#090e1a] hover:brightness-110 disabled:opacity-50"
              >
                {{ savingJob() ? 'Salvataggio...' : 'Salva Job di Backup' }}
              </button>
            </div>
          }
        </div>

        <!-- Existing Jobs List -->
        <div class="space-y-2.5">
          @for (job of status()?.jobs ?? []; track job.id) {
            <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-semibold text-white">{{ job.name }}</span>
                    <span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                      {{ scheduleLabel(job) }}
                    </span>
                    @if (job.lastStatus === 'ok') {
                      <span class="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        ✓ OK
                      </span>
                    } @else if (job.lastStatus === 'error') {
                      <span class="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                        ✕ Errore
                      </span>
                    } @else if (job.lastStatus === 'running' || runningJobId() === job.id) {
                      <span class="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-300 animate-pulse">
                        In esecuzione...
                      </span>
                    }
                  </div>
                  <div class="font-mono text-[11px] text-sky-300">
                    Sorgenti: {{ job.sources.join(', ') }}
                  </div>
                  <div class="text-[11px] text-slate-400">
                    Destinazione: {{ repoName(job.repoId) }} · Retention: {{ job.keepDaily }}g / {{ job.keepWeekly }}s / {{ job.keepMonthly }}m
                    @if (job.lastRunAt) {
                      · Ultimo avvio: {{ job.lastRunAt | date: 'dd/MM/yyyy HH:mm' }}
                    }
                  </div>
                  @if (job.lastMessage && job.lastStatus === 'error') {
                    <div class="text-[11px] text-rose-300">{{ job.lastMessage }}</div>
                  }
                </div>

                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    (click)="runJobNow(job)"
                    [disabled]="runningJobId() !== null"
                    class="rounded-xl bg-[#00ff88] px-3.5 py-1.5 text-xs font-semibold text-[#062417] hover:brightness-110 disabled:opacity-50"
                  >
                    {{ runningJobId() === job.id ? 'Backup...' : '▶ Esegui Ora' }}
                  </button>
                  <button
                    type="button"
                    (click)="deleteJob(job)"
                    class="rounded-xl bg-rose-500/15 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/25"
                  >
                    Elimina
                  </button>
                </div>
              </div>
            </div>
          }
        </div>
      }

      <!-- TAB 2: REPOSITORIES -->
      @if (activeTab() === 'repos') {
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
          <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Aggiungi / Inizializza Repository Restic
          </h4>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="block text-xs font-medium text-slate-300">Nome Repository</label>
              <input
                type="text"
                [(ngModel)]="repoForm.name"
                placeholder="es. Disco USB Esterno"
                class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
              />
            </div>

            <div>
              <label class="block text-xs font-medium text-slate-300">Tipo Destinazione</label>
              <select
                [(ngModel)]="repoForm.type"
                class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
              >
                <option value="local">Disco USB / Disco di Rete / Cartella Locale</option>
                <option value="sftp">Server Remoto (SFTP / SSH)</option>
                <option value="s3">Cloud S3 (AWS, Backblaze B2, MinIO, Wasabi)</option>
              </select>
            </div>

            @if (repoForm.type === 'local' && backupDestinations().length > 0) {
              <div class="sm:col-span-2 space-y-2">
                <label class="block text-xs font-medium text-slate-300">
                  Seleziona Disco USB o Disco di Rete montato
                </label>
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  @for (dest of backupDestinations(); track dest.path) {
                    <button
                      type="button"
                      (click)="selectBackupDestination(dest)"
                      class="flex items-center justify-between gap-2 rounded-xl border p-3 text-left text-xs transition"
                      [ngClass]="
                        repoForm.url === dest.repoPath
                          ? 'border-[#38bdf8] bg-[#38bdf8]/15 text-white'
                          : 'border-white/10 bg-black/25 text-slate-300 hover:bg-white/10'
                      "
                    >
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5 font-semibold text-white">
                          <span>{{ dest.icon }}</span>
                          <span class="truncate">{{ dest.label }}</span>
                        </div>
                        <div class="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                          {{ dest.path }}
                        </div>
                      </div>
                      @if (dest.subtitle) {
                        <span class="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
                          {{ dest.subtitle }}
                        </span>
                      }
                    </button>
                  }
                </div>
              </div>
            }

            <div class="sm:col-span-2">
              <label class="block text-xs font-medium text-slate-300">
                @if (repoForm.type === 'local') {
                  Percorso Cartella Locale
                } @else if (repoForm.type === 'sftp') {
                  URL SFTP (es. sftp:utente&#64;192.168.1.50:/backups/nas)
                } @else {
                  URL S3 (es. s3:https://s3.eu-central-1.amazonaws.com/mio-bucket/restic)
                }
              </label>
              <input
                type="text"
                [(ngModel)]="repoForm.url"
                [placeholder]="
                  repoForm.type === 'local'
                    ? '/DATA/Disks/BackupUSB/restic-repo'
                    : repoForm.type === 'sftp'
                    ? 'sftp:backup@server:/srv/restic'
                    : 's3:https://s3.amazonaws.com/bucket/siloos'
                "
                class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
              />
            </div>

            <div class="sm:col-span-2">
              <label class="block text-xs font-medium text-slate-300">
                Password di Cifratura Restic (conservala in un posto sicuro!)
              </label>
              <div class="mt-1 flex gap-2">
                <input
                  type="password"
                  [(ngModel)]="repoForm.password"
                  placeholder="Password cifratura repository"
                  class="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white focus:border-[#38bdf8] focus:outline-none"
                />
                <button
                  type="button"
                  (click)="generateRandomPassword()"
                  class="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                >
                  🎲 Genera
                </button>
              </div>
            </div>

            @if (repoForm.type === 's3') {
              <div>
                <label class="block text-xs font-medium text-slate-300">S3 Access Key ID</label>
                <input
                  type="text"
                  [(ngModel)]="repoForm.s3AccessKey"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-300">S3 Secret Access Key</label>
                <input
                  type="password"
                  [(ngModel)]="repoForm.s3SecretKey"
                  class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white"
                />
              </div>
            }
          </div>

          <div class="flex justify-end">
            <button
              type="button"
              (click)="createRepo()"
              [disabled]="savingRepo() || !repoForm.name.trim() || !repoForm.url.trim() || !repoForm.password"
              class="rounded-xl bg-[#00ff88] px-5 py-2 text-xs font-semibold text-[#062417] hover:brightness-110 disabled:opacity-50"
            >
              {{ savingRepo() ? 'Inizializzazione...' : 'Inizializza & Collega Repository' }}
            </button>
          </div>
        </div>

        <!-- Existing Repositories -->
        <div class="space-y-2.5">
          @for (repo of status()?.repos ?? []; track repo.id) {
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4">
              <div>
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-white">{{ repo.name }}</span>
                  <span class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-sky-300">
                    {{ repo.type }}
                  </span>
                </div>
                <div class="mt-0.5 font-mono text-[11px] text-slate-400">{{ repo.url }}</div>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  (click)="checkRepo(repo)"
                  [disabled]="checkingRepoId() === repo.id"
                  class="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
                >
                  {{ checkingRepoId() === repo.id ? 'Verifica...' : '🔍 Verifica Integrità' }}
                </button>
                <button
                  type="button"
                  (click)="viewRepoSnapshots(repo.id)"
                  class="rounded-xl border border-[#38bdf8]/40 bg-[#38bdf8]/15 px-3 py-1.5 text-xs text-[#38bdf8] hover:bg-[#38bdf8]/25"
                >
                  📸 Snapshot
                </button>
                <button
                  type="button"
                  (click)="deleteRepo(repo)"
                  class="rounded-xl bg-rose-500/15 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/25"
                >
                  Rimuovi
                </button>
              </div>
            </div>
          }
        </div>
      }

      <!-- TAB 3: SNAPSHOTS & RESTORE -->
      @if (activeTab() === 'snapshots') {
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <label class="text-xs font-medium text-slate-300">Repository:</label>
              <select
                [(ngModel)]="selectedSnapRepoId"
                (ngModelChange)="loadSnapshots()"
                class="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
              >
                @for (repo of status()?.repos ?? []; track repo.id) {
                  <option [value]="repo.id">{{ repo.name }}</option>
                }
              </select>
            </div>
            <button
              type="button"
              (click)="loadSnapshots()"
              [disabled]="loadingSnapshots() || !selectedSnapRepoId"
              class="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50"
            >
              {{ loadingSnapshots() ? 'Caricamento...' : '↻ Aggiorna Snapshot' }}
            </button>
          </div>

          @if (snapshots().length === 0 && !loadingSnapshots()) {
            <div class="rounded-xl border border-white/10 bg-black/25 p-5 text-center text-xs text-slate-400">
              Nessuno snapshot presente in questo repository. Avvia un Job di Backup per creare il primo snapshot.
            </div>
          } @else {
            <div class="space-y-2">
              @for (snap of snapshots(); track snap.id) {
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3.5">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-xs font-semibold text-[#38bdf8]">
                        {{ snap.short_id }}
                      </span>
                      <span class="text-xs text-white">
                        {{ snap.time | date: 'dd/MM/yyyy HH:mm:ss' }}
                      </span>
                      <span class="text-[11px] text-slate-400">({{ snap.hostname }})</span>
                    </div>
                    <div class="mt-1 font-mono text-[11px] text-slate-400">
                      {{ snap.paths.join(', ') }}
                    </div>
                  </div>
                  <button
                    type="button"
                    (click)="restoreSnapshot(snap)"
                    [disabled]="restoringSnapId() === snap.id"
                    class="rounded-xl bg-[#38bdf8] px-3.5 py-1.5 text-xs font-semibold text-[#090e1a] hover:brightness-110 disabled:opacity-50"
                  >
                    {{ restoringSnapId() === snap.id ? 'Ripristino...' : '♻️ Ripristina' }}
                  </button>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class BackupManagerComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(DialogService);

  activeTab = signal<BackupTab>('jobs');
  status = signal<BackupStatusResponse | null>(null);
  installingRestic = signal(false);
  savingRepo = signal(false);
  savingJob = signal(false);
  checkingRepoId = signal<string | null>(null);
  runningJobId = signal<string | null>(null);
  loadingSnapshots = signal(false);
  restoringSnapId = signal<string | null>(null);
  snapshots = signal<ResticSnapshot[]>([]);
  mountedDisks = signal<MountedDisk[]>([]);
  networkMounts = signal<NetworkMountEntry[]>([]);
  selectedSnapRepoId = '';

  feedback = signal<string | null>(null);
  feedbackOk = signal(true);
  lastOutput = signal<string | null>(null);

  presetSources = [
    '/DATA/Homes',
    '/DATA/Shares',
    '/DATA/Media',
    '/DATA/Stacks',
    '/DATA/AppData',
  ];
  selectedPresetSources = new Set<string>(['/DATA/Homes', '/DATA/Shares', '/DATA/Stacks']);

  repoForm: {
    name: string;
    type: 'local' | 'sftp' | 's3';
    url: string;
    password: string;
    s3AccessKey: string;
    s3SecretKey: string;
  } = {
    name: '',
    type: 'local',
    url: '/DATA/Backups/restic-repo',
    password: '',
    s3AccessKey: '',
    s3SecretKey: '',
  };

  jobForm: {
    name: string;
    repoId: string;
    extraSources: string;
    excludes: string;
    schedule: 'manual' | 'hourly' | 'daily' | 'weekly';
    scheduleTime: string;
    keepDaily: number;
    keepWeekly: number;
    keepMonthly: number;
  } = {
    name: 'Backup Giornaliero NAS',
    repoId: '',
    extraSources: '',
    excludes: '*.tmp, .cache, node_modules',
    schedule: 'daily',
    scheduleTime: '03:00',
    keepDaily: 7,
    keepWeekly: 4,
    keepMonthly: 6,
  };

  ngOnInit(): void {
    this.loadStatus();
  }

  loadStatus(): void {
    this.api.getBackupStatus().subscribe({
      next: (res) => {
        this.status.set(res);
        this.runningJobId.set(res.runningJobId);
        if (!this.jobForm.repoId && res.repos.length > 0) {
          this.jobForm.repoId = res.repos[0].id;
        }
        if (!this.selectedSnapRepoId && res.repos.length > 0) {
          this.selectedSnapRepoId = res.repos[0].id;
        }
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore caricamento stato Restic');
      },
    });
    this.api.getStorageDisks().subscribe({
      next: (res) => this.mountedDisks.set(res.mounts ?? []),
      error: () => {},
    });
    this.api.getNetworkMounts().subscribe({
      next: (res) => this.networkMounts.set(res.mounts ?? []),
      error: () => {},
    });
  }

  backupDestinations(): Array<{
    label: string;
    path: string;
    repoPath: string;
    icon: string;
    subtitle: string;
  }> {
    const list: Array<{
      label: string;
      path: string;
      repoPath: string;
      icon: string;
      subtitle: string;
    }> = [];
    const seen = new Set<string>();

    for (const nm of this.networkMounts()) {
      if (seen.has(nm.mountpoint)) continue;
      seen.add(nm.mountpoint);
      list.push({
        label: `Rete: ${nm.name}`,
        path: nm.mountpoint,
        repoPath: `${nm.mountpoint}/siloos-restic-backup`,
        icon: '🌐',
        subtitle: nm.protocol.toUpperCase(),
      });
    }

    for (const m of this.mountedDisks()) {
      if (
        !m.mountpoint ||
        m.mountpoint === '/' ||
        m.mountpoint.startsWith('/boot') ||
        seen.has(m.mountpoint)
      ) {
        continue;
      }
      seen.add(m.mountpoint);
      const name = m.mountpoint.split('/').filter(Boolean).pop() || m.mountpoint;
      list.push({
        label: `Disco: ${name}`,
        path: m.mountpoint,
        repoPath: `${m.mountpoint}/siloos-restic-backup`,
        icon: '💾',
        subtitle: m.availableBytes
          ? `${(m.availableBytes / 1024 ** 3).toFixed(1)} GB liberi`
          : '',
      });
    }
    return list;
  }

  selectBackupDestination(dest: { label: string; repoPath: string }): void {
    this.repoForm.url = dest.repoPath;
    if (!this.repoForm.name.trim()) {
      this.repoForm.name = `Backup ${dest.label}`;
    }
  }

  installRestic(): void {
    this.installingRestic.set(true);
    this.feedback.set(null);
    this.lastOutput.set(null);
    this.api.installRestic().subscribe({
      next: () => {
        this.installingRestic.set(false);
        this.feedbackOk.set(true);
        this.feedback.set('Restic installato con successo!');
        this.loadStatus();
      },
      error: (err) => {
        this.installingRestic.set(false);
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore installazione Restic');
      },
    });
  }

  generateRandomPassword(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let out = '';
    for (let i = 0; i < 20; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    this.repoForm.password = out;
    this.dialog.alert(
      `Password generata (salvala in un posto sicuro!):\n\n${out}`,
      { title: 'Password Repository Restic', tone: 'warning' }
    );
  }

  createRepo(): void {
    this.savingRepo.set(true);
    this.feedback.set(null);
    this.lastOutput.set(null);
    this.api.createBackupRepo(this.repoForm).subscribe({
      next: (res) => {
        this.savingRepo.set(false);
        this.feedbackOk.set(true);
        this.feedback.set(`Repository "${res.repo.name}" inizializzato e collegato!`);
        this.repoForm.name = '';
        this.repoForm.password = '';
        this.repoForm.s3AccessKey = '';
        this.repoForm.s3SecretKey = '';
        this.loadStatus();
      },
      error: (err) => {
        this.savingRepo.set(false);
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore creazione repository');
      },
    });
  }

  async deleteRepo(repo: BackupRepositoryView): Promise<void> {
    const ok = await this.dialog.confirm(
      `Rimuovere il repository "${repo.name}" dalla configurazione di SiloOs? (I file di backup su disco NON verranno eliminati.)`,
      { title: 'Rimuovi Repository', confirmText: 'Rimuovi', danger: true }
    );
    if (!ok) return;
    this.api.deleteBackupRepo(repo.id).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Repository "${repo.name}" rimosso dalla configurazione.`);
        this.loadStatus();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore rimozione repository');
      },
    });
  }

  checkRepo(repo: BackupRepositoryView): void {
    this.checkingRepoId.set(repo.id);
    this.feedback.set(null);
    this.lastOutput.set(null);
    this.api.checkBackupRepo(repo.id).subscribe({
      next: (res) => {
        this.checkingRepoId.set(null);
        this.feedbackOk.set(true);
        this.feedback.set(`Verifica integrità completata per "${repo.name}".`);
        this.lastOutput.set(res.output || 'Nessun errore rilevato.');
      },
      error: (err) => {
        this.checkingRepoId.set(null);
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore verifica integrità');
      },
    });
  }

  togglePresetSource(src: string): void {
    if (this.selectedPresetSources.has(src)) {
      this.selectedPresetSources.delete(src);
    } else {
      this.selectedPresetSources.add(src);
    }
  }

  createJob(): void {
    const extra = this.jobForm.extraSources
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('/'));
    const sources = Array.from(new Set([...Array.from(this.selectedPresetSources), ...extra]));
    const excludes = this.jobForm.excludes
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    this.savingJob.set(true);
    this.feedback.set(null);
    this.lastOutput.set(null);
    this.api
      .saveBackupJob({
        name: this.jobForm.name.trim(),
        repoId: this.jobForm.repoId,
        sources,
        excludes,
        schedule: this.jobForm.schedule,
        scheduleTime: this.jobForm.scheduleTime,
        keepDaily: this.jobForm.keepDaily,
        keepWeekly: this.jobForm.keepWeekly,
        keepMonthly: this.jobForm.keepMonthly,
        enabled: true,
      })
      .subscribe({
        next: (res) => {
          this.savingJob.set(false);
          this.feedbackOk.set(true);
          this.feedback.set(`Job "${res.job.name}" salvato!`);
          this.loadStatus();
        },
        error: (err) => {
          this.savingJob.set(false);
          this.feedbackOk.set(false);
          this.feedback.set(err?.error?.error ?? 'Errore salvataggio job');
        },
      });
  }

  runJobNow(job: BackupJob): void {
    this.runningJobId.set(job.id);
    this.feedback.set(null);
    this.lastOutput.set(null);
    this.api.runBackupJob(job.id).subscribe({
      next: (res) => {
        this.runningJobId.set(null);
        this.feedbackOk.set(true);
        this.feedback.set(`Backup "${job.name}" completato con successo!`);
        this.lastOutput.set(res.output);
        this.loadStatus();
      },
      error: (err) => {
        this.runningJobId.set(null);
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore durante esecuzione backup');
        this.loadStatus();
      },
    });
  }

  async deleteJob(job: BackupJob): Promise<void> {
    const ok = await this.dialog.confirm(
      `Eliminare il job di backup "${job.name}"?`,
      { title: 'Elimina Job', confirmText: 'Elimina', danger: true }
    );
    if (!ok) return;
    this.api.deleteBackupJob(job.id).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Job "${job.name}" eliminato.`);
        this.loadStatus();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore eliminazione job');
      },
    });
  }

  openSnapshotsTab(): void {
    this.activeTab.set('snapshots');
    if (this.selectedSnapRepoId) {
      this.loadSnapshots();
    }
  }

  viewRepoSnapshots(repoId: string): void {
    this.selectedSnapRepoId = repoId;
    this.activeTab.set('snapshots');
    this.loadSnapshots();
  }

  loadSnapshots(): void {
    if (!this.selectedSnapRepoId) return;
    this.loadingSnapshots.set(true);
    this.api.getRepoSnapshots(this.selectedSnapRepoId).subscribe({
      next: (res) => {
        this.loadingSnapshots.set(false);
        this.snapshots.set(res.snapshots);
      },
      error: (err) => {
        this.loadingSnapshots.set(false);
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore lettura snapshot');
      },
    });
  }

  async restoreSnapshot(snap: ResticSnapshot): Promise<void> {
    const targetDir = await this.dialog.prompt(
      `In quale cartella vuoi ripristinare lo snapshot ${snap.short_id}?`,
      {
        title: 'Ripristina Snapshot Restic',
        defaultValue: `/DATA/Restores/${snap.short_id}`,
        confirmText: 'Avvia Ripristino',
      }
    );
    if (!targetDir || !targetDir.trim()) return;

    this.restoringSnapId.set(snap.id);
    this.feedback.set(null);
    this.lastOutput.set(null);
    this.api.restoreBackupSnapshot(this.selectedSnapRepoId, snap.id, targetDir.trim()).subscribe({
      next: (res) => {
        this.restoringSnapId.set(null);
        this.feedbackOk.set(true);
        this.feedback.set(`Snapshot ${snap.short_id} ripristinato in ${res.targetDir}`);
        this.lastOutput.set(res.output || null);
      },
      error: (err) => {
        this.restoringSnapId.set(null);
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore ripristino snapshot');
      },
    });
  }

  repoName(repoId: string): string {
    return this.status()?.repos.find((r) => r.id === repoId)?.name ?? repoId;
  }

  scheduleLabel(job: BackupJob): string {
    if (job.schedule === 'hourly') return 'Ogni ora';
    if (job.schedule === 'daily') return `Giornaliero (${job.scheduleTime})`;
    if (job.schedule === 'weekly') return `Settimanale Dom (${job.scheduleTime})`;
    return 'Manuale';
  }
}
