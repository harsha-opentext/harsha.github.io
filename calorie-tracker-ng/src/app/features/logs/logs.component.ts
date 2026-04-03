import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LoggingService } from '../../core/services/logging.service';
import { StateService } from '../../core/services/state.service';
import { GithubApiService } from '../../core/services/github-api.service';
import { NotificationService } from '../../core/services/notification.service';
import { LogEntry } from '../../core/models/log.model';

@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="logs-page">
      <div class="logs-toolbar">
        <h2 class="page-title">Debug Logs</h2>
        <div class="btn-row">
          <button class="btn-secondary btn-sm" (click)="log.clearLogs()">🗑️ Clear</button>
          <button class="btn-secondary btn-sm" (click)="log.copyLogs()">📋 Copy</button>
          <button class="btn-secondary btn-sm" [class.loading]="saving" (click)="saveLogs()">💾 Save to Repo</button>
        </div>
      </div>

      <div class="log-level-row">
        <label class="level-label">Level:</label>
        <select class="form-input level-select"
          [value]="state.logLevel()"
          (change)="state.logLevel.set($any($event.target).value)">
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        <span class="log-count">{{ log.logs().length }} entries</span>
      </div>

      <div class="log-list">
        @if (log.logs().length === 0) {
          <div class="empty-state">No logs yet.</div>
        }
        @for (entry of log.logs(); track entry.ts) {
          <div class="log-entry" [ngClass]="'log-' + entry.type">
            <span class="log-time">{{ entry.ts | date:'HH:mm:ss' }}</span>
            <span class="log-badge log-badge-{{ entry.type }}">{{ entry.type.toUpperCase() }}</span>
            <span class="log-msg">{{ entry.text }}</span>
            @if ($any(entry).raw) {
            <pre class="log-raw">{{ formatRaw($any(entry).raw) }}</pre>
          }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .logs-page { display: flex; flex-direction: column; gap: 12px; padding-bottom: 32px; }
    .logs-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
    .page-title { font-size: 18px; font-weight: 700; margin: 0; }
    .btn-row { display: flex; gap: 8px; }
    .log-level-row { display: flex; align-items: center; gap: 10px; }
    .level-label { font-size: 14px; color: var(--text-muted); }
    .level-select { padding: 7px 10px; border: 1.5px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 13px; max-width: 100px; }
    .log-count { font-size: 13px; color: var(--text-muted); }
    .log-list { display: flex; flex-direction: column; gap: 4px; font-family: monospace; font-size: 12px; }
    .log-entry { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; padding: 6px 10px; border-radius: 8px; border-left: 3px solid transparent; }
    .log-entry.log-error { background: rgba(255,59,48,0.12); border-left-color: #ff3b30; }
    .log-entry.log-warn { background: rgba(255,149,0,0.12); border-left-color: #ff9500; }
    .log-entry.log-info { background: var(--bg); border-left-color: var(--primary); }
    .log-entry.log-debug { background: transparent; opacity: 0.8; }
    .log-time { color: var(--text-muted); min-width: 60px; }
    .log-badge { padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; }
    .log-badge-error { background: #ff3b30; color: #fff; }
    .log-badge-warn { background: #ff9500; color: #fff; }
    .log-badge-info { background: var(--primary); color: #fff; }
    .log-badge-debug { background: #8e8e93; color: #fff; }
    .log-msg { flex: 1; color: var(--text); word-break: break-word; }
    .log-raw { width: 100%; margin: 4px 0 0; padding: 6px 8px; background: rgba(0,0,0,.05); border-radius: 4px; font-size: 11px; white-space: pre-wrap; word-break: break-all; overflow: auto; max-height: 120px; }
    .empty-state { padding: 20px; color: var(--text-muted); text-align: center; }
    .form-input { padding: 7px 10px; border: 1.5px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 13px; }
    .btn-sm { font-size: 13px; padding: 7px 12px; }
  `],
})
export class LogsComponent {
  readonly log = inject(LoggingService);
  readonly state = inject(StateService);
  private readonly github = inject(GithubApiService);
  private readonly notify = inject(NotificationService);

  saving = false;

  async saveLogs(): Promise<void> {
    this.saving = true;
    try {
      const logStrings = this.log.logs().map(e =>
        `[${new Date(e.ts).toISOString()}] [${e.type.toUpperCase()}] ${e.text}`
      );
      const ok = await this.github.saveLogs(logStrings);
      if (ok) this.notify.showNotification('Logs saved to repo', 'write');
      else this.notify.showNotification('Failed to save logs', 'error');
    } finally {
      this.saving = false;
    }
  }

  formatRaw(raw: unknown): string {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'string') return raw;
    try { return JSON.stringify(raw, null, 2); } catch { return String(raw); }
  }
}
