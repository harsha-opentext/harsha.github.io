import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

interface HubApp {
  label: string;
  desc: string;
  path: string;
  svgPath: string;
  color: string;
}

const HUB_APPS: HubApp[] = [
  {
    label: 'Log Entry',
    desc: 'Track today\'s meals',
    path: '/tracker',
    svgPath: 'M12 5v14M5 12h14',
    color: '#007aff',
  },
  {
    label: 'History',
    desc: 'Browse past entries',
    path: '/history',
    svgPath: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    color: '#5856d6',
  },
  {
    label: 'Analytics',
    desc: 'Charts & macros',
    path: '/analytics',
    svgPath: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    color: '#34c759',
  },
  {
    label: 'Streaks',
    desc: 'Daily streak tracking',
    path: '/streaks',
    svgPath: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z',
    color: '#ff9500',
  },
  {
    label: 'Trends',
    desc: 'Correlate variables',
    path: '/trend',
    svgPath: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z',
    color: '#5e5ce6',
  },
  {
    label: 'Report',
    desc: 'Export tracked data',
    path: '/report',
    svgPath: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    color: '#30b0c7',
  },
  {
    label: 'Mini Apps',
    desc: 'Extra tools',
    path: '/apps',
    svgPath: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
    color: '#af52de',
  },
  {
    label: 'Logs',
    desc: 'Debug activity',
    path: '/logs',
    svgPath: 'M4 6h16M4 10h16M4 14h16M4 18h16',
    color: '#6b7280',
  },
  {
    label: 'Settings',
    desc: 'GitHub & preferences',
    path: '/settings',
    svgPath: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    color: '#64748b',
  },
];

@Component({
  selector: 'app-calorie-hub',
  standalone: true,
  template: `
    <div class="hub-page">
      <div class="hub-header">
        <div class="hub-header-row">
          <div>
            <h1 class="hub-title">Calorie Tracker</h1>
            <p class="hub-subtitle">What would you like to do?</p>
          </div>
          <button class="switch-btn" (click)="switchTracker()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
            </svg>
            Switch
          </button>
        </div>
      </div>

      <div class="apps-grid">
        @for (app of apps; track app.path) {
          <button class="app-tile card" (click)="navigate(app.path)">
            <div class="app-icon" [style.background]="app.color + '1a'" [style.color]="app.color">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path [attr.d]="app.svgPath" />
              </svg>
            </div>
            <div class="app-label">{{ app.label }}</div>
            <div class="app-desc">{{ app.desc }}</div>
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .hub-page {
      display: flex;
      flex-direction: column;
      gap: 24px;
      padding-bottom: 32px;
    }
    .hub-header { padding-top: 8px; }
    .hub-header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .hub-title {
      font-size: 24px;
      font-weight: 800;
      margin: 0 0 4px;
      color: var(--text);
    }
    .hub-subtitle {
      font-size: 14px;
      color: var(--text-muted);
      margin: 0;
    }
    .switch-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: 1.5px solid var(--border);
      border-radius: 10px;
      background: var(--surface-2);
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      -webkit-tap-highlight-color: transparent;
      transition: all 0.15s;
    }
    .switch-btn:hover { border-color: var(--primary); color: var(--primary); }
    .switch-btn:active { transform: scale(0.96); }
    .apps-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .app-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 16px 8px;
      border: none;
      border-radius: 14px;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
      background: var(--card-bg);
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      -webkit-tap-highlight-color: transparent;
    }
    .app-tile:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }
    .app-tile:active { transform: scale(0.96); }
    .app-icon {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .app-label { font-size: 13px; font-weight: 700; color: var(--text); line-height: 1.2; }
    .app-desc { font-size: 11px; color: var(--text-muted); line-height: 1.3; }
  `],
})
export class CalorieHubComponent {
  private readonly router = inject(Router);
  readonly apps = HUB_APPS;

  navigate(path: string): void {
    this.router.navigate([path]);
  }

  switchTracker(): void {
    localStorage.removeItem('lastUsedTracker');
    this.router.navigate(['/home']);
  }
}
