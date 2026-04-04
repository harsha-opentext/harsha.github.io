import { Routes } from '@angular/router';

export const SESSION_TEMPLATES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./session-templates.component').then(m => m.SessionTemplatesComponent),
  },
];
