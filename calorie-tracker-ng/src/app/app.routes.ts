import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'tracker', pathMatch: 'full' },
  {
    path: 'tracker',
    loadChildren: () => import('./features/tracker/tracker.routes').then(m => m.TRACKER_ROUTES),
  },
  {
    path: 'history',
    loadChildren: () => import('./features/history/history.routes').then(m => m.HISTORY_ROUTES),
  },
  {
    path: 'analytics',
    loadChildren: () => import('./features/analytics/analytics.routes').then(m => m.ANALYTICS_ROUTES),
  },
  {
    path: 'settings',
    loadChildren: () => import('./features/settings/settings.routes').then(m => m.SETTINGS_ROUTES),
  },
  {
    path: 'logs',
    loadChildren: () => import('./features/logs/logs.routes').then(m => m.LOGS_ROUTES),
  },
  {
    path: 'streaks',
    loadChildren: () => import('./features/streaks/streaks.routes').then(m => m.STREAKS_ROUTES),
  },
  {
    path: 'apps',
    loadChildren: () => import('./features/mini-apps/mini-apps.routes').then(m => m.MINI_APPS_ROUTES),
  },
  {
    path: 'trend',
    loadChildren: () => import('./features/trend-explorer/trend-explorer.routes').then(m => m.TREND_EXPLORER_ROUTES),
  },
  {
    path: 'report',
    loadChildren: () => import('./features/report-generator/report-generator.routes').then(m => m.REPORT_GENERATOR_ROUTES),
  },
  { path: '**', redirectTo: 'tracker' },
];
