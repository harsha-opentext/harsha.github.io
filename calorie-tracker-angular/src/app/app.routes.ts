import { Routes } from '@angular/router';
import { TrackerForm } from './components/tracker-form/tracker-form';
import { History } from './components/history/history';
import { Analytics } from './components/analytics/analytics';
import { Settings } from './components/settings/settings';
import { Logs } from './components/logs/logs';

export const routes: Routes = [
  { path: '', redirectTo: '/tracker', pathMatch: 'full' },
  { path: 'tracker', component: TrackerForm },
  { path: 'history', component: History },
  { path: 'analytics', component: Analytics },
  { path: 'settings', component: Settings },
  { path: 'logs', component: Logs }
];
