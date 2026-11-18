import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiChatMessage, ApiService } from '../../services/api.service';

@Component({
  selector: 'app-ai-assistant',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex h-full flex-col space-y-4">
      @if (!aiEnabled) {
        <div
          class="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/20 p-8 text-center"
        >
          <div class="text-4xl">🤖</div>
          <h3 class="mt-3 text-base font-semibold text-white">
            Assistente AI non ancora configurato
          </h3>
          <p class="mt-1.5 max-w-md text-xs text-slate-400">
            L'agente AI è opzionale. Puoi abilitarlo nelle Impostazioni collegando una API Key Cloud (OpenAI, Gemini) oppure un LLM locale in rete (Ollama, LM Studio).
          </p>
          <button
            type="button"
            (click)="openSettings.emit()"
            class="mt-5 rounded-xl bg-sky-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            Configura nelle Impostazioni
          </button>
        </div>
      } @else {
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold text-white">NAS-OS AI Agent</h2>
            <p class="text-xs text-slate-400">
              Chiedi di controllare risorse, installare app Docker, creare condivisioni SMB/NFS o gestire utenti
            </p>
          </div>
          <button
            type="button"
            (click)="messages.set([])"
            class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
          >
            Nuova Chat
          </button>
        </div>

        <!-- Messages -->
        <div
          class="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-4"
        >
          @if (messages().length === 0) {
            <div class="space-y-3 py-6 text-center">
              <p class="text-xs text-slate-400">
                Prova una di queste richieste:
              </p>
              <div class="flex flex-wrap justify-center gap-2">
                @for (prompt of quickPrompts; track prompt) {
                  <button
                    type="button"
                    (click)="sendQuick(prompt)"
                    class="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-slate-200 transition hover:border-sky-400/50 hover:text-sky-300"
                  >
                    {{ prompt }}
                  </button>
                }
              </div>
            </div>
          }

          @for (msg of messages(); track $index) {
            <div
              class="flex flex-col"
              [ngClass]="msg.role === 'user' ? 'items-end' : 'items-start'"
            >
              <div
                class="max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed whitespace-pre-wrap"
                [ngClass]="
                  msg.role === 'user'
                    ? 'bg-sky-500 text-slate-950 font-medium'
                    : 'bg-slate-800/90 text-slate-100 border border-white/10'
                "
              >
                {{ msg.content }}
              </div>

              @if (msg.toolCalls && msg.toolCalls.length > 0) {
                <div class="mt-1.5 flex flex-wrap gap-1.5">
                  @for (tc of msg.toolCalls; track $index) {
                    <span
                      class="rounded-full px-2 py-0.5 font-mono text-[10px]"
                      [ngClass]="
                        tc.ok
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-rose-500/15 text-rose-300'
                      "
                    >
                      {{ tc.ok ? '✓' : '✕' }} {{ tc.name }}
                    </span>
                  }
                </div>
              }
            </div>
          }

          @if (sending()) {
            <div class="flex items-center gap-2 text-xs text-sky-300">
              <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"></span>
              <span>L'agente sta elaborando ed eseguendo i comandi...</span>
            </div>
          }
        </div>

        @if (error()) {
          <div class="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
            {{ error() }}
          </div>
        }

        <!-- Input -->
        <form (ngSubmit)="send()" class="flex gap-2.5">
          <input
            type="text"
            [(ngModel)]="inputText"
            name="inputText"
            [disabled]="sending()"
            placeholder="Scrivi cosa vuoi fare sul NAS..."
            class="flex-1 rounded-xl border border-white/10 bg-black/35 px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
          />
          <button
            type="submit"
            [disabled]="sending() || !inputText.trim()"
            class="rounded-xl bg-sky-500 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            Invia
          </button>
        </form>
      }
    </div>
  `,
})
export class AiAssistantComponent {
  private readonly api = inject(ApiService);

  @Input() aiEnabled = false;
  @Output() openSettings = new EventEmitter<void>();
  @Output() actionExecuted = new EventEmitter<void>();

  messages = signal<AiChatMessage[]>([]);
  sending = signal(false);
  error = signal<string | null>(null);
  inputText = '';

  quickPrompts = [
    'Controlla CPU, RAM, rete e dischi del NAS',
    'Elenca tutti i container Docker attivi',
    'Installa nginx dal Docker Hub',
    'Crea una condivisione SMB chiamata Media',
  ];

  sendQuick(text: string): void {
    this.inputText = text;
    this.send();
  }

  send(): void {
    const text = this.inputText.trim();
    if (!text || this.sending()) return;

    this.inputText = '';
    this.error.set(null);
    this.messages.update((m) => [...m, { role: 'user', content: text }]);
    this.sending.set(true);

    const payload = this.messages().map((m) => ({
      role: m.role,
      content: m.content,
    }));

    this.api.sendAiChat(payload).subscribe({
      next: (res) => {
        this.sending.set(false);
        this.messages.update((m) => [
          ...m,
          {
            role: 'assistant',
            content: res.reply,
            toolCalls: res.toolCalls,
          },
        ]);
        if (res.toolCalls && res.toolCalls.length > 0) {
          this.actionExecuted.emit();
        }
      },
      error: (err) => {
        this.sending.set(false);
        this.error.set(err?.error?.error ?? 'Errore durante la comunicazione con AI');
      },
    });
  }
}
