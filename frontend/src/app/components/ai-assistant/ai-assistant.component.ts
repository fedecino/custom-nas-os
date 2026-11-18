import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AiChatMessage,
  ApiService,
  StoredAiChat,
} from '../../services/api.service';

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
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-lg font-semibold text-white">SiloOs AI Agent</h2>
            <p class="text-xs text-slate-400">
              Chiedi di controllare risorse, installare app Docker, creare condivisioni SMB/NFS o gestire utenti
            </p>
          </div>
          <button
            type="button"
            (click)="startNewChat()"
            class="rounded-xl border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
          >
            + Nuova Chat
          </button>
        </div>

        <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-12">
          <!-- History Sidebar -->
          <div
            class="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-black/25 p-3 md:col-span-4 lg:col-span-3"
          >
            <div class="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Cronologia Conversazioni
            </div>
            <div class="flex-1 space-y-1 overflow-y-auto">
              @if (historyChats().length === 0) {
                <p class="py-4 text-center text-[11px] text-slate-500">
                  Nessuna chat salvata
                </p>
              } @else {
                @for (chat of historyChats(); track chat.id) {
                  <div
                    class="group flex items-center justify-between gap-1 rounded-xl px-2.5 py-2 text-xs transition cursor-pointer"
                    [ngClass]="
                      currentChatId() === chat.id
                        ? 'bg-[#38bdf8]/20 text-white'
                        : 'text-slate-300 hover:bg-white/10'
                    "
                    (click)="loadChat(chat)"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="truncate font-medium">{{ chat.title }}</div>
                      <div class="text-[10px] text-slate-500">
                        {{ formatTime(chat.updatedAt) }}
                      </div>
                    </div>
                    <button
                      type="button"
                      (click)="deleteChat($event, chat.id)"
                      class="rounded px-1.5 py-0.5 text-[10px] text-slate-400 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
                      title="Elimina chat"
                    >
                      ✕
                    </button>
                  </div>
                }
              }
            </div>
          </div>

          <!-- Chat Panel -->
          <div class="flex min-h-0 flex-col space-y-3 md:col-span-8 lg:col-span-9">
            <div
              class="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-4"
            >
              @if (messages().length === 0) {
                <div class="space-y-3 py-6 text-center">
                  <p class="text-xs text-slate-400">
                    Prova una di queste richieste oppure riprendi una chat dalla cronologia:
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
                        ? 'bg-[#38bdf8] text-[#090e1a] font-medium'
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
                  <span>L'agente sta elaborando...</span>
                </div>
              }
            </div>

            @if (error()) {
              <div class="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
                {{ error() }}
              </div>
            }

            <!-- Input + Send / Stop -->
            <form (ngSubmit)="send()" class="flex gap-2.5">
              <input
                type="text"
                [(ngModel)]="inputText"
                name="inputText"
                [disabled]="sending()"
                placeholder="Scrivi cosa vuoi fare sul NAS..."
                class="flex-1 rounded-xl border border-white/10 bg-black/35 px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
              />
              @if (sending()) {
                <button
                  type="button"
                  (click)="stopGeneration()"
                  class="rounded-xl bg-rose-500 px-5 py-2.5 text-xs font-semibold text-white hover:bg-rose-400"
                >
                  ■ Stop
                </button>
              } @else {
                <button
                  type="submit"
                  [disabled]="!inputText.trim()"
                  class="rounded-xl bg-[#38bdf8] px-5 py-2.5 text-xs font-semibold text-[#090e1a] hover:brightness-110 disabled:opacity-50"
                >
                  Invia
                </button>
              }
            </form>
          </div>
        </div>
      }
    </div>
  `,
})
export class AiAssistantComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);

  @Input() aiEnabled = false;
  @Output() openSettings = new EventEmitter<void>();
  @Output() actionExecuted = new EventEmitter<void>();

  historyChats = signal<StoredAiChat[]>([]);
  currentChatId = signal<string | null>(null);
  messages = signal<AiChatMessage[]>([]);
  sending = signal(false);
  error = signal<string | null>(null);
  inputText = '';

  private abortController?: AbortController;

  quickPrompts = [
    'Controlla CPU, RAM, rete e dischi del NAS',
    'Elenca tutti i container Docker attivi',
    'Installa nginx dal Docker Hub',
    'Crea una condivisione SMB chiamata Media',
  ];

  ngOnInit(): void {
    this.loadHistory();
  }

  ngOnDestroy(): void {
    this.abortController?.abort();
  }

  loadHistory(): void {
    this.api.getAiHistory().subscribe({
      next: (res) => this.historyChats.set(res.chats),
      error: () => { },
    });
  }

  startNewChat(): void {
    this.abortController?.abort();
    this.sending.set(false);
    this.currentChatId.set(null);
    this.messages.set([]);
    this.error.set(null);
  }

  loadChat(chat: StoredAiChat): void {
    if (this.sending()) return;
    this.currentChatId.set(chat.id);
    this.messages.set([...chat.messages]);
    this.error.set(null);
  }

  deleteChat(event: Event, id: string): void {
    event.stopPropagation();
    this.api.deleteAiChat(id).subscribe({
      next: () => {
        if (this.currentChatId() === id) {
          this.startNewChat();
        }
        this.loadHistory();
      },
      error: () => { },
    });
  }

  sendQuick(text: string): void {
    this.inputText = text;
    this.send();
  }

    stopGeneration(): void {
      this.abortController?.abort();
      this.sending.set(false);
      this.messages.update((m) => [
        ...m,
        { role: 'assistant', content: '[Richiesta interrotta dall\'utente]' },
      ]);
    }

  async send(): Promise < void> {
      const text = this.inputText.trim();
      if(!text || this.sending()) return;

    this.inputText = '';
    this.error.set(null);
    this.messages.update((m) => [...m, { role: 'user', content: text }]);
    this.sending.set(true);

    this.abortController = new AbortController();

    try {
      const res = await this.api.sendAiChatWithAbort(
        this.currentChatId(),
        this.messages(),
        this.abortController.signal
      );

      this.currentChatId.set(res.chatId);
      this.messages.update((m) => [
        ...m,
        {
          role: 'assistant',
          content: res.reply,
          toolCalls: res.toolCalls,
        },
      ]);
      this.loadHistory();
      if (res.toolCalls && res.toolCalls.length > 0) {
        this.actionExecuted.emit();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      this.error.set(
        err instanceof Error ? err.message : 'Errore durante la comunicazione con AI'
      );
    } finally {
      this.sending.set(false);
    }
  }

  formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }
}
