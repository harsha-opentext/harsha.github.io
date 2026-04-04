import { Routes } from '@angular/router';

export const CALORIE_HUB_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./calorie-hub.component').then(m => m.CalorieHubComponent),
  },
];
