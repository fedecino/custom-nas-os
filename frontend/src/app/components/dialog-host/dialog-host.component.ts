import { Component, ElementRef, HostListener, ViewChild, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogService } from '../../services/dialog.service';

@Component({
  selector: 'app-dialog-host',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (dialogService.activeDialog(); as dlg) {
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        (click)="onBackdropClick()"
      >
        <div
          class="w-full max-w-md rounded-2xl border border-white/15 bg-[#0f172a]/95 p-5 shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-start gap-3">
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base"
              [ngClass]="{
                'bg-rose-500/20 text-rose-300': dlg.tone === 'danger',
                'bg-amber-500/20 text-amber-300': dlg.tone === 'warning',
                'bg-emerald-500/20 text-emerald-300': dlg.tone === 'success',
                'bg-[#38bdf8]/20 text-[#38bdf8]': dlg.tone === 'info'
              }"
            >
              @if (dlg.tone === 'danger') {
                ⚠
              } @else if (dlg.tone === 'warning') {
                !
              } @else if (dlg.tone === 'success') {
                ✓
              } @else {
                ℹ
              }
            </div>

            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-semibold text-white">{{ dlg.title }}</h3>
              <p class="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-300">
                {{ dlg.message }}
              </p>
            </div>
          </div>

          @if (dlg.mode === 'prompt') {
            <div class="mt-4">
              <input
                #promptInput
                type="text"
                [(ngModel)]="dlg.inputValue"
                [placeholder]="dlg.placeholder"
                (keydown.enter)="confirmPrompt(dlg.inputValue)"
                class="w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-[#38bdf8] focus:outline-none"
              />
            </div>
          }

          <div class="mt-5 flex justify-end gap-2">
            @if (dlg.mode !== 'alert') {
              <button
                type="button"
                (click)="cancel()"
                class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/10"
              >
                {{ dlg.cancelText }}
              </button>
            }

            @if (dlg.mode === 'alert') {
              <button
                type="button"
                (click)="dialogService.closeWith(undefined)"
                class="rounded-xl bg-[#38bdf8] px-5 py-2 text-xs font-semibold text-[#090e1a] hover:brightness-110"
              >
                {{ dlg.confirmText }}
              </button>
            } @else if (dlg.mode === 'confirm') {
              <button
                type="button"
                (click)="dialogService.closeWith(true)"
                class="rounded-xl px-5 py-2 text-xs font-semibold hover:brightness-110"
                [ngClass]="
                  dlg.tone === 'danger'
                    ? 'bg-rose-500 text-white'
                    : 'bg-[#38bdf8] text-[#090e1a]'
                "
              >
                {{ dlg.confirmText }}
              </button>
            } @else {
              <button
                type="button"
                (click)="confirmPrompt(dlg.inputValue)"
                class="rounded-xl bg-[#38bdf8] px-5 py-2 text-xs font-semibold text-[#090e1a] hover:brightness-110"
              >
                {{ dlg.confirmText }}
              </button>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class DialogHostComponent {
  readonly dialogService = inject(DialogService);

  @ViewChild('promptInput') promptInput?: ElementRef<HTMLInputElement>;

  constructor() {
    effect(() => {
      const dlg = this.dialogService.activeDialog();
      if (dlg?.mode === 'prompt') {
        setTimeout(() => {
          this.promptInput?.nativeElement.focus();
          this.promptInput?.nativeElement.select();
        }, 0);
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    const dlg = this.dialogService.activeDialog();
    if (!dlg) return;
    if (dlg.mode === 'alert') {
      this.dialogService.closeWith(undefined);
    } else {
      this.cancel();
    }
  }

  onBackdropClick(): void {
    const dlg = this.dialogService.activeDialog();
    if (!dlg) return;
    if (dlg.mode === 'alert') {
      this.dialogService.closeWith(undefined);
    } else {
      this.cancel();
    }
  }

  cancel(): void {
    const dlg = this.dialogService.activeDialog();
    if (!dlg) return;
    this.dialogService.closeWith(dlg.mode === 'confirm' ? false : null);
  }

  confirmPrompt(value: string): void {
    this.dialogService.closeWith(value);
  }
}
