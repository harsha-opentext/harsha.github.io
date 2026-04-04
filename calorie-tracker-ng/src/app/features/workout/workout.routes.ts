import { Routes } from '@angular/router';

export const WORKOUT_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'hub',
    pathMatch: 'full',
  },
  {
    path: 'hub',
    loadChildren: () => import('./hub/workout-hub.routes').then(m => m.WORKOUT_HUB_ROUTES),
  },
  {
    path: 'log',
    loadChildren: () => import('./log/session-log.routes').then(m => m.SESSION_LOG_ROUTES),
  },
  {
    path: 'workouts',
    loadChildren: () => import('./workouts/workouts.routes').then(m => m.WORKOUTS_ROUTES),
  },
  {
    path: 'history',
    loadChildren: () => import('./history/workout-history.routes').then(m => m.WORKOUT_HISTORY_ROUTES),
  },
  {
    path: 'streaks',
    loadChildren: () => import('./streaks/workout-streaks.routes').then(m => m.WORKOUT_STREAKS_ROUTES),
  },
  {
    path: 'analytics',
    loadChildren: () => import('./analytics/workout-analytics.routes').then(m => m.WORKOUT_ANALYTICS_ROUTES),
  },
  {
    path: 'settings',
    loadChildren: () => import('./settings/workout-settings.routes').then(m => m.WORKOUT_SETTINGS_ROUTES),
  },
  {
    path: 'templates',
    loadChildren: () => import('./templates/session-templates.routes').then(m => m.SESSION_TEMPLATES_ROUTES),
  },
  {
    path: 'logs',
    loadChildren: () => import('./logs/workout-logs.routes').then(m => m.WORKOUT_LOGS_ROUTES),
  },
  {
    path: 'report',
    loadChildren: () => import('./report/workout-report.routes').then(m => m.WORKOUT_REPORT_ROUTES),
  },
];
