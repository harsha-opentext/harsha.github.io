import { Injectable, inject } from '@angular/core';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly config = inject(ConfigService);
  private mediaQuery: MediaQueryList | null = null;
  private mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

  initTheme(): void {
    const stored = localStorage.getItem('gt_theme') as 'auto' | 'dark' | 'light' | null;
    this.applyTheme(stored ?? this.config.getConfig('theme'));

    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaListener = (e: MediaQueryListEvent): void => {
      const current = localStorage.getItem('gt_theme') as 'auto' | 'dark' | 'light' | null;
      if (!current || current === 'auto') {
        this.applyThemeToDocument('auto');
      }
    };
    this.mediaQuery.addEventListener('change', this.mediaListener);
  }

  applyTheme(mode: 'auto' | 'dark' | 'light'): void {
    localStorage.setItem('gt_theme', mode);
    this.applyThemeToDocument(mode);
  }

  private applyThemeToDocument(mode: 'auto' | 'dark' | 'light'): void {
    const html = document.documentElement;
    if (mode === 'auto') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', mode);
    }
  }

  setTheme(mode: 'auto' | 'dark' | 'light'): void {
    this.config.setConfig('theme', mode);
    this.applyTheme(mode);
  }

  getCurrentTheme(): 'auto' | 'dark' | 'light' {
    return (localStorage.getItem('gt_theme') as 'auto' | 'dark' | 'light') ?? 'auto';
  }
}
