import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { WorkoutAnalyticsService } from '../analytics/workout-analytics.service';
import { getTodayString, addDaysToDateString } from '../../../shared/utils/date.utils';

@Component({
  selector: 'app-workout-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="report-page">
      <div class="page-header">
        <button class="hub-back-btn" (click)="goHub()">← Hub</button>
        <h2 class="page-title">Report Generator</h2>
      </div>

      <div class="controls card">
        <div class="field-group">
          <label class="field-label">From</label>
          <input type="date" class="form-input" [(ngModel)]="rangeStart" />
        </div>
        <div class="field-group">
          <label class="field-label">To</label>
          <input type="date" class="form-input" [(ngModel)]="rangeEnd" />
        </div>
        <div class="preset-chips">
          <button class="preset-chip" (click)="setPreset(7)">7 days</button>
          <button class="preset-chip" (click)="setPreset(30)">30 days</button>
          <button class="preset-chip" (click)="setPreset(90)">90 days</button>
        </div>
        @if (loading()) {
          <div class="progress-wrap">
            <div class="progress-bar-track">
              <div class="progress-bar-fill" [style.width.%]="progressPct()"></div>
            </div>
            <p class="progress-label">Loading {{ progressDone() }} / {{ progressTotal() }} sessions…</p>
          </div>
        } @else {
          <button class="btn-primary" (click)="generate()">Generate & Export CSV</button>
        }
      </div>

      @if (exportedRows()) {
        <div class="result-card card">
          <p class="result-text">✅ Exported <strong>{{ exportedRows() }}</strong> session rows to <code>workout-report.csv</code>.</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .report-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .page-header { display: flex; align-items: center; justify-content: space-between; }
    .page-title { font-size: 20px; font-weight: 700; margin: 0; }
    .controls { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .field-group { display: flex; flex-direction: column; gap: 6px; }
    .field-label { font-size: 13px; font-weight: 600; color: var(--text-muted); }
    .form-input { padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 15px; width: 100%; box-sizing: border-box; }
    .form-input:focus { outline: none; border-color: var(--primary); }
    .preset-chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .preset-chip { padding: 6px 14px; border-radius: 20px; border: 1.5px solid var(--border); background: var(--surface-2); color: var(--text); font-size: 13px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .progress-wrap { display: flex; flex-direction: column; gap: 6px; }
    .progress-bar-track { height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
    .progress-bar-fill { height: 100%; border-radius: 4px; background: var(--primary); transition: width .3s; }
    .progress-label { font-size: 12px; color: var(--text-muted); margin: 0; text-align: center; }
    .result-card { padding: 16px; }
    .result-text { margin: 0; font-size: 14px; color: var(--text); }
    code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  `],
})
export class WorkoutReportComponent {
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly workoutState = inject(WorkoutStateService);
  private readonly anSvc = inject(WorkoutAnalyticsService);
  private readonly router = inject(Router);

  goHub(): void { this.router.navigate(['/workout/hub']); }

  rangeStart = addDaysToDateString(getTodayString(), -30);
  rangeEnd = getTodayString();
  readonly loading = signal(false);
  readonly progressDone = signal(0);
  readonly progressTotal = signal(0);
  readonly progressPct = () => {
    const total = this.progressTotal();
    return total === 0 ? 0 : Math.round((this.progressDone() / total) * 100);
  };
  readonly exportedRows = signal(0);

  setPreset(days: number): void {
    this.rangeEnd = getTodayString();
    this.rangeStart = addDaysToDateString(this.rangeEnd, -days);
  }

  async generate(): Promise<void> {
    this.loading.set(true);
    this.exportedRows.set(0);
    try {
      await this.anSvc.loadSessionsInRange(this.rangeStart, this.rangeEnd, (done, total) => {
        this.progressDone.set(done);
        this.progressTotal.set(total);
      });
      this.downloadCsv();
    } finally {
      this.loading.set(false);
    }
  }

  private downloadCsv(): void {
    const sessions = this.workoutState.sessions().filter(
      s => s.date >= this.rangeStart && s.date <= this.rangeEnd
    );
    const escape = (v: string | number | undefined) => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'date,gym,mood,exercise,set,reps,weightKg,restSec,volume';
    const rows: string[] = [header];
    for (const session of sessions) {
      for (const entry of session.entries) {
        const workout = this.workoutState.workouts().find(w => w.id === entry.workoutId);
        const name = workout?.name ?? entry.workoutId;
        for (const set of entry.sets) {
          const vol = set.reps * set.weightKg;
          rows.push([
            escape(session.date),
            escape(session.gymName),
            escape(session.mood),
            escape(name),
            escape(set.setNumber),
            escape(set.reps),
            escape(set.weightKg),
            escape(set.breakSeconds),
            escape(vol),
          ].join(','));
        }
      }
    }
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workout-report-${this.rangeStart}-to-${this.rangeEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.exportedRows.set(rows.length - 1);
  }
}
