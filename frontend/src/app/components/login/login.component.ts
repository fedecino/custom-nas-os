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
import { ApiService, LoginScreenSettings } from '../../services/api.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="relative flex min-h-screen flex-col items-center justify-center bg-cover bg-center p-4"
      [ngStyle]="resolvedBgStyle()"
    >
      <div
        class="absolute inset-0 bg-slate-950/55"
        [class.backdrop-blur-md]="config().blurBackground"
      ></div>

      @if (config().showClock) {
        <div class="relative z-10 mb-6 text-center">
          <div class="text-5xl font-semibold tracking-tight text-white drop-shadow">
            {{ clock() }}
          </div>
          <div class="mt-1 text-xs capitalize text-slate-200/90">
            {{ dateLabel() }}
          </div>
        </div>
      }

      <div
        class="relative z-10 w-full max-w-sm rounded-3xl border border-[#1e293b] bg-[#0f172a]/90 p-8 shadow-2xl backdrop-blur-2xl"
      >
        <div class="flex flex-col items-center text-center">
          @if (config().showLogo) {
            <img
              src="/siloos-logo.svg"
              alt="SiloOs"
              class="mb-3 h-16 w-auto rounded-xl border border-[#1e293b] shadow-lg shadow-[#38bdf8]/15"
            />
          } @else {
            <h1 class="text-2xl font-bold tracking-tight text-[#f8fafc]">
              {{ config().title || 'SiloOs' }}
            </h1>
          }
          @if (config().showLogo && config().title && config().title !== 'SiloOS' && config().title !== 'SiloOs') {
            <h1 class="text-lg font-bold tracking-tight text-[#f8fafc]">
              {{ config().title }}
            </h1>
          }
          <p class="mt-1 text-xs text-slate-400">
            {{ config().subtitle || 'Accedi con le credenziali amministratore del NAS' }}
          </p>
        </div>

        <form (ngSubmit)="submit()" class="mt-6 space-y-4">
          <div>
            <label class="block text-xs font-medium text-slate-300">
              Username
            </label>
            <input
              type="text"
              [(ngModel)]="username"
              name="username"
              autocomplete="username"
              placeholder="es. fede"
              class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-300">
              Password
            </label>
            <input
              type="password"
              [(ngModel)]="password"
              name="password"
              autocomplete="current-password"
              placeholder="••••••••"
              class="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
            />
          </div>

          @if (error()) {
            <div
              class="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs text-rose-200"
            >
              {{ error() }}
            </div>
          }

          <button
            type="submit"
            [disabled]="loading() || !username.trim() || !password"
            class="w-full rounded-xl bg-gradient-to-r from-[#38bdf8] to-[#00ff88] py-2.5 text-sm font-semibold text-[#090e1a] shadow-lg shadow-[#38bdf8]/20 transition hover:brightness-110 disabled:opacity-50"
          >
            {{ loading() ? 'Accesso in corso...' : 'Accedi' }}
          </button>
        </form>
      </div>
    </div>
  `,
})
export class LoginComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);

  @Input() backgroundStyle: Record<string, string> = {
    'background-image': "url('/silo-wallpaper.svg')",
  };
  @Output() loggedIn = new EventEmitter<string>();

  config = signal<LoginScreenSettings>({
    title: 'SiloOS',
    subtitle: 'Accedi con le credenziali amministratore del NAS',
    showClock: true,
    showLogo: true,
    blurBackground: true,
    useCustomWallpaper: false,
  });

  desktopWallpaper = signal<string | null>(null);
  clock = signal('');
  dateLabel = signal('');
  username = '';
  password = '';
  loading = signal(false);
  error = signal<string | null>(null);
  private clockTimer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.updateClock();
    this.clockTimer = setInterval(() => this.updateClock(), 1000);
    this.api.getLoginConfig().subscribe({
      next: (res) => {
        if (res.loginScreen) this.config.set(res.loginScreen);
        this.desktopWallpaper.set(res.wallpaper);
      },
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    if (this.clockTimer) clearInterval(this.clockTimer);
  }

  private updateClock(): void {
    const now = new Date();
    this.clock.set(
      now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    );
    this.dateLabel.set(
      now.toLocaleDateString('it-IT', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    );
  }

  resolvedBgStyle(): Record<string, string> {
    if (this.config().useCustomWallpaper) {
      return { 'background-image': "url('/api/settings/login-wallpaper/image')" };
    }
    if (this.desktopWallpaper() === 'custom') {
      return { 'background-image': "url('/api/settings/wallpaper/image')" };
    }
    return this.backgroundStyle;
  }

  submit(): void {
    if (!this.username.trim() || !this.password) return;
    this.loading.set(true);
    this.error.set(null);

    this.api.login(this.username.trim(), this.password).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.password = '';
        this.loggedIn.emit(res.username);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.error ?? 'Accesso negato');
      },
    });
  }
}
