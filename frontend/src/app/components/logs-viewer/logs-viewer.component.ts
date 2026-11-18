import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-logs-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex h-full flex-col space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-white">Log di Sistema (journalctl)</h2>
          <p class="text-xs text-slate-400">
            Consulta i log del kernel, dispositivi USB, servizi NAS e container Docker
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <select
            [(ngModel)]="selectedUnit"
            (ngModelChange)="load()"
            class="rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white focus:border-sky-400 focus:outline-none"
          >
            <option value="all">Tutti i log</option>
            <option value="kernel">Kernel & Hardware / USB</option>
            <option value="nas-os">SiloOs Backend</option>
            <option value="docker">Docker Engine</option>
            <option value="nginx">Nginx</option>
            <option value="smbd">Samba (SMB)</option>
            <option value="nfs-kernel-server">NFS Server</option>
            <option value="vsftpd">FTP (vsftpd)</option>
            <option value="ssh">SSH / SFTP</option>
          </select>

          <input
            type="text"
            [(ngModel)]="filterText"
            placeholder="Filtra testo..."
            class="w-44 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
          />

          <button
            type="button"
            (click)="load()"
            class="rounded-xl border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-slate-200 hover:bg-white/10"
          >
            Aggiorna
          </button>
        </div>
      </div>

      @if (error()) {
        <div class="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
          {{ error() }}
        </div>
      }

      <div
        class="flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-[#06090f] p-4 font-mono text-[11px] leading-relaxed text-slate-200"
      >
        @if (filteredLines().length === 0) {
          <div class="text-slate-500">Nessuna riga di log trovata.</div>
        } @else {
          @for (line of filteredLines(); track $index) {
            <div
              class="whitespace-pre-wrap break-all border-b border-white/[0.03] py-0.5"
              [ngClass]="{
                'text-rose-300': line.toLowerCase().includes('error') || line.toLowerCase().includes('failed'),
                'text-amber-300': line.toLowerCase().includes('warn')
              }"
            >{{ line }}</div>
          }
        }
      </div>
    </div>
  `,
})
export class LogsViewerComponent implements OnInit {
  private readonly api = inject(ApiService);

  selectedUnit = 'all';
  filterText = '';
  lines = signal<string[]>([]);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set(null);
    this.api.getSystemLogs(this.selectedUnit, 200).subscribe({
      next: (res) => this.lines.set(res.lines),
      error: (err) => {
        this.error.set(err?.error?.error ?? 'Impossibile leggere i log di sistema');
      },
    });
  }

  filteredLines(): string[] {
    const q = this.filterText.trim().toLowerCase();
    if (!q) return this.lines();
    return this.lines().filter((l) => l.toLowerCase().includes(q));
  }
}
