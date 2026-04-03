import { Routes } from '@angular/router';

export const MINI_APPS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./mini-apps.component').then(m => m.MiniAppsComponent),
  },
];
