import { Routes } from '@angular/router';

export const REPORT_GENERATOR_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./report-generator.component').then(m => m.ReportGeneratorComponent),
  },
];
