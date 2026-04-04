import { Routes } from '@angular/router';

function smartRedirect(): string {
  const last = localStorage.getItem('lastUsedTracker');
  if (last === 'workout') return '/workout';
  if (last === 'calorie') return '/calorie-hub';
  return '/home';
}

export const routes: Routes = [
  { path: '', redirectTo: smartRedirect, pathMatch: 'full' },
  {
    path: 'calorie-hub',
    loadChildren: () => import('./features/calorie-hub/calorie-hub.routes').then(m => m.CALORIE_HUB_ROUTES),
  },
  {
    path: 'home',
    loadChildren: () => import('./features/home/home.routes').then(m => m.HOME_ROUTES),
  },
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
  {
    path: 'workout',
    loadChildren: () => import('./features/workout/workout.routes').then(m => m.WORKOUT_ROUTES),
  },
  { path: '**', redirectTo: smartRedirect },
];
