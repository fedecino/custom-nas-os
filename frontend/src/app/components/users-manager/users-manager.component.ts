import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, NasUser } from '../../services/api.service';
import { DialogService } from '../../services/dialog.service';

@Component({
  selector: 'app-users-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <div>
        <h2 class="text-lg font-semibold text-white">Utenti & Permessi</h2>
        <p class="text-xs text-slate-400">
          Crea utenti per accesso SMB/Samba, SFTP, SSH e gestione sistema
        </p>
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
          {{ feedback() }}
        </div>
      }

      <!-- Create User -->
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 space-y-4">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Nuovo Utente NAS
        </h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="text"
            [(ngModel)]="form.username"
            placeholder="Username (es. mario)"
            class="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
          />
          <input
            type="password"
            [(ngModel)]="form.password"
            placeholder="Password (min. 4 caratteri)"
            class="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-sky-400 focus:outline-none"
          />
        </div>

        <div class="flex flex-wrap items-center gap-5 text-xs text-slate-300">
          <label class="flex items-center gap-2">
            <input type="checkbox" [(ngModel)]="form.sambaAccess" class="accent-sky-400" />
            <span>Accesso SMB / Samba</span>
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" [(ngModel)]="form.sshAccess" class="accent-sky-400" />
            <span>Shell SSH / SFTP</span>
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" [(ngModel)]="form.sudoAccess" class="accent-sky-400" />
            <span>Amministratore (sudo)</span>
          </label>
        </div>

        <button
          (click)="createUser()"
          [disabled]="!form.username.trim() || form.password.length < 4"
          class="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
        >
          Crea Utente
        </button>
      </div>

      <!-- Users List -->
      <div class="space-y-2.5">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Utenti di Sistema
        </h3>
        <div class="space-y-2">
          @for (u of users(); track u.username) {
            <div
              class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3"
            >
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-semibold text-white">{{ u.username }}</span>
                  <span class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">
                    UID {{ u.uid }}
                  </span>
                  @if (u.sambaEnabled) {
                    <span class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      SMB
                    </span>
                  }
                  @if (u.groups.includes('sudo')) {
                    <span class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                      SUDO
                    </span>
                  }
                </div>
                <div class="font-mono text-[11px] text-slate-400">
                  {{ u.home }} · {{ u.shell }}
                </div>
              </div>

              <div class="flex items-center gap-2">
                <button
                  (click)="promptPassword(u.username)"
                  class="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/15"
                >
                  Cambia Password
                </button>
                <button
                  (click)="deleteUser(u.username)"
                  class="rounded-lg bg-rose-500/15 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/25"
                >
                  Elimina
                </button>
              </div>
            </div>
          }
        </div>
      </div>

      <!-- Change Password Modal -->
      @if (passwordModalUser(); as targetUser) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <form
            (ngSubmit)="saveNewPassword()"
            class="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div>
              <h4 class="text-sm font-semibold text-white">
                Cambia Password · {{ targetUser }}
              </h4>
              <p class="mt-1 text-xs text-slate-400">
                Aggiorna la password di accesso (Linux, SSH e SMB).
              </p>
            </div>

            <input
              type="password"
              [(ngModel)]="newPassword"
              name="newPassword"
              placeholder="Nuova password (min. 4 caratteri)"
              class="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white focus:border-sky-400 focus:outline-none"
            />
            <input
              type="password"
              [(ngModel)]="confirmNewPassword"
              name="confirmNewPassword"
              placeholder="Conferma nuova password"
              class="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs text-white focus:border-sky-400 focus:outline-none"
            />

            @if (passwordModalError()) {
              <div class="text-xs text-rose-300">{{ passwordModalError() }}</div>
            }

            <div class="flex justify-end gap-2">
              <button
                type="button"
                (click)="passwordModalUser.set(null)"
                class="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/5"
              >
                Annulla
              </button>
              <button
                type="submit"
                [disabled]="!newPassword || newPassword.length < 4"
                class="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
              >
                Salva Password
              </button>
            </div>
          </form>
        </div>
      }
    </div>
  `,
})
export class UsersManagerComponent implements OnInit {
  private readonly api = inject(ApiService);

  users = signal<NasUser[]>([]);
  feedback = signal<string | null>(null);
  private readonly dialog = inject(DialogService);
  feedbackOk = signal(true);

  passwordModalUser = signal<string | null>(null);
  passwordModalError = signal<string | null>(null);
  newPassword = '';
  confirmNewPassword = '';

  form = {
    username: '',
    password: '',
    sambaAccess: true,
    sshAccess: true,
    sudoAccess: false,
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.api.getUsers().subscribe({
      next: (res) => this.users.set(res.users),
      error: () => {},
    });
  }

  createUser(): void {
    this.api.createUser(this.form).subscribe({
      next: (res) => {
        this.feedbackOk.set(true);
        this.feedback.set(
          res.warnings?.length
            ? `Utente creato (${res.warnings[0]})`
            : `Utente "${this.form.username}" creato`
        );
        this.form.username = '';
        this.form.password = '';
        this.load();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Errore creazione utente');
      },
    });
  }

  promptPassword(username: string): void {
    this.newPassword = '';
    this.confirmNewPassword = '';
    this.passwordModalError.set(null);
    this.passwordModalUser.set(username);
  }

  saveNewPassword(): void {
    const username = this.passwordModalUser();
    if (!username) return;
    if (this.newPassword.length < 4) {
      this.passwordModalError.set('La password deve avere almeno 4 caratteri.');
      return;
    }
    if (this.newPassword !== this.confirmNewPassword) {
      this.passwordModalError.set('Le password non coincidono.');
      return;
    }
    this.api.updateUserPassword(username, this.newPassword).subscribe({
      next: () => {
        this.passwordModalUser.set(null);
        this.newPassword = '';
        this.confirmNewPassword = '';
        this.feedbackOk.set(true);
        this.feedback.set(`Password aggiornata per "${username}"`);
      },
      error: (err) => {
        this.passwordModalError.set(
          err?.error?.error ?? 'Aggiornamento password fallito'
        );
      },
    });
  }

  async deleteUser(username: string): Promise<void> {
    const confirmed = await this.dialog.confirm(
      `Eliminare l'utente "${username}" e la sua home directory?`,
      { title: 'Elimina Utente', confirmText: 'Elimina', danger: true }
    );
    if (!confirmed) return;
    this.api.deleteUser(username).subscribe({
      next: () => {
        this.feedbackOk.set(true);
        this.feedback.set(`Utente "${username}" eliminato`);
        this.load();
      },
      error: (err) => {
        this.feedbackOk.set(false);
        this.feedback.set(err?.error?.error ?? 'Eliminazione utente fallita');
      },
    });
  }
}
