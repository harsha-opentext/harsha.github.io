import { Routes } from '@angular/router';

export const WORKOUT_LOGS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./workout-logs.component').then(m => m.WorkoutLogsComponent),
  },
];
