import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { WorkoutHistoryService } from '../history/workout-history.service';
import { calculateSessionVolume } from '../../../shared/utils/workout-volume.utils';
import { getTodayString } from '../../../shared/utils/date.utils';

interface HubApp {
  label: string;
  desc: string;
  path: string;
  svgPath: string;
  color: string;
}

const HUB_APPS: HubApp[] = [
  {
    label: 'Log Session',
    desc: 'Record today\'s workout',
    path: 'log',
    svgPath: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    color: '#ef4444',
  },
  {
    label: 'Workouts',
    desc: 'Manage exercises',
    path: 'workouts',
    svgPath: 'M6.5 6.5h11M6.5 12h11M6.5 17.5h11M2 6.5h.01M2 12h.01M2 17.5h.01',
    color: '#3b82f6',
  },
  {
    label: 'Templates',
    desc: 'Session templates',
    path: 'templates',
    svgPath: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
    color: '#8b5cf6',
  },
  {
    label: 'History',
    desc: 'Past sessions',
    path: 'history',
    svgPath: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    color: '#f59e0b',
  },
  {
    label: 'Streaks',
    desc: 'Streak tracking',
    path: 'streaks',
    svgPath: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z',
    color: '#f97316',
  },
  {
    label: 'Analytics',
    desc: 'Charts & progress',
    path: 'analytics',
    svgPath: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    color: '#10b981',
  },
  {
    label: 'Reports',
    desc: 'Export session data',
    path: 'report',
    svgPath: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    color: '#06b6d4',
  },
  {
    label: 'Logs',
    desc: 'App activity logs',
    path: 'logs',
    svgPath: 'M4 6h16M4 10h16M4 14h16M4 18h16',
    color: '#6b7280',
  },
  {
    label: 'Measurements',
    desc: 'Body tracking',
    path: 'measurements',
    svgPath: 'M19 3H5a1 1 0 00-1 1v16a1 1 0 001 1h14a1 1 0 001-1V4a1 1 0 00-1-1zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z',
    color: '#14b8a6',
  },
  {
    label: 'Settings',
    desc: 'Preferences',
    path: 'settings',
    svgPath: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    color: '#64748b',
  },
];

@Component({
  selector: 'app-workout-hub',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="hub-page">
      <div class="hub-header">
        <div class="hub-header-row">
          <div>
            <h1 class="hub-title">Workout Tracker</h1>
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

      <!-- Weekly Summary -->
      <div class="summary-card card">
        <div class="summary-row">
          <div class="summary-stat">
            <span class="stat-value">{{ thisWeekCount() }}</span>
            <span class="stat-label">Sessions this week</span>
          </div>
          <div class="summary-divider"></div>
          <div class="summary-stat">
            <span class="stat-value">{{ weeklyTarget() }}</span>
            <span class="stat-label">Weekly target</span>
          </div>
          @if (thisWeekVolume() > 0) {
            <div class="summary-divider"></div>
            <div class="summary-stat">
              <span class="stat-value">{{ (thisWeekVolume() / 1000 | number:'1.1-1') }}k</span>
              <span class="stat-label">kg volume</span>
            </div>
          }
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" [style.width.%]="weekProgressPct()"></div>
        </div>
        <p class="progress-legend">{{ thisWeekCount() }} / {{ weeklyTarget() }} sessions · {{ weekProgressPct() }}%</p>
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
    .hub-header {
      padding-top: 8px;
    }
    /* Weekly summary */
    .summary-card { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .summary-row { display: flex; align-items: center; gap: 12px; }
    .summary-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1; }
    .stat-value { font-size: 22px; font-weight: 800; color: var(--primary); line-height: 1; }
    .stat-label { font-size: 11px; color: var(--text-muted); font-weight: 600; text-align: center; }
    .summary-divider { width: 1px; height: 36px; background: var(--border); flex-shrink: 0; }
    .progress-bar-track { height: 7px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
    .progress-bar-fill { height: 100%; border-radius: 4px; background: var(--primary); transition: width .4s; }
    .progress-legend { font-size: 12px; color: var(--text-muted); text-align: center; margin: 0; }
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
    .switch-btn:hover {
      border-color: var(--primary);
      color: var(--primary);
    }
    .switch-btn:active {
      transform: scale(0.96);
    }
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
    .app-tile:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-lg);
    }
    .app-tile:active {
      transform: scale(0.96);
    }
    .app-icon {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .app-label {
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
      line-height: 1.2;
    }
    .app-desc {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.3;
    }
  `],
})
export class WorkoutHubComponent {
  private readonly router = inject(Router);
  private readonly workoutState = inject(WorkoutStateService);
  private readonly histSvc = inject(WorkoutHistoryService);
  readonly apps = HUB_APPS;

  // Weekly summary computeds
  readonly thisWeekDates = computed(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysToMonday);
    const monStr = monday.toISOString().slice(0, 10);
    const todayStr = getTodayString();
    return this.histSvc.sessionDates().filter(d => d >= monStr && d <= todayStr);
  });

  readonly thisWeekCount = computed(() => this.thisWeekDates().length);

  readonly thisWeekVolume = computed(() => {
    const dates = new Set(this.thisWeekDates());
    return this.histSvc.loadedSessions()
      .filter(s => dates.has(s.date))
      .reduce((sum, s) => sum + calculateSessionVolume(s), 0);
  });

  readonly weeklyTarget = computed(() => this.workoutState.config().weeklyTarget ?? 5);

  readonly weekProgressPct = computed(() => {
    const target = this.weeklyTarget();
    if (target <= 0) return 0;
    return Math.min(100, Math.round((this.thisWeekCount() / target) * 100));
  });

  navigate(path: string): void {
    this.router.navigate(['/workout', path]);
  }

  switchTracker(): void {
    localStorage.removeItem('lastUsedTracker');
    this.router.navigate(['/home']);
  }
}
