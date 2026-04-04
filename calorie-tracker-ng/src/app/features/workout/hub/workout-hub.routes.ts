import { Routes } from '@angular/router';

export const WORKOUT_HUB_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./workout-hub.component').then(m => m.WorkoutHubComponent),
  },
];
