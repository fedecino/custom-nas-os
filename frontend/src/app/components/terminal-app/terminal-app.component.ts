import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

@Component({
  selector: 'app-terminal-app',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#070b14]">
      <!-- Toolbar -->
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-slate-900/80 px-4 py-2.5">
        <div class="flex items-center gap-2.5">
          <span
            class="h-2.5 w-2.5 rounded-full"
            [ngClass]="{
              'bg-emerald-400 shadow-[0_0_8px_#34d399]': status() === 'connected',
              'bg-amber-400 animate-pulse': status() === 'connecting',
              'bg-rose-500': status() === 'disconnected'
            }"
          ></span>
          <span class="font-mono text-xs font-semibold text-white">
            SiloOs Shell (bash)
          </span>
          <span class="text-[11px] text-slate-400">
            @if (status() === 'connected') {
              Connesso
            } @else if (status() === 'connecting') {
              Connessione in corso...
            } @else {
              Disconnesso
            }
          </span>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            (click)="clearTerminal()"
            class="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 hover:bg-white/10"
          >
            Pulisci
          </button>
          <button
            type="button"
            (click)="reconnect()"
            class="rounded-lg border border-[#38bdf8]/40 bg-[#38bdf8]/15 px-3 py-1 text-xs font-medium text-[#38bdf8] hover:bg-[#38bdf8]/25"
          >
            ↻ Nuova Sessione
          </button>
        </div>
      </div>

      <!-- xterm.js viewport -->
      <div #termContainer class="min-h-0 flex-1 p-2"></div>
    </div>
  `,
})
export class TerminalAppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('termContainer') termContainer!: ElementRef<HTMLDivElement>;

  status = signal<'connecting' | 'connected' | 'disconnected'>('connecting');

  private term?: Terminal;
  private fitAddon?: FitAddon;
  private ws?: WebSocket;
  private resizeObserver?: ResizeObserver;

  ngAfterViewInit(): void {
    this.initTerminal();
    this.connect();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.ws?.close();
    this.term?.dispose();
  }

  private initTerminal(): void {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: '#070b14',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        selectionBackground: 'rgba(56, 189, 248, 0.28)',
      },
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(this.termContainer.nativeElement);
    fitAddon.fit();
    term.focus();

    term.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.fitAndSyncSize();
    });
    this.resizeObserver.observe(this.termContainer.nativeElement);

    this.term = term;
    this.fitAddon = fitAddon;
  }

  private fitAndSyncSize(): void {
    if (!this.fitAddon || !this.term) return;
    try {
      this.fitAddon.fit();
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: 'resize',
            cols: this.term.cols,
            rows: this.term.rows,
          })
        );
      }
    } catch {
      // ignore layout timing glitches
    }
  }

  private connect(): void {
    this.ws?.close();
    this.status.set('connecting');

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/terminal/ws`);

    ws.onopen = () => {
      this.status.set('connected');
      this.fitAndSyncSize();
      this.term?.focus();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type?: string;
          data?: string;
          code?: number;
        };
        if (msg.type === 'output' && typeof msg.data === 'string') {
          this.term?.write(msg.data);
        } else if (msg.type === 'exit') {
          this.term?.writeln(`\r\n\x1b[33m[Sessione terminata (exit ${msg.code ?? 0})]\x1b[0m`);
          this.status.set('disconnected');
        }
      } catch {
        this.term?.write(String(event.data));
      }
    };

    ws.onerror = () => {
      this.status.set('disconnected');
    };

    ws.onclose = () => {
      if (this.status() !== 'disconnected') {
        this.status.set('disconnected');
      }
    };

    this.ws = ws;
  }

  clearTerminal(): void {
    this.term?.clear();
    this.term?.focus();
  }

  reconnect(): void {
    this.term?.reset();
    this.connect();
  }
}
