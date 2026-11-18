import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorState } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import { ApiService, InspectedImage } from '../../services/api.service';

export interface LogLine {
  text: string;
  stream: 'stdout' | 'stderr' | 'info';
}

@Component({
  selector: 'app-compose-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-6 backdrop-blur-sm"
    >
      <div
        class="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-nas-border bg-nas-panel shadow-2xl"
      >
        <!-- Top Header -->
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-6 py-4"
        >
          <div>
            <div class="flex items-center gap-2.5">
              <h2 class="text-lg font-semibold text-white">
                Compose YAML Editor & Deploy
              </h2>
              @if (inspected) {
                <span
                  class="rounded-full bg-sky-500/15 px-2.5 py-0.5 font-mono text-xs text-sky-300"
                >
                  {{ inspected.image }}:{{ inspected.tag }}
                </span>
                <span
                  class="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300"
                >
                  {{ inspected.os }}/{{ inspected.architecture }}
                </span>
              }
            </div>
            @if (inspected) {
              <div class="mt-1.5 flex flex-wrap gap-2 text-[11px] text-slate-400">
                <span>Porte rilevate: {{ inspected.exposedPorts.length }}</span>
                <span>·</span>
                <span>Volumi rilevati: {{ inspected.volumes.length }}</span>
                <span>·</span>
                <span>Variabili Env: {{ objectKeys(inspected.env).length }}</span>
              </div>
            }
          </div>

          <button
            type="button"
            (click)="close.emit()"
            [disabled]="deploying()"
            class="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <!-- Stack Name & Toolbar -->
        <div
          class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/50 px-6 py-3"
        >
          <div class="flex items-center gap-3">
            <label class="text-xs font-medium text-slate-300" for="stackNameInput">
              Nome Stack:
            </label>
            <input
              id="stackNameInput"
              type="text"
              [(ngModel)]="stackName"
              [disabled]="deploying() || lockStackName"
              placeholder="es. jellyfin"
              class="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-white focus:border-sky-400 focus:outline-none disabled:opacity-60"
            />
            <span class="hidden text-[11px] text-slate-500 sm:inline">
              Salvato in /DATA/Stacks/{{ stackName || '...' }}/docker-compose.yml
            </span>
          </div>

          <div class="flex items-center gap-2.5">
            <button
              type="button"
              (click)="validateYaml()"
              [disabled]="deploying() || actionBusy()"
              class="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
            >
              Valida YAML
            </button>

            @if (isInstalled()) {
              <button
                type="button"
                (click)="runContainerAction('stop')"
                [disabled]="deploying() || actionBusy() || !stackName.trim()"
                class="rounded-lg bg-amber-500/20 px-3.5 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/30 disabled:opacity-50"
              >
                Stop
              </button>
              <button
                type="button"
                (click)="runContainerAction('restart')"
                [disabled]="deploying() || actionBusy() || !stackName.trim()"
                class="rounded-lg bg-sky-500/20 px-3.5 py-1.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/30 disabled:opacity-50"
              >
                Riavvia
              </button>
              <button
                type="button"
                (click)="deploy()"
                [disabled]="deploying() || actionBusy() || !stackName.trim()"
                class="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                Applica YAML
              </button>
            } @else {
              <button
                type="button"
                (click)="deploy()"
                [disabled]="deploying() || !stackName.trim()"
                class="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                @if (deploying()) {
                  <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-950 border-t-transparent"></span>
                  <span>Deploy in corso...</span>
                } @else {
                  <span>Installa / Avvia</span>
                }
              </button>
            }
          </div>
        </div>

        @if (validationMessage()) {
          <div
            class="border-b px-6 py-2 text-xs"
            [ngClass]="
              validationOk()
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
            "
          >
            {{ validationMessage() }}
          </div>
        }

        <!-- Split View: YAML Editor + Deploy Console -->
        <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
          <!-- Left: CodeMirror Editor -->
          <div class="flex min-h-0 flex-col border-b border-slate-800 lg:border-b-0 lg:border-r">
            <div
              class="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-slate-400"
            >
              <span>docker-compose.yml (modificabile)</span>
              <span class="text-slate-500">YAML · Syntax Highlight</span>
            </div>
            <div #editorHost class="min-h-[260px] flex-1 overflow-auto bg-[#282c34]"></div>
          </div>

          <!-- Right: Live SSE Deploy Console -->
          <div class="flex min-h-0 flex-col bg-[#070b12]">
            <div
              class="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-slate-400"
            >
              <span>Console Deploy (SSE Stream)</span>
              @if (deployStatus() === 'running') {
                <span class="text-sky-400 animate-pulse">● Streaming</span>
              } @else if (deployStatus() === 'success') {
                <span class="text-emerald-400">✓ Completato</span>
              } @else if (deployStatus() === 'error') {
                <span class="text-rose-400">✕ Errore</span>
              } @else {
                <span class="text-slate-500">In attesa</span>
              }
            </div>

            <div
              #logContainer
              class="min-h-[220px] flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
            >
              @if (logs().length === 0) {
                <div class="text-slate-500">
                  Modifica porte, percorsi (/DATA/AppData/...) o variabili d'ambiente nell'editor YAML, quindi premi "Installa / Avvia" per eseguire docker compose up -d.
                </div>
              } @else {
                @for (line of logs(); track $index) {
                  <div
                    class="whitespace-pre-wrap break-all"
                    [class.text-sky-300]="line.stream === 'info'"
                    [class.text-amber-300]="line.stream === 'stderr'"
                    [class.text-slate-200]="line.stream === 'stdout'"
                  >{{ line.text }}</div>
                }
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ComposeEditorComponent implements AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);

  @Input() inspected: InspectedImage | null = null;
  @Input() stackName = '';
  @Input() initialYaml = '';
  @Input() lockStackName = false;

  @Output() close = new EventEmitter<void>();
  @Output() deployed = new EventEmitter<string>();

  @ViewChild('editorHost', { static: true }) editorHost!: ElementRef<HTMLDivElement>;
  @ViewChild('logContainer') logContainer?: ElementRef<HTMLDivElement>;

  deploying = signal(false);
  actionBusy = signal(false);
  deployStatus = signal<'idle' | 'running' | 'success' | 'error'>('idle');
  logs = signal<LogLine[]>([]);
  validationMessage = signal<string | null>(null);
  validationOk = signal(true);

  private editorView?: EditorView;
  private abortController?: AbortController;

  ngAfterViewInit(): void {
    const startDoc = this.initialYaml || this.inspected?.composeYaml || '';
    const state = EditorState.create({
      doc: startDoc,
      extensions: [basicSetup, yaml(), oneDark],
    });

    this.editorView = new EditorView({
      state,
      parent: this.editorHost.nativeElement,
    });
  }

  ngOnDestroy(): void {
    this.abortController?.abort();
    this.editorView?.destroy();
  }

  private getCurrentYaml(): string {
    return this.editorView?.state.doc.toString() ?? this.initialYaml;
  }

  objectKeys(obj: Record<string, string>): string[] {
    return Object.keys(obj);
  }

  isInstalled(): boolean {
    return this.lockStackName || this.deployStatus() === 'success';
  }

  runContainerAction(act: 'stop' | 'restart'): void {
    const name = this.stackName.trim();
    if (!name) return;
    this.actionBusy.set(true);
    this.appendLog(`Esecuzione "${act}" sullo stack "${name}"...`, 'info');
    this.api.stackAction(name, act).subscribe({
      next: () => {
        this.actionBusy.set(false);
        this.appendLog(`Azione "${act}" completata con successo!`, 'info');
        this.deployed.emit(name);
      },
      error: (err) => {
        this.actionBusy.set(false);
        this.appendLog(
          `ERRORE (${act}): ${err?.error?.error ?? 'Operazione fallita'}`,
          'stderr'
        );
      },
    });
  }

  validateYaml(): void {
    const content = this.getCurrentYaml();
    this.api.validateCompose(content).subscribe({
      next: () => {
        this.validationOk.set(true);
        this.validationMessage.set('YAML valido e pronto per il deploy.');
      },
      error: (err) => {
        this.validationOk.set(false);
        this.validationMessage.set(err?.error?.error ?? 'YAML non valido');
      },
    });
  }

  async deploy(): Promise<void> {
    const name = this.stackName.trim();
    const yamlContent = this.getCurrentYaml();
    if (!name) return;

    this.deploying.set(true);
    this.deployStatus.set('running');
    this.validationMessage.set(null);
    this.logs.set([]);
    this.abortController = new AbortController();

    try {
      await this.api.deployStackSse(
        name,
        yamlContent,
        (event) => {
          if (event.type === 'log' && event.message !== undefined) {
            this.appendLog(event.message, event.stream ?? 'stdout');
          } else if (event.type === 'error' && event.message) {
            this.appendLog(`ERROR: ${event.message}`, 'stderr');
            this.deployStatus.set('error');
          } else if (event.type === 'done') {
            if (event.success) {
              this.appendLog(`Stack "${name}" avviato con successo!`, 'info');
              this.deployStatus.set('success');
              this.deployed.emit(name);
            } else {
              this.appendLog(
                `Deploy terminato con exit code ${event.exitCode ?? 1}.`,
                'stderr'
              );
              this.deployStatus.set('error');
            }
          }
        },
        this.abortController.signal
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore di rete durante il deploy';
      this.appendLog(`ERROR: ${msg}`, 'stderr');
      this.deployStatus.set('error');
    } finally {
      this.deploying.set(false);
    }
  }

  private appendLog(text: string, stream: 'stdout' | 'stderr' | 'info'): void {
    this.logs.update((prev) => [...prev, { text, stream }]);
    setTimeout(() => {
      const el = this.logContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
