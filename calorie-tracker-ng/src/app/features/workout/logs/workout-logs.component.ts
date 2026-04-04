import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { LoggingService } from '../../../core/services/logging.service';

@Component({
  selector: 'app-workout-logs',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="logs-page">
      <div class="page-header">
        <div class="header-left">
          <button class="hub-back-btn" (click)="goHub()">← Hub</button>
          <h2 class="page-title">Logs</h2>
        </div>
        <button class="btn-secondary btn-sm" (click)="clearLogs()">Clear</button>
      </div>

      @if (logs().length === 0) {
        <div class="empty-state card">
          <p>No logs yet.</p>
        </div>
      }

      <div class="log-list">
        @for (entry of logs(); track entry.ts) {
          <div class="log-entry" [class]="'level-' + entry.type">
            <span class="log-time">{{ entry.ts | date:'HH:mm:ss' }}</span>
            <span class="log-badge">{{ entry.type }}</span>
            <span class="log-msg">{{ entry.text }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .logs-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .page-header { display: flex; align-items: center; justify-content: space-between; }
    .page-title { font-size: 20px; font-weight: 700; margin: 0; }
    .empty-state { padding: 32px 24px; text-align: center; }
    .empty-state p { color: var(--text-muted); margin: 0; }
    .log-list { display: flex; flex-direction: column; gap: 4px; }
    .log-entry { display: flex; gap: 8px; align-items: baseline; padding: 8px 12px; border-radius: 8px; font-size: 13px; background: var(--surface-2); }
    .log-time { color: var(--text-muted); font-size: 11px; font-family: monospace; flex-shrink: 0; }
    .log-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; flex-shrink: 0; background: var(--surface-3); color: var(--text-muted); }
    .level-error .log-badge { background: var(--danger); color: #fff; }
    .level-warn .log-badge { background: #f59e0b; color: #fff; }
    .level-info .log-badge { background: var(--primary); color: #fff; }
    .log-msg { color: var(--text); word-break: break-all; }
    .btn-sm { font-size: 13px; padding: 8px 12px; }
  `],
})
export class WorkoutLogsComponent {
  private readonly loggingSvc = inject(LoggingService);
  private readonly router = inject(Router);
  readonly logs = this.loggingSvc.logs;

  goHub(): void { this.router.navigate(['/workout/hub']); }

  clearLogs(): void {
    this.loggingSvc.logs.set([]);
  }
}
