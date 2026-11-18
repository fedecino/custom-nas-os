import { Component, Input, OnChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { extractAppSlug } from '../../utils/app-metadata';

@Component({
  selector: 'app-docker-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#1e293b] bg-gradient-to-br from-[#141e33] to-[#0f172a] shadow-lg"
      [ngClass]="sizeClass"
    >
      @if (activeSrc()) {
        <img
          [src]="activeSrc()"
          [alt]="name"
          (error)="onImgError()"
          class="h-full w-full object-contain p-2"
          loading="lazy"
        />
      } @else {
        <span class="font-bold text-[#38bdf8]" [ngClass]="textSizeClass">
          {{ initials() }}
        </span>
      }
    </div>
  `,
})
export class DockerIconComponent implements OnChanges {
  @Input() name = '';
  @Input() image = '';
  @Input() logoUrl = '';
  @Input() size: 'sm' | 'md' | 'lg' = 'lg';

  activeSrc = signal<string | null>(null);
  private fallbacks: string[] = [];
  private fallbackIndex = 0;

  get sizeClass(): string {
    if (this.size === 'sm') return 'h-9 w-9 rounded-xl';
    if (this.size === 'md') return 'h-11 w-11 rounded-xl';
    return 'h-14 w-14 rounded-2xl';
  }

  get textSizeClass(): string {
    if (this.size === 'sm') return 'text-xs';
    if (this.size === 'md') return 'text-sm';
    return 'text-lg';
  }

  ngOnChanges(): void {
    const slug = extractAppSlug(this.name, this.image);
    const urls: string[] = [];
    if (this.logoUrl?.trim()) {
      urls.push(this.logoUrl.trim());
    }
    urls.push(`https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${encodeURIComponent(slug)}.svg`);
    urls.push(`https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${encodeURIComponent(slug)}.png`);

    this.fallbacks = urls;
    this.fallbackIndex = 0;
    this.activeSrc.set(this.fallbacks[0] ?? null);
  }

  onImgError(): void {
    this.fallbackIndex++;
    if (this.fallbackIndex < this.fallbacks.length) {
      this.activeSrc.set(this.fallbacks[this.fallbackIndex]);
    } else {
      this.activeSrc.set(null);
    }
  }

  initials(): string {
    const clean = (this.name || this.image || 'DK').replace(/^.*\//, '').trim();
    return clean.slice(0, 2).toUpperCase() || 'DK';
  }
}
