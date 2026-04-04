import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SettingsService } from './settings.service';
import { ConfigService } from '../../core/services/config.service';
import { AuthService } from '../../core/services/auth.service';
import { StateService } from '../../core/services/state.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings-page">
      <div class="sub-nav">
        <button class="hub-back-btn" (click)="goHub()">← Hub</button>
        <h2 class="page-title">Settings</h2>
      </div>

      <!-- GitHub Credentials -->
      <section class="settings-card card">
        <h3>GitHub Connection</h3>
        <div class="field-group">
          <label class="field-label">Personal Access Token</label>
          <input
            type="password"
            class="form-input"
            [(ngModel)]="tokenInput"
            placeholder="ghp_..."
            autocomplete="new-password"
          />
        </div>
        <div class="field-group">
          <label class="field-label">Repository (owner/repo)</label>
          <input
            type="text"
            class="form-input"
            [(ngModel)]="repoInput"
            placeholder="username/my-data-repo"
          />
        </div>
        <div class="btn-row">
          <button class="btn-primary" [class.loading]="settingsSvc.validating()" (click)="saveCredentials()">
            Save & Validate
          </button>
          <button class="btn-secondary" [class.loading]="settingsSvc.validating()" (click)="settingsSvc.validateConnection()">
            Test Connection
          </button>
          <button class="btn-secondary" [class.loading]="settingsSvc.loadingFromRepo()" (click)="settingsSvc.loadFromRepo()">
            Load from Repo
          </button>
        </div>
      </section>

      <!-- Daily Budget -->
      <section class="settings-card card">
        <h3>Daily Calorie Budget</h3>
        <div class="field-group">
          <label class="field-label">Budget (kcal/day)</label>
          <input
            type="number"
            class="form-input"
            [(ngModel)]="dailyBudget"
            min="0"
            (ngModelChange)="onBudgetChange($event)"
          />
        </div>
      </section>

      <!-- Theme -->
      <section class="settings-card card">
        <h3>Appearance</h3>
        <div class="field-group">
          <label class="field-label">Theme</label>
          <select class="form-input" [(ngModel)]="theme" (ngModelChange)="settingsSvc.setTheme($event)">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">Show toast notifications</span>
          <input type="checkbox" [(ngModel)]="showToasts" (ngModelChange)="onToggle('showToasts', $event)" />
        </div>
      </section>

      <!-- Weight settings -->
      <section class="settings-card card">
        <h3>Weight Tracking</h3>
        <div class="toggle-row">
          <span class="toggle-label">Allow editing past weights</span>
          <input type="checkbox" [(ngModel)]="allowEditOlderWeights" (ngModelChange)="onToggle('allowEditOlderWeights', $event)" />
        </div>
      </section>

      <!-- Streak settings -->
      <section class="settings-card card">
        <h3>Streak</h3>
        <div class="toggle-row">
          <span class="toggle-label">Auto-increment streak on first entry</span>
          <input type="checkbox" [(ngModel)]="autoIncrementStreakOnAdd" (ngModelChange)="onToggle('autoIncrementStreakOnAdd', $event)" />
        </div>
        <div class="btn-row">
          <button class="btn-secondary" (click)="settingsSvc.computeStreak()">Recompute Streak</button>
        </div>
        <div class="streak-info">
          <span>Current: <b>{{ state.streak().currentStreak }}</b></span>
          <span>Longest: <b>{{ state.streak().longestStreak }}</b></span>
        </div>
      </section>

      <!-- Log retention -->
      <section class="settings-card card">
        <h3>Logging</h3>
        <div class="field-group">
          <label class="field-label">Log retention (minutes)</label>
          <input
            type="number"
            class="form-input"
            [(ngModel)]="logRetentionMinutes"
            min="1"
            (ngModelChange)="onLogRetentionChange($event)"
          />
        </div>
        <div class="btn-row">
          <button class="btn-secondary" (click)="log.clearLogs()">Clear Logs</button>
          <button class="btn-secondary" (click)="log.copyLogs()">Copy Logs</button>
        </div>
        <div class="log-count">{{ log.logs().length }} log entries</div>
      </section>

      <!-- Data folder config -->
      <section class="settings-card card">
        <h3>Data Configuration</h3>
        <div class="field-group">
          <label class="field-label">Data folder</label>
          <input type="text" class="form-input" [(ngModel)]="dataFolder" (ngModelChange)="onConfigChange('dataFolder', $event)" />
        </div>
        <div class="field-group">
          <label class="field-label">Schema file</label>
          <input type="text" class="form-input" [(ngModel)]="schemaFile" (ngModelChange)="onConfigChange('schemaFile', $event)" />
        </div>
      </section>

      @if (settingsSvc.saving()) {
        <div class="save-indicator">💾 Saving to repo…</div>
      }
    </div>
  `,
  styles: [`
    .settings-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .page-title { font-size: 20px; font-weight: 700; margin: 0; }
    .settings-card { padding: 18px; }
    .settings-card h3 { font-size: 16px; font-weight: 700; margin: 0 0 14px; }
    .field-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .field-label { font-size: 13px; font-weight: 600; color: var(--text-muted); }
    .form-input { padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 15px; width: 100%; box-sizing: border-box; }
    .btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border); }
    .toggle-row:last-of-type { border-bottom: none; }
    .toggle-label { font-size: 15px; color: var(--text); }
    .streak-info { display: flex; gap: 20px; margin-top: 12px; font-size: 14px; color: var(--text-muted); }
    .log-count { font-size: 13px; color: var(--text-muted); margin-top: 8px; }
    .save-indicator { text-align: center; font-size: 14px; color: var(--text-muted); padding: 8px; }
  `],
})
export class SettingsComponent implements OnInit {
  readonly settingsSvc = inject(SettingsService);
  readonly config = inject(ConfigService);
  readonly auth = inject(AuthService);
  readonly state = inject(StateService);
  readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  goHub(): void { this.router.navigate(['/calorie-hub']); }

  tokenInput = '';
  repoInput = '';
  dailyBudget = 2000;
  theme = 'system';
  showToasts = true;
  allowEditOlderWeights = false;
  autoIncrementStreakOnAdd = true;
  logRetentionMinutes = 5;
  dataFolder = 'data';
  schemaFile = 'schema.yaml';

  ngOnInit(): void {
    this.tokenInput = this.auth.getToken() ?? '';
    this.repoInput = this.auth.getRepo() ?? '';
    this.dailyBudget = this.config.getConfig('dailyBudget') as number;
    this.theme = (this.config.getConfig('theme') as string) || 'system';
    this.showToasts = this.config.getConfig('showToasts') as boolean;
    this.allowEditOlderWeights = this.config.getConfig('allowEditOlderWeights') as boolean;
    this.autoIncrementStreakOnAdd = this.config.getConfig('autoIncrementStreakOnAdd') as boolean;
    this.logRetentionMinutes = this.config.getConfig('logRetentionMinutes') as number;
    this.dataFolder = (this.config.getConfig('dataFolder') as string) || 'data';
    this.schemaFile = (this.config.getConfig('schemaFile') as string) || 'schema.yaml';
  }

  saveCredentials(): void {
    this.settingsSvc.saveCredentials(this.tokenInput, this.repoInput, this.dailyBudget);
  }

  onBudgetChange(value: number): void {
    if (value > 0) this.settingsSvc.setConfigAndSave('dailyBudget', value);
  }

  onToggle(key: string, value: boolean): void {
    this.settingsSvc.setConfigAndSave(key as keyof import('../../core/models/config.model').AppConfig, value as never);
    if (key === 'allowEditOlderWeights') {
      this.notify.showNotification(value ? 'Editing past weights enabled' : 'Editing past weights disabled', 'info');
    }
  }

  onLogRetentionChange(value: number): void {
    if (value >= 1) {
      this.settingsSvc.setConfigAndSave('logRetentionMinutes', value);
      this.state.retentionMinutes.set(value);
    }
  }

  onConfigChange(key: string, value: string): void {
    this.settingsSvc.setConfigAndSave(key as keyof import('../../core/models/config.model').AppConfig, value as never);
  }
}
