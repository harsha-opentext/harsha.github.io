import { Routes } from '@angular/router';

export const MEASUREMENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./measurements.component').then(m => m.MeasurementsComponent),
  },
];
