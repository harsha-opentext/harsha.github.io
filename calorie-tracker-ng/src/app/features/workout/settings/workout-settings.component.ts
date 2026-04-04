import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { WorkoutSettingsService } from './workout-settings.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { AuthService } from '../../../core/services/auth.service';
import { ConfigService } from '../../../core/services/config.service';
import { WorkoutConfig } from '../../../core/models/workout-config.model';

@Component({
  selector: 'app-workout-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="settings-page">
      <div class="page-header">
        <h2 class="page-title">Workout Settings</h2>
        <a class="btn-secondary btn-sm" routerLink="/workout/hub">← Hub</a>
      </div>

      <!-- GitHub Credentials (read-only reference to calorie tracker settings) -->
      <section class="settings-card card">
        <h3>GitHub Connection</h3>
        <p class="info-text">
          Workout data is stored in the same GitHub repository as the calorie tracker,
          under the <code>workout-data/</code> folder. Configure GitHub credentials in
          <a routerLink="/settings" class="link">Calorie Tracker → Settings</a>.
        </p>
        <div class="connection-status" [class.connected]="hasCredentials()">
          @if (hasCredentials()) {
            <span class="status-dot"></span> Connected: <strong>{{ auth.getRepo() }}</strong>
          } @else {
            <span class="status-dot off"></span> No credentials configured
          }
        </div>
      </section>

      <!-- Weekly Target -->
      <section class="settings-card card">
        <h3>Training Goal</h3>
        <div class="field-group">
          <label class="field-label">Weekly session target</label>
          <input
            type="number"
            class="form-input"
            [(ngModel)]="weeklyTarget"
            min="1"
            max="14"
            (ngModelChange)="onWeeklyTargetChange($event)"
          />
          <span class="field-hint">Sessions per week needed to count as a streak week</span>
        </div>
      </section>

      <!-- Gym Name -->
      <section class="settings-card card">
        <h3>Gym</h3>
        <div class="field-group">
          <label class="field-label">Default gym name</label>
          <input
            type="text"
            class="form-input"
            [(ngModel)]="defaultGymName"
            placeholder="Optional – e.g. Planet Fitness"
            (ngModelChange)="onGymNameChange($event)"
          />
          <span class="field-hint">Pre-fills the gym name field when logging a new session</span>
        </div>
      </section>

      @if (settingsSvc.saving()) {
        <div class="save-indicator">💾 Saving…</div>
      }
    </div>
  `,
  styles: [`
    .settings-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .page-header { display: flex; align-items: center; justify-content: space-between; }
    .page-title { font-size: 20px; font-weight: 700; margin: 0; }
    .settings-card { padding: 18px; }
    .settings-card h3 { font-size: 16px; font-weight: 700; margin: 0 0 14px; }
    .field-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .field-label { font-size: 13px; font-weight: 600; color: var(--text-muted); }
    .field-hint { font-size: 12px; color: var(--text-muted); }
    .form-input { padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 15px; width: 100%; box-sizing: border-box; }
    .form-input:focus { outline: none; border-color: var(--primary); }
    .info-text { font-size: 14px; color: var(--text-muted); margin: 0 0 12px; line-height: 1.5; }
    .link { color: var(--primary); text-decoration: none; }
    code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
    .connection-status { display: flex; align-items: center; gap: 8px; font-size: 14px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); display: inline-block; }
    .status-dot.off { background: var(--text-muted); }
    .connection-status.connected { color: var(--success); }
    .save-indicator { text-align: center; font-size: 14px; color: var(--text-muted); padding: 8px; }
    .btn-sm { font-size: 13px; padding: 8px 12px; min-height: 36px; text-decoration: none; border-radius: 10px; display: inline-flex; align-items: center; }
  `],
})
export class WorkoutSettingsComponent implements OnInit {
  readonly settingsSvc = inject(WorkoutSettingsService);
  readonly workoutState = inject(WorkoutStateService);
  readonly auth = inject(AuthService);
  private readonly config = inject(ConfigService);

  weeklyTarget = 5;
  defaultGymName = '';

  ngOnInit(): void {
    const cfg = this.workoutState.config();
    this.weeklyTarget = cfg.weeklyTarget;
    this.defaultGymName = cfg.defaultGymName ?? '';
  }

  hasCredentials(): boolean {
    return this.auth.hasCredentials();
  }

  onWeeklyTargetChange(value: number): void {
    const v = Math.max(1, Math.min(14, value || 1));
    const cfg: WorkoutConfig = { ...this.workoutState.config(), weeklyTarget: v };
    this.settingsSvc.enqueueConfigSave(cfg);
  }

  onGymNameChange(value: string): void {
    const cfg: WorkoutConfig = {
      ...this.workoutState.config(),
      defaultGymName: value.trim() || undefined,
    };
    this.settingsSvc.enqueueConfigSave(cfg);
  }
}
