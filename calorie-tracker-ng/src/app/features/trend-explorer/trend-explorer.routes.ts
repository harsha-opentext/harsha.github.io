import { Routes } from '@angular/router';

export const TREND_EXPLORER_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./trend-explorer.component').then(m => m.TrendExplorerComponent),
  },
];
