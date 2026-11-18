import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  ContainerInfo,
  InspectedImage,
  NasSettingsResponse,
  ProcessMemoryInfo,
  SharesResponse,
  StackInfo,
  SystemInfo,
  SystemNotification,
} from './services/api.service';
import { HubSearchComponent } from './components/hub-search/hub-search.component';
import { ComposeEditorComponent } from './components/compose-editor/compose-editor.component';
import { StorageManagerComponent } from './components/storage-manager/storage-manager.component';
import { SharesManagerComponent } from './components/shares-manager/shares-manager.component';
import { UsersManagerComponent } from './components/users-manager/users-manager.component';
import {
  SettingsAppComponent,
  SettingsCategory,
} from './components/settings-app/settings-app.component';
import { AiAssistantComponent } from './components/ai-assistant/ai-assistant.component';
import { ServicesManagerComponent } from './components/services-manager/services-manager.component';
import { LogsViewerComponent } from './components/logs-viewer/logs-viewer.component';
import { FileManagerComponent } from './components/file-manager/file-manager.component';
import { LoginComponent } from './components/login/login.component';
import { DialogHostComponent } from './components/dialog-host/dialog-host.component';
import { DialogService } from './services/dialog.service';
import { TerminalAppComponent } from './components/terminal-app/terminal-app.component';
import { DockerIconComponent } from './components/docker-icon/docker-icon.component';
import { describeDockerApp } from './utils/app-metadata';

type ActiveWindow =
  | 'store'
  | 'files'
  | 'storage'
  | 'shares'
  | 'users'
  | 'settings'
  | 'ai'
  | 'services'
  | 'logs'
  | 'terminal'
  | null;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HubSearchComponent,
    ComposeEditorComponent,
    StorageManagerComponent,
    SharesManagerComponent,
    UsersManagerComponent,
    SettingsAppComponent,
    AiAssistantComponent,
    ServicesManagerComponent,
    LogsViewerComponent,
    FileManagerComponent,
    LoginComponent,
    DialogHostComponent,
    TerminalAppComponent,
    DockerIconComponent,
  ],
  template: `
    @if (!authChecked()) {
      <div class="flex min-h-screen flex-col items-center justify-center bg-[#090e1a] text-slate-300">
        <img src="/siloos-icon-disco.svg" alt="SiloOs" class="h-16 w-16 animate-pulse" />
        <span class="mt-3 text-xs tracking-wider uppercase text-[#38bdf8]">Avvio SiloOs...</span>
      </div>
    } @else if (!authenticated()) {
      <app-login
        [backgroundStyle]="wallpaperStyle()"
        (loggedIn)="onLoggedIn($event)"
      />
    } @else {
    <div
      class="relative flex min-h-screen flex-col overflow-x-hidden bg-cover bg-center text-slate-100 transition-colors duration-700"
      [ngClass]="wallpaperClass()"
      [ngStyle]="wallpaperStyle()"
    >
      <!-- Ambient SiloOs glow -->
      <div class="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          class="absolute -left-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-[#38bdf8]/15 blur-[140px]"
        ></div>
        <div
          class="absolute -bottom-32 right-0 h-[30rem] w-[30rem] rounded-full bg-[#00ff88]/10 blur-[140px]"
        ></div>
      </div>

      <!-- Top Bar with Hamburger Menu on the left of SiloOs logo -->
      <header
        class="relative z-30 flex items-center justify-between border-b border-[#1e293b] bg-[#090e1a]/80 px-5 py-2.5 backdrop-blur-md"
      >
        <div class="relative flex items-center gap-3">
          <button
            type="button"
            (click)="toggleHamburgerMenu($event)"
            title="Menu SiloOs"
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/15"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <img
            src="/siloos-icon-disco.svg"
            alt="SiloOs"
            class="h-7 w-7 rounded-lg shadow"
          />
          <span class="text-sm font-bold tracking-tight text-[#f8fafc]">
            Silo<span class="text-[#38bdf8]">Os</span>
          </span>

          @if (menuOpen()) {
            <div
              (click)="$event.stopPropagation()"
              class="absolute left-0 top-11 z-50 w-60 rounded-2xl border border-[#1e293b] bg-[#0f172a]/95 p-2 shadow-2xl backdrop-blur-xl"
            >
              @for (item of menuItems; track item.id) {
                <button
                  type="button"
                  (click)="openMenuItem(item)"
                  class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs text-slate-200 transition hover:bg-white/10"
                >
                  <span class="text-sm">{{ item.icon }}</span>
                  <span class="font-medium">{{ item.label }}</span>
                </button>
              }
            </div>
          }
        </div>

        <div class="flex items-center gap-3 text-xs text-slate-300">
          <div class="relative">
            <button
              type="button"
              (click)="toggleNotificationsMenu($event)"
              title="Notifiche di sistema"
              class="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-200 transition hover:bg-white/15"
            >
              🔔
              @if (notifications().length > 0) {
                <span
                  class="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#00ff88]"
                ></span>
              }
            </button>
            @if (notificationsOpen()) {
              <div
                (click)="$event.stopPropagation()"
                class="absolute right-0 top-10 z-50 w-80 rounded-2xl border border-[#1e293b] bg-[#0f172a]/95 p-3 shadow-2xl backdrop-blur-xl"
              >
                <div class="mb-2 flex items-center justify-between text-xs font-semibold text-white">
                  <span>Notifiche di Sistema</span>
                  <button
                    type="button"
                    (click)="notificationsOpen.set(false)"
                    class="text-slate-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
                @if (notifications().length === 0) {
                  <p class="py-4 text-center text-xs text-slate-500">
                    Nessuna notifica recente.
                  </p>
                } @else {
                  <div class="max-h-64 space-y-2 overflow-y-auto">
                    @for (n of notifications(); track n.id) {
                      <div class="rounded-xl border border-white/10 bg-black/30 p-2.5 text-xs">
                        <div class="font-semibold text-[#38bdf8]">{{ n.title }}</div>
                        <div class="mt-0.5 text-[11px] text-slate-300">{{ n.message }}</div>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
          @if (sharesData(); as sh) {
            <div class="hidden items-center gap-1.5 sm:flex">
              <span
                class="rounded-full px-2 py-0.5 text-[10px]"
                [ngClass]="
                  sh.services.smb.active
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-white/10 text-slate-400'
                "
              >
                SMB
              </span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px]"
                [ngClass]="
                  sh.services.nfs.active
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-white/10 text-slate-400'
                "
              >
                NFS
              </span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px]"
                [ngClass]="
                  sh.services.ssh.active
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-white/10 text-slate-400'
                "
              >
                SSH
              </span>
            </div>
          }
          @if (systemInfo(); as sys) {
            <span class="font-mono text-[11px] text-slate-300">{{ sys.hostname }}</span>
          }
          @if (currentUser(); as user) {
            <span class="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-slate-200">
              {{ user }}
            </span>
          }
          <button
            type="button"
            (click)="logout()"
            class="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/15"
          >
            Esci
          </button>
        </div>
      </header>

      <!-- CasaOS 2-Column Workspace -->
      <main
        class="relative z-10 mx-auto grid w-full max-w-[1380px] flex-1 grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-12 sm:px-8"
      >
        <!-- LEFT SIDEBAR: Clock, Performance (CPU/RAM rings + Net), Storage, Shares -->
        <aside class="space-y-4 lg:col-span-4 xl:col-span-3">
          @if (backendError()) {
            <div
              class="rounded-2xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-xs text-rose-200 backdrop-blur-xl"
            >
              <div class="font-semibold">Backend API non raggiungibile</div>
              <div class="mt-0.5 text-[11px] text-rose-200/80">
                {{ backendError() }}
              </div>
            </div>
          }

          <!-- Clock & Date Card -->
          <div
            class="rounded-2xl border border-white/15 bg-white/[0.08] px-5 py-4 shadow-xl backdrop-blur-xl"
          >
            <div class="text-4xl font-semibold tracking-tight text-white">
              {{ clock() }}
            </div>
            <div class="mt-1 text-xs text-slate-300 capitalize">
              {{ dateLabel() }}
            </div>
          </div>

          <!-- Performance Card (CPU & RAM Donut Rings + Network) -->
          <div
            class="rounded-2xl border border-white/15 bg-white/[0.08] p-5 shadow-xl backdrop-blur-xl"
          >
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-medium text-white">Performance</h2>
              <span class="text-[11px] text-slate-300">
                @if (systemInfo(); as sys) {
                  Up {{ formatUptime(sys.uptimeSeconds) }}
                } @else {
                  —
                }
              </span>
            </div>

            <div class="mt-4 grid grid-cols-2 gap-4 text-center">
              <!-- CPU Ring -->
              <div class="flex flex-col items-center">
                <div class="relative h-20 w-20">
                  <svg viewBox="0 0 36 36" class="h-full w-full -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke="rgba(255,255,255,0.14)"
                      stroke-width="3.2"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke="#38bdf8"
                      stroke-width="3.2"
                      stroke-linecap="round"
                      [attr.stroke-dasharray]="94.25"
                      [attr.stroke-dashoffset]="
                        ringOffset(systemInfo()?.cpu?.usagePercent ?? 0)
                      "
                    />
                  </svg>
                  <div
                    class="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white"
                  >
                    {{ systemInfo() ? systemInfo()!.cpu.usagePercent + '%' : '—' }}
                  </div>
                </div>
                <span class="mt-1.5 text-xs font-medium text-slate-200">CPU</span>
                @if (systemInfo(); as sys) {
                  <span class="text-[10px] text-slate-400">
                    {{ sys.cpu.cores }} core
                  </span>
                }
              </div>

              <!-- RAM Ring (Clickable to inspect processes) -->
              <button
                type="button"
                (click)="openRamProcessesModal()"
                title="Clicca per vedere i processi che usano la RAM"
                class="group flex flex-col items-center rounded-xl p-1 transition hover:bg-white/10"
              >
                <div class="relative h-20 w-20">
                  <svg viewBox="0 0 36 36" class="h-full w-full -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke="rgba(255,255,255,0.14)"
                      stroke-width="3.2"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke="#00ff88"
                      stroke-width="3.2"
                      stroke-linecap="round"
                      [attr.stroke-dasharray]="94.25"
                      [attr.stroke-dashoffset]="
                        ringOffset(systemInfo()?.memory?.usedPercent ?? 0)
                      "
                    />
                  </svg>
                  <div
                    class="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white"
                  >
                    {{ systemInfo() ? systemInfo()!.memory.usedPercent + '%' : '—' }}
                  </div>
                </div>
                <span class="mt-1.5 text-xs font-medium text-slate-200 group-hover:text-emerald-300">
                  RAM ↗
                </span>
                @if (systemInfo(); as sys) {
                  <span class="text-[10px] text-slate-400">
                    {{ formatBytes(sys.memory.usedBytes) }} / {{ formatBytes(sys.memory.totalBytes) }}
                  </span>
                }
              </button>
            </div>

            <!-- CPU Model Info -->
            @if (systemInfo(); as sys) {
              <div
                class="mt-3 truncate border-t border-white/10 pt-2.5 text-[11px] text-slate-300"
                [title]="sys.cpu.model"
              >
                🖥️ {{ sys.cpu.model }}
              </div>
            }

            <!-- Live Network Speed Bar -->
            <div
              class="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[11px] text-slate-300"
            >
              <span>
                ↓ <strong class="text-[#38bdf8]">{{ formatSpeed(systemInfo()?.network?.rxBytesPerSec ?? 0) }}</strong>
              </span>
              <span>
                ↑ <strong class="text-[#00ff88]">{{ formatSpeed(systemInfo()?.network?.txBytesPerSec ?? 0) }}</strong>
              </span>
            </div>
          </div>

          <!-- Storage Card (CasaOS Style) -->
          <div
            (click)="openSettings('storage')"
            class="cursor-pointer rounded-2xl border border-white/15 bg-white/[0.08] p-5 shadow-xl backdrop-blur-xl transition hover:border-sky-400/50"
          >
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-medium text-white">Storage</h2>
              <span class="text-slate-300" title="Gestisci Dischi">⚙️</span>
            </div>

            @if (primaryDisk(); as disk) {
              <div class="mt-3 flex items-center gap-4">
                <div
                  class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#1e293b] bg-[#0f172a] shadow"
                >
                  <svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="16" rx="3" fill="#141e33"/>
                    <line x1="3" y1="14" x2="21" y2="14"/>
                    <circle cx="17.5" cy="17" r="1" fill="#00ff88" stroke="none"/>
                    <line x1="7" y1="17" x2="11" y2="17" stroke="#94a3b8"/>
                  </svg>
                </div>
                <div class="min-w-0 flex-1 text-xs">
                  <span
                    class="inline-block rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white"
                  >
                    Health
                  </span>
                  <div class="mt-1.5 text-slate-200">
                    Used: {{ formatBytes(disk.usedBytes) }}
                  </div>
                  <div class="text-slate-300">
                    Total: {{ formatBytes(disk.sizeBytes) }}
                  </div>
                </div>
              </div>
              <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/15">
                <div
                  class="h-full rounded-full bg-sky-500 transition-all duration-500"
                  [style.width.%]="disk.usedPercent"
                ></div>
              </div>
            } @else {
              <p class="mt-3 text-xs text-slate-300">
                Clicca per visualizzare dischi e partizioni
              </p>
            }
          </div>

          <!-- Quick Settings / Shares Link -->
          <button
            type="button"
            (click)="openSettings('shares')"
            class="flex w-full items-center justify-between rounded-2xl border border-white/15 bg-white/[0.08] px-5 py-3.5 text-left text-xs font-medium text-white shadow-xl backdrop-blur-xl transition hover:border-sky-400/50"
          >
            <span>Condivisioni SMB / NFS / FTP</span>
            <span class="text-slate-300">›</span>
          </button>
        </aside>

        <!-- RIGHT MAIN AREA: Search, Feature Cards, Installed Applications Grid -->
        <section class="space-y-6 lg:col-span-8 xl:col-span-9">
          <!-- Top Search Bar -->
          <form (ngSubmit)="onSearchSubmit()">
            <div class="relative">
              <span
                class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              >
                🔍
              </span>
              <input
                type="text"
                [(ngModel)]="desktopSearch"
                name="desktopSearch"
                placeholder="Search installed apps or press Enter to search Docker Hub..."
                class="w-full rounded-2xl border border-white/15 bg-white/[0.08] py-3 pl-11 pr-4 text-sm text-white placeholder-slate-400 shadow-lg backdrop-blur-xl focus:border-sky-400/60 focus:outline-none"
              />
            </div>
          </form>

          <!-- Two CasaOS-style Feature Cards -->
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div
              class="flex items-center justify-between rounded-2xl border border-white/15 bg-white/[0.08] p-5 shadow-lg backdrop-blur-xl"
            >
              <div class="pr-4">
                <h3 class="text-sm font-semibold text-white">
                  Condivisioni & Rete NAS
                </h3>
                <p class="mt-1 text-xs leading-relaxed text-slate-300">
                  Configura cartelle condivise SMB, NFS, FTP/SFTP e gestisci dischi fisici e SMART.
                </p>
                <div class="mt-3 flex gap-2">
                  <button
                    type="button"
                    (click)="openSettings('shares')"
                    class="rounded-full bg-sky-500 px-3.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-400"
                  >
                    Condivisioni
                  </button>
                  <button
                    type="button"
                    (click)="openSettings('storage')"
                    class="rounded-full bg-white/15 px-3.5 py-1 text-[11px] font-medium text-white hover:bg-white/25"
                  >
                    Dischi
                  </button>
                </div>
              </div>
              <div class="text-4xl">📁</div>
            </div>

            <div
              class="flex items-center justify-between rounded-2xl border border-white/15 bg-white/[0.08] p-5 shadow-lg backdrop-blur-xl"
            >
              <div class="pr-4">
                <h3 class="text-sm font-semibold text-white">
                  Assistente AI Locale / Cloud
                </h3>
                <p class="mt-1 text-xs leading-relaxed text-slate-300">
                  Gestisci container, dischi e condivisioni via chat con Ollama, LM Studio, OpenAI o Gemini.
                </p>
                <div class="mt-3 flex gap-2">
                  <button
                    type="button"
                    (click)="activeWindow.set('ai')"
                    class="rounded-full bg-sky-500 px-3.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-400"
                  >
                    Apri AI Agent
                  </button>
                  <button
                    type="button"
                    (click)="openSettings('ai')"
                    class="rounded-full bg-white/15 px-3.5 py-1 text-[11px] font-medium text-white hover:bg-white/25"
                  >
                    API Key
                  </button>
                </div>
              </div>
              <div class="text-4xl">🤖</div>
            </div>
          </div>

          <!-- Installed Applications Grid (CasaOS Style) -->
          <div>
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-base font-semibold text-white">
                Installed applications
              </h2>
            </div>

            <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              <!-- Core App Store Tile -->
              <button
                type="button"
                (click)="activeWindow.set('store')"
                class="group flex flex-col items-center justify-center rounded-2xl border border-white/15 bg-white/[0.08] p-5 text-center shadow-lg backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-sky-400/50 hover:bg-white/[0.14]"
              >
                <div
                  class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-2xl shadow-lg transition group-hover:scale-105"
                >
                  🛍️
                </div>
                <span class="mt-3 text-xs font-medium text-white">App Store</span>
              </button>

              <!-- Core Files (File Manager) Tile -->
              <button
                type="button"
                (click)="activeWindow.set('files')"
                class="group flex flex-col items-center justify-center rounded-2xl border border-white/15 bg-white/[0.08] p-5 text-center shadow-lg backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-sky-400/50 hover:bg-white/[0.14]"
              >
                <div
                  class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 text-2xl shadow-lg transition group-hover:scale-105"
                >
                  📁
                </div>
                <span class="mt-3 text-xs font-medium text-white">Files</span>
              </button>

              <!-- Core Services & Ports Tile -->
              <button
                type="button"
                (click)="activeWindow.set('services')"
                class="group flex flex-col items-center justify-center rounded-2xl border border-white/15 bg-white/[0.08] p-5 text-center shadow-lg backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-sky-400/50 hover:bg-white/[0.14]"
              >
                <div
                  class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-2xl shadow-lg transition group-hover:scale-105"
                >
                  🔌
                </div>
                <span class="mt-3 text-xs font-medium text-white">Servizi & Porte</span>
              </button>

              <!-- Core Logs Tile -->
              <button
                type="button"
                (click)="activeWindow.set('logs')"
                class="group flex flex-col items-center justify-center rounded-2xl border border-white/15 bg-white/[0.08] p-5 text-center shadow-lg backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-sky-400/50 hover:bg-white/[0.14]"
              >
                <div
                  class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-2xl shadow-lg transition group-hover:scale-105"
                >
                  📜
                </div>
                <span class="mt-3 text-xs font-medium text-white">Log di Sistema</span>
              </button>

              <!-- Core Web Terminal Tile -->
              <button
                type="button"
                (click)="activeWindow.set('terminal')"
                class="group flex flex-col items-center justify-center rounded-2xl border border-white/15 bg-white/[0.08] p-5 text-center shadow-lg backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-sky-400/50 hover:bg-white/[0.14]"
              >
                <div
                  class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 text-2xl font-mono font-bold text-[#00ff88] shadow-lg transition group-hover:scale-105"
                >
                  &gt;_
                </div>
                <span class="mt-3 text-xs font-medium text-white">Terminale</span>
              </button>

              <!-- Docker Installed Stacks -->
              @for (stack of filteredStacks(); track stack.name) {
                <div
                  class="group relative flex flex-col items-center justify-center rounded-2xl border border-white/15 bg-white/[0.08] p-5 text-center shadow-lg backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.14]"
                >
                  <!-- Status dot -->
                  <span
                    class="absolute left-3.5 top-3.5 h-2 w-2 rounded-full"
                    [ngClass]="{
                      'bg-emerald-400': stack.status === 'running',
                      'bg-amber-400': stack.status === 'partial',
                      'bg-slate-500': stack.status === 'stopped'
                    }"
                  ></span>

                  <!-- Context Menu Trigger -->
                  <button
                    type="button"
                    (click)="toggleStackMenu(stack.name, $event)"
                    class="absolute right-2.5 top-2.5 rounded-lg px-1.5 py-0.5 text-xs text-slate-300 hover:bg-white/15 hover:text-white"
                    title="Opzioni app"
                  >
                    ⋮
                  </button>

                  <button
                    type="button"
                    (click)="openStackApp(stack)"
                    [title]="getStackDescription(stack)"
                    class="flex h-full w-full cursor-pointer flex-col items-center justify-center"
                  >
                    <app-docker-icon
                      class="transition group-hover:scale-105"
                      [name]="stack.name"
                      [image]="stack.containers[0]?.image ?? ''"
                      size="lg"
                    />
                    <span class="mt-3 max-w-full truncate text-xs font-medium text-white">
                      {{ stack.name }}
                    </span>
                    <span class="mt-0.5 line-clamp-2 text-[10px] leading-tight text-slate-400">
                      {{ getStackDescription(stack) }}
                    </span>
                    @if (getWebPort(stack); as port) {
                      <span class="mt-1 font-mono text-[10px] text-[#38bdf8]/80">
                        :{{ port }} ↗
                      </span>
                    }
                  </button>

                  <!-- Quick Dropdown Menu -->
                  @if (openMenuStack() === stack.name) {
                    <div
                      (click)="$event.stopPropagation()"
                      class="absolute right-2 top-9 z-30 w-36 rounded-xl border border-white/15 bg-slate-900/95 p-1.5 text-left text-xs shadow-2xl backdrop-blur-xl"
                    >
                      @if (getWebPort(stack); as port) {
                        <a
                          [href]="getAppUrl(port)"
                          target="_blank"
                          class="block rounded-lg px-2.5 py-1.5 text-sky-300 hover:bg-white/10"
                        >
                          Apri (:{{ port }}) ↗
                        </a>
                      }
                      @if (stack.status !== 'running') {
                        <button
                          (click)="runStackAction(stack.name, 'start')"
                          class="block w-full rounded-lg px-2.5 py-1.5 text-left text-emerald-300 hover:bg-white/10"
                        >
                          Avvia
                        </button>
                      } @else {
                        <button
                          (click)="runStackAction(stack.name, 'stop')"
                          class="block w-full rounded-lg px-2.5 py-1.5 text-left text-amber-300 hover:bg-white/10"
                        >
                          Stop
                        </button>
                        <button
                          (click)="runStackAction(stack.name, 'restart')"
                          class="block w-full rounded-lg px-2.5 py-1.5 text-left text-slate-200 hover:bg-white/10"
                        >
                          Riavvia
                        </button>
                      }
                      @if (stack.hasComposeFile) {
                        <button
                          (click)="openExistingStackEditor(stack.name)"
                          class="block w-full rounded-lg px-2.5 py-1.5 text-left text-slate-200 hover:bg-white/10"
                        >
                          Modifica YAML
                        </button>
                        <button
                          (click)="openStackLogs(stack.name)"
                          class="block w-full rounded-lg px-2.5 py-1.5 text-left text-slate-200 hover:bg-white/10"
                        >
                          Logs
                        </button>
                        <button
                          (click)="runStackAction(stack.name, 'remove')"
                          class="block w-full rounded-lg px-2.5 py-1.5 text-left text-rose-300 hover:bg-white/10"
                        >
                          Rimuovi
                        </button>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </section>
      </main>

      <!-- CasaOS-style minimal footer -->
      <footer
        class="relative z-10 flex items-center justify-between px-6 py-3 text-[11px] text-slate-400"
      >
        <div class="flex items-center gap-2">
          <span class="font-semibold text-slate-200">{{ uiSettings().nasName }}</span>
          <span class="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-[#38bdf8]">
            v{{ appVersion() }}
          </span>
        </div>
        <span>SiloOs Storage & Container Platform</span>
      </footer>

      <!-- OS Window Modal -->
      @if (activeWindow(); as win) {
        <div
          class="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-3 sm:p-6 backdrop-blur-md"
        >
          <div
            class="flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-[#0f172a]/95 shadow-2xl"
          >
            <div
              class="flex items-center justify-between border-b border-white/10 bg-black/30 px-6 py-3.5"
            >
              <div class="flex items-center gap-2.5">
                <button
                  (click)="activeWindow.set(null)"
                  class="h-3 w-3 rounded-full bg-rose-500 hover:bg-rose-400"
                  title="Chiudi"
                ></button>
                <span class="ml-2 text-sm font-semibold text-white">
                  {{ getWindowTitle(win) }}
                </span>
              </div>
              <button
                (click)="activeWindow.set(null)"
                class="rounded-lg px-2.5 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-white"
              >
                Chiudi ✕
              </button>
            </div>

            <div class="flex-1 overflow-y-auto p-6">
              @switch (win) {
                @case ('store') {
                  <app-hub-search
                    [installedStacks]="stacks()"
                    (inspected)="openInspectedEditor($event)"
                    (openExisting)="openExistingStackEditor($event)"
                    (openCustomCompose)="openCustomComposeEditor($event)"
                    (deployed)="refreshAll()"
                  />
                }
                @case ('files') {
                  <app-file-manager />
                }
                @case ('storage') {
                  <app-storage-manager />
                }
                @case ('shares') {
                  <app-shares-manager />
                }
                @case ('users') {
                  <app-users-manager />
                }
                @case ('settings') {
                  <app-settings-app
                    [initialCategory]="settingsCategory()"
                    (updated)="onSettingsUpdated($event)"
                  />
                }
                @case ('ai') {
                  <app-ai-assistant
                    [aiEnabled]="uiSettings().ai.enabled"
                    (openSettings)="openSettings('ai')"
                    (actionExecuted)="refreshAll()"
                  />
                }
                @case ('services') {
                  <app-services-manager />
                }
                @case ('logs') {
                  <app-logs-viewer />
                }
                @case ('terminal') {
                  <app-terminal-app />
                }
              }
            </div>
          </div>
        </div>
      }

      <!-- Compose YAML Editor Modal -->
      @if (editorState(); as ed) {
        <app-compose-editor
          [inspected]="ed.inspected"
          [stackName]="ed.stackName"
          [initialYaml]="ed.initialYaml"
          [lockStackName]="ed.lockStackName"
          (close)="editorState.set(null)"
          (deployed)="onStackDeployed()"
        />
      }

      <!-- Live Container Logs Modal -->
      @if (logsStack(); as stackName) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div
            class="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-slate-950 shadow-2xl"
          >
            <div
              class="flex items-center justify-between border-b border-white/10 px-5 py-3.5"
            >
              <div class="flex items-center gap-2.5">
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <h3 class="font-semibold text-white">Live Logs · {{ stackName }}</h3>
              </div>
              <button
                (click)="closeLogs()"
                class="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div
              class="flex-1 overflow-y-auto bg-[#070b12] p-4 font-mono text-xs leading-relaxed text-slate-200"
            >
              @for (line of liveLogLines(); track $index) {
                <div class="whitespace-pre-wrap break-all">{{ line }}</div>
              }
            </div>
          </div>
        </div>
      }
      <!-- RAM Processes Modal -->
      @if (ramModalOpen()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div
            class="flex h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-slate-950 shadow-2xl"
          >
            <div
              class="flex items-center justify-between border-b border-white/10 px-6 py-4"
            >
              <div>
                <h3 class="text-base font-semibold text-white">
                  Utilizzo Memoria RAM & Processi
                </h3>
                @if (systemInfo(); as sys) {
                  <p class="text-xs text-slate-400">
                    Occupata: {{ formatBytes(sys.memory.usedBytes) }} · Disponibile: {{ formatBytes(sys.memory.availableBytes) }} · Totale: {{ formatBytes(sys.memory.totalBytes) }}
                  </p>
                }
              </div>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  (click)="loadRamProcesses()"
                  class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
                >
                  Aggiorna
                </button>
                <button
                  type="button"
                  (click)="ramModalOpen.set(false)"
                  class="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-y-auto p-4">
              <table class="w-full text-left text-xs">
                <thead class="border-b border-white/10 text-[11px] uppercase text-slate-400">
                  <tr>
                    <th class="px-3 py-2.5">PID</th>
                    <th class="px-3 py-2.5">Utente</th>
                    <th class="px-3 py-2.5">Processo</th>
                    <th class="px-3 py-2.5 text-right">RAM</th>
                    <th class="px-3 py-2.5 text-right">% RAM</th>
                    <th class="px-3 py-2.5 text-right">% CPU</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-white/5">
                  @for (proc of ramProcesses(); track proc.pid) {
                    <tr class="hover:bg-white/[0.03]">
                      <td class="px-3 py-2 font-mono text-slate-400">{{ proc.pid }}</td>
                      <td class="px-3 py-2 text-slate-300">{{ proc.user }}</td>
                      <td class="px-3 py-2">
                        <div class="font-semibold text-white">{{ proc.command }}</div>
                        <div class="max-w-md truncate font-mono text-[10px] text-slate-500">
                          {{ proc.args }}
                        </div>
                      </td>
                      <td class="px-3 py-2 text-right font-mono text-emerald-300">
                        {{ formatBytes(proc.rssBytes) }}
                      </td>
                      <td class="px-3 py-2 text-right font-mono text-slate-200">
                        {{ proc.memPercent }}%
                      </td>
                      <td class="px-3 py-2 text-right font-mono text-sky-300">
                        {{ proc.cpuPercent }}%
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }

      <!-- Live Device & System Toast Notifications -->
      @if (activeToasts().length > 0) {
        <div class="fixed right-4 top-14 z-50 flex w-80 flex-col gap-2">
          @for (t of activeToasts(); track t.id) {
            <div
              class="rounded-2xl border border-white/15 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-xl"
            >
              <div class="flex items-start justify-between gap-2">
                <span class="text-xs font-semibold text-sky-300">{{ t.title }}</span>
                <button
                  type="button"
                  (click)="dismissToast(t.id)"
                  class="text-[11px] text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              <p class="mt-1 text-[11px] text-slate-200">{{ t.message }}</p>
            </div>
          }
        </div>
      }
    </div>
    }
    <app-dialog-host />
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(DialogService);

  authChecked = signal(false);
  authenticated = signal(false);
  currentUser = signal<string | null>(null);
  wallpaperVersion = signal(Date.now());

  activeWindow = signal<ActiveWindow>(null);
  systemInfo = signal<SystemInfo | null>(null);
  backendError = signal<string | null>(null);
  stacks = signal<StackInfo[]>([]);
  standaloneContainers = signal<ContainerInfo[]>([]);
  sharesData = signal<SharesResponse | null>(null);
  openMenuStack = signal<string | null>(null);
  notifications = signal<SystemNotification[]>([]);
  activeToasts = signal<SystemNotification[]>([]);
  notificationsOpen = signal(false);
  menuOpen = signal(false);
  settingsCategory = signal<SettingsCategory>('desktop');
  ramModalOpen = signal(false);

    menuItems: Array<{
      id: Exclude<ActiveWindow, null>;
      settingsCat?: SettingsCategory;
      label: string;
      icon: string;
    }> = [
      { id: 'store', label: 'App Store', icon: '🛍️' },
      { id: 'files', label: 'Files (File Manager)', icon: '📁' },
      { id: 'settings', settingsCat: 'storage', label: 'Dischi & Storage', icon: '🖴' },
      { id: 'settings', settingsCat: 'shares', label: 'Condivisioni (SMB/NFS/FTP)', icon: '🔗' },
      { id: 'settings', settingsCat: 'services', label: 'Servizi, Porte & Firewall', icon: '🔌' },
      { id: 'settings', settingsCat: 'users', label: 'Utenti & Permessi', icon: '👤' },
      { id: 'logs', label: 'Log di Sistema', icon: '📜' },
      { id: 'terminal', label: 'Terminale Web', icon: '💻' },
      { id: 'ai', label: 'AI Agent', icon: '🤖' },
      { id: 'settings', settingsCat: 'desktop', label: 'Impostazioni', icon: '⚙️' },
    ];
    ramProcesses = signal<ProcessMemoryInfo[]>([]);
    appVersion = signal('1.0.0');
    desktopSearch = '';

    uiSettings = signal<NasSettingsResponse['settings']>({
      nasName: 'SiloOS',
      wallpaper: 'silo-landscape',
      ai: {
        enabled: false,
        providerType: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.2',
      },
    });

    clock = signal('');
    dateLabel = signal('');

    editorState = signal<{
      inspected: InspectedImage | null;
      stackName: string;
      initialYaml: string;
      lockStackName: boolean;
    } | null>(null);

    logsStack = signal<string | null>(null);
    liveLogLines = signal<string[]>([]);
    private logsEventSource ?: EventSource;
    private systemEventsSource ?: EventSource;
    private telemetryTimer ?: ReturnType<typeof setInterval>;
    private refreshTimer ?: ReturnType<typeof setInterval>;
    private clockTimer ?: ReturnType<typeof setInterval>;

    ngOnInit(): void {
      this.updateClock();
      this.clockTimer = setInterval(() => this.updateClock(), 1000);
      this.api.getAuthStatus().subscribe({
        next: (res) => {
          this.authChecked.set(true);
          if (res.authenticated) {
            this.authenticated.set(true);
            this.currentUser.set(res.username);
            this.startAuthenticatedSession();
          }
        },
        error: () => {
          this.authChecked.set(true);
        },
      });
    }

  onLoggedIn(username: string): void {
      this.authenticated.set(true);
      this.currentUser.set(username);
      this.startAuthenticatedSession();
    }

  logout(): void {
      this.api.logout().subscribe({
        next: () => {
          this.authenticated.set(false);
          this.currentUser.set(null);
          this.activeWindow.set(null);
          this.systemEventsSource?.close();
          if (this.telemetryTimer) clearInterval(this.telemetryTimer);
          if (this.refreshTimer) clearInterval(this.refreshTimer);
        },
      });
    }

  private startAuthenticatedSession(): void {
      this.refreshTelemetry();
      this.refreshAll();
      if(this.telemetryTimer) clearInterval(this.telemetryTimer);
      if(this.refreshTimer) clearInterval(this.refreshTimer);
      this.telemetryTimer = setInterval(() => this.refreshTelemetry(), 2000);
      this.refreshTimer = setInterval(() => this.refreshAll(), 6000);

      this.api.getSettings().subscribe({
        next: (res) => {
          this.uiSettings.set(res.settings);
          if (res.version) this.appVersion.set(res.version);
          document.title = `${res.settings.nasName} v${res.version || this.appVersion()}`;
        },
        error: () => { },
      });

      this.systemEventsSource?.close();
      this.systemEventsSource = this.api.streamSystemEvents(
        (evt) => {
          this.notifications.update((list) => [evt, ...list].slice(0, 30));
          this.activeToasts.update((list) => [evt, ...list].slice(0, 4));
          setTimeout(() => this.dismissToast(evt.id), 6000);
        },
        (history) => {
          this.notifications.set(history);
        }
      );
    }

  openSettings(cat: SettingsCategory): void {
      this.settingsCategory.set(cat);
      this.activeWindow.set('settings');
    }

  openMenuItem(item: {
      id: Exclude<ActiveWindow, null>;
      settingsCat?: SettingsCategory;
    }): void {
      this.menuOpen.set(false);
      if(item.settingsCat) {
      this.openSettings(item.settingsCat);
    } else {
      this.activeWindow.set(item.id);
    }
  }

onSettingsUpdated(settings: NasSettingsResponse['settings']): void {
  this.uiSettings.set(settings);
  if(settings.wallpaper === 'custom') {
  this.wallpaperVersion.set(Date.now());
}
  }

ngOnDestroy(): void {
  this.logsEventSource?.close();
  this.systemEventsSource?.close();
  if(this.telemetryTimer) clearInterval(this.telemetryTimer);
  if(this.refreshTimer) clearInterval(this.refreshTimer);
  if(this.clockTimer) clearInterval(this.clockTimer);
}

dismissToast(id: string): void {
  this.activeToasts.update((list) => list.filter((t) => t.id !== id));
}

openRamProcessesModal(): void {
  this.ramModalOpen.set(true);
  this.loadRamProcesses();
}

loadRamProcesses(): void {
  this.api.getTopMemoryProcesses().subscribe({
    next: (res) => this.ramProcesses.set(res.processes),
    error: () => { },
  });
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

refreshTelemetry(): void {
  this.api.getSystemInfo().subscribe({
    next: (info) => {
      this.backendError.set(null);
      this.systemInfo.set(info);
    },
    error: (err) => {
      const msg =
        err?.status === 502 || err?.status === 504 || err?.status === 0
          ? `Backend non attivo sulla porta 3000 (HTTP ${err.status}).`
          : `Errore API sistema (HTTP ${err?.status || '?'})`;
      this.backendError.set(msg);
    },
  });
}

refreshAll(): void {
  this.api.getStacks().subscribe({
    next: (res) => {
      this.stacks.set(res.stacks);
      this.standaloneContainers.set(res.standaloneContainers);
    },
    error: () => { },
  });
  this.api.getShares().subscribe({
    next: (res) => this.sharesData.set(res),
    error: () => { },
  });
}

ringOffset(percent: number): number {
  const circumference = 2 * Math.PI * 15; // ~94.25
  const clamped = Math.min(100, Math.max(0, percent));
  return circumference - (clamped / 100) * circumference;
}

primaryDisk() {
  const disks = this.systemInfo()?.disks ?? [];
  return (
    disks.find((d) => d.mountpoint === '/DATA') ??
    disks.find((d) => d.mountpoint === '/') ??
    disks[0] ??
    null
  );
}

filteredStacks(): StackInfo[] {
  const q = this.desktopSearch.trim().toLowerCase();
  if (!q) return this.stacks();
  return this.stacks().filter((s) => s.name.toLowerCase().includes(q));
}

onSearchSubmit(): void {
  if(this.desktopSearch.trim() && this.filteredStacks().length === 0) {
  this.activeWindow.set('store');
}
  }

@HostListener('document:click')
@HostListener('document:keydown.escape')
closeAllMenus(): void {
  if (this.menuOpen()) this.menuOpen.set(false);
  if (this.notificationsOpen()) this.notificationsOpen.set(false);
  if (this.openMenuStack()) this.openMenuStack.set(null);
}

toggleHamburgerMenu(event: MouseEvent): void {
  event.stopPropagation();
  const next = !this.menuOpen();
  this.menuOpen.set(next);
  if (next) {
    this.notificationsOpen.set(false);
    this.openMenuStack.set(null);
  }
}

toggleNotificationsMenu(event: MouseEvent): void {
  event.stopPropagation();
  const next = !this.notificationsOpen();
  this.notificationsOpen.set(next);
  if (next) {
    this.menuOpen.set(false);
    this.openMenuStack.set(null);
  }
}

toggleStackMenu(name: string, event?: MouseEvent): void {
  event?.stopPropagation();
  const next = this.openMenuStack() === name ? null : name;
  this.openMenuStack.set(next);
  if (next) {
    this.menuOpen.set(false);
    this.notificationsOpen.set(false);
  }
}

wallpaperClass(): string {
  switch (this.uiSettings().wallpaper) {
    case 'midnight':
      return 'bg-gradient-to-br from-slate-950 via-purple-950/85 to-slate-900';
    case 'ocean':
      return 'bg-gradient-to-br from-[#071929] via-[#0c3554] to-[#0a2538]';
    case 'carbon':
      return 'bg-gradient-to-br from-zinc-950 via-neutral-900 to-zinc-900';
    case 'aurora':
      return 'bg-gradient-to-br from-[#092138] via-[#123d5e] to-[#0b263d]';
    default:
      return 'bg-[#090e1a]';
  }
}

wallpaperStyle(): Record < string, string > {
  const wp = this.uiSettings().wallpaper;
  if(wp === 'custom') {
  return {
    'background-image': `url('/api/settings/wallpaper/image?v=${this.wallpaperVersion()}')`,
  };
}
if (wp === 'silo-landscape') {
  return {
    'background-image': "url('/silo-wallpaper.svg')",
  };
}
return {};
  }

getWindowTitle(win: Exclude<ActiveWindow, null>): string {
  const titles: Record<Exclude<ActiveWindow, null>, string> = {
    store: 'Docker App Store',
    files: 'Files — File Manager',
    storage: 'Storage & Dischi',
    shares: 'Condivisioni & Protocolli',
    users: 'Utenti & Permessi',
    settings: 'Impostazioni Sistema',
    ai: 'SiloOs AI Agent',
    services: 'Servizi & Porte Attive',
    logs: 'Log di Sistema (journalctl)',
    terminal: 'Terminale Web (Bash)',
  };
  return titles[win];
}

getStackDescription(stack: StackInfo): string {
  return describeDockerApp(stack.name, stack.containers[0]?.image);
}

getWebPort(stack: StackInfo): string | null {
  const tcpPorts: string[] = [];
  for (const c of stack.containers) {
    if (!c.ports) continue;
    for (const m of c.ports.matchAll(/:(\d+)->(\d+)\/tcp/g)) {
      if (m[1]) tcpPorts.push(m[1]);
    }
    if (tcpPorts.length === 0) {
      for (const m of c.ports.matchAll(/:(\d+)->/g)) {
        if (m[1]) tcpPorts.push(m[1]);
      }
    }
  }
  if (tcpPorts.length === 0) return null;

  const preferred = ['8096', '80', '8080', '9000', '3000', '5000', '8000', '443', '8443'];
  return tcpPorts.find((p) => preferred.includes(p)) ?? tcpPorts[0];
}

getAppUrl(port: string): string {
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

openStackApp(stack: StackInfo): void {
  const port = this.getWebPort(stack);
  if(port) {
    window.open(this.getAppUrl(port), '_blank', 'noopener');
  } else {
    this.toggleStackMenu(stack.name);
  }
}

async runStackAction(
  name: string,
  action: 'start' | 'stop' | 'restart' | 'remove'
): Promise<void> {
  this.openMenuStack.set(null);
  if (action === 'remove') {
    const confirmed = await this.dialog.confirm(
      `Rimuovere lo stack "${name}" e fermare i suoi container?`,
      { title: 'Rimuovi Stack', confirmText: 'Rimuovi', danger: true }
    );
    if (!confirmed) return;
  }
this.api.stackAction(name, action).subscribe({
  next: () => this.refreshAll(),
  error: () => { },
});
  }

openInspectedEditor(inspected: InspectedImage): void {
  this.editorState.set({
    inspected,
    stackName: inspected.appName,
    initialYaml: inspected.composeYaml,
    lockStackName: false,
  });
}

openCustomComposeEditor(event: {
  stackName: string;
  yamlContent: string;
  lockStackName?: boolean;
}): void {
  this.editorState.set({
    inspected: null,
    stackName: event.stackName,
    initialYaml: event.yamlContent,
    lockStackName: Boolean(event.lockStackName),
  });
}

openExistingStackEditor(stackName: string): void {
  this.openMenuStack.set(null);
  this.api.getStackCompose(stackName).subscribe({
    next: (res) => {
      this.editorState.set({
        inspected: null,
        stackName: res.stackName,
        initialYaml: res.yamlContent,
        lockStackName: true,
      });
    },
    error: () => { },
  });
}

onStackDeployed(): void {
  this.activeWindow.set(null);
  this.refreshAll();
}

openStackLogs(stackName: string): void {
  this.openMenuStack.set(null);
  this.logsEventSource?.close();
  this.logsStack.set(stackName);
  this.liveLogLines.set([]);
  this.logsEventSource = this.api.streamStackLogs(
    stackName,
    (msg) => {
      this.liveLogLines.update((prev) => [...prev.slice(-400), msg]);
    },
    () => { },
    () => { }
  );
}

closeLogs(): void {
  this.logsEventSource?.close();
  this.logsStack.set(null);
}

formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytesPerSec) / Math.log(1024)));
  return `${(bytesPerSec / Math.pow(1024, i)).toFixed(i >= 1 ? 1 : 0)} ${units[i]}`;
}

formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
}
