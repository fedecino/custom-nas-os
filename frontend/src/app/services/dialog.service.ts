import { Injectable, signal } from '@angular/core';

export type DialogMode = 'alert' | 'confirm' | 'prompt';
export type DialogTone = 'info' | 'warning' | 'danger' | 'success';

export interface ActiveDialogState {
  mode: DialogMode;
  title: string;
  message: string;
  tone: DialogTone;
  confirmText: string;
  cancelText: string;
  placeholder: string;
  inputValue: string;
  resolve: (result: unknown) => void;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly activeDialog = signal<ActiveDialogState | null>(null);

  alert(
    message: string,
    options?: {
      title?: string;
      okText?: string;
      tone?: DialogTone;
    }
  ): Promise<void> {
    return new Promise((resolve) => {
      this.activeDialog.set({
        mode: 'alert',
        title: options?.title ?? 'Avviso',
        message,
        tone: options?.tone ?? 'info',
        confirmText: options?.okText ?? 'OK',
        cancelText: '',
        placeholder: '',
        inputValue: '',
        resolve: () => resolve(),
      });
    });
  }

  confirm(
    message: string,
    options?: {
      title?: string;
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    }
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.activeDialog.set({
        mode: 'confirm',
        title: options?.title ?? 'Conferma operazione',
        message,
        tone: options?.danger ? 'danger' : 'warning',
        confirmText: options?.confirmText ?? 'Conferma',
        cancelText: options?.cancelText ?? 'Annulla',
        placeholder: '',
        inputValue: '',
        resolve: (val) => resolve(Boolean(val)),
      });
    });
  }

  prompt(
    message: string,
    options?: {
      title?: string;
      defaultValue?: string;
      placeholder?: string;
      confirmText?: string;
      cancelText?: string;
    }
  ): Promise<string | null> {
    return new Promise((resolve) => {
      this.activeDialog.set({
        mode: 'prompt',
        title: options?.title ?? 'Inserisci valore',
        message,
        tone: 'info',
        confirmText: options?.confirmText ?? 'Conferma',
        cancelText: options?.cancelText ?? 'Annulla',
        placeholder: options?.placeholder ?? '',
        inputValue: options?.defaultValue ?? '',
        resolve: (val) => resolve(typeof val === 'string' ? val : null),
      });
    });
  }

  closeWith(result: unknown): void {
    const current = this.activeDialog();
    if (!current) return;
    this.activeDialog.set(null);
    current.resolve(result);
  }
}
