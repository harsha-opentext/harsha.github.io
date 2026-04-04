import { Routes } from '@angular/router';

export const WORKOUT_REPORT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./workout-report.component').then(m => m.WorkoutReportComponent),
  },
];
