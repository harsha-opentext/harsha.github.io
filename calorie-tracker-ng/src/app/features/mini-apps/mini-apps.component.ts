import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';

interface MiniApp {
  icon: string;
  label: string;
  route: string;
  color: string;
}

@Component({
  selector: 'app-mini-apps',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="apps-page">
      <h2 class="apps-title">Mini Apps</h2>
      <p class="apps-subtitle">Dedicated tools</p>

      <div class="apps-grid">
        @for (app of apps; track app.label) {
          <button class="app-tile" [style.--tile-color]="app.color" (click)="navigate(app.route)">
            <div class="app-icon-wrap">
              <span class="app-icon">{{ app.icon }}</span>
            </div>
            <span class="app-label">{{ app.label }}</span>
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .apps-page { display: flex; flex-direction: column; gap: 8px; padding-bottom: 32px; }
    .apps-title { font-size: 24px; font-weight: 700; color: var(--text); margin: 0 0 2px; }
    .apps-subtitle { font-size: 14px; color: var(--text-muted); margin: 0 0 20px; }
    .apps-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px 16px; }
    .app-tile {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      background: none; border: none; cursor: pointer; padding: 4px;
      -webkit-tap-highlight-color: transparent;
    }
    .app-tile:active .app-icon-wrap { transform: scale(0.92); }
    .app-icon-wrap {
      width: 72px; height: 72px; border-radius: 18px;
      background: var(--tile-color, var(--primary));
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 3px 10px rgba(0,0,0,.18);
      transition: transform .15s;
    }
    .app-icon { font-size: 34px; line-height: 1; }
    .app-label { font-size: 12px; font-weight: 500; color: var(--text); text-align: center; max-width: 80px; line-height: 1.3; }
  `],
})
export class MiniAppsComponent {
  private readonly router = inject(Router);

  readonly apps: MiniApp[] = [
    { icon: '🔥', label: 'Streaks',          route: '/streaks', color: '#ff6b35' },
    { icon: '📈', label: 'Trend Explorer',   route: '/trend',   color: '#5856d6' },
    { icon: '📄', label: 'Report Generator', route: '/report',  color: '#34c759' },
  ];

  navigate(route: string): void { this.router.navigate([route]); }
}

