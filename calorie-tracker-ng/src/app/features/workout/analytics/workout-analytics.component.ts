import {
  Component, inject, OnInit, OnDestroy, AfterViewInit,
  ElementRef, ViewChild, signal, computed, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { WorkoutAnalyticsService } from './workout-analytics.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { LoggingService } from '../../../core/services/logging.service';
import { getTodayString, addDaysToDateString } from '../../../shared/utils/date.utils';

// Chart.js is loaded via CDN in index.html
declare const Chart: {
  new (canvas: HTMLCanvasElement, config: unknown): {
    destroy(): void;
    update(): void;
  };
};

@Component({
  selector: 'app-workout-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="analytics-page">
      <div class="sub-nav">
        <button class="hub-back-btn" (click)="goHub()">← Hub</button>
        <h2 class="page-title">Analytics</h2>
      </div>
      <!-- Workout selector + date range -->
      <div class="selector-card card">
        <div class="selector-row">
          <label class="selector-label">Select Workout</label>
          <select class="form-select" [(ngModel)]="selectedWorkoutId" (ngModelChange)="onWorkoutChange($event)">
            <option value="">— Choose a workout —</option>
            @for (w of workoutState.workouts(); track w.id) {
              <option [value]="w.id">{{ w.name }}</option>
            }
          </select>
        </div>
        <div class="range-row">
          <div class="range-field">
            <label class="selector-label">From</label>
            <input type="date" class="form-select" [(ngModel)]="rangeStart" />
          </div>
          <div class="range-field">
            <label class="selector-label">To</label>
            <input type="date" class="form-select" [(ngModel)]="rangeEnd" />
          </div>
        </div>
        <div class="preset-chips">
          <button class="preset-chip" (click)="setPreset(7)">7 days</button>
          <button class="preset-chip" (click)="setPreset(30)">30 days</button>
          <button class="preset-chip" (click)="setPreset(90)">90 days</button>
        </div>

        <!-- >30-day confirmation -->
        @if (confirmLarge()) {
          <div class="confirm-banner">
            <p>⚠️ This range spans {{ pendingDays() }} days. Loading may take a while.</p>
            <div class="confirm-btns">
              <button class="btn-primary btn-sm" (click)="executeRangeLoad()">Load Anyway</button>
              <button class="btn-secondary btn-sm" (click)="confirmLarge.set(false)">Cancel</button>
            </div>
          </div>
        }

        <!-- Progress bar -->
        @if (loadProgress()) {
          <div class="progress-wrap">
            <div class="progress-bar-track">
              <div class="progress-bar-fill" [style.width.%]="progressPct()"></div>
            </div>
            <p class="progress-label">Loading sessions… {{ loadProgress()!.done }} / {{ loadProgress()!.total }}</p>
          </div>
        }

        @if (!loading() && !loadProgress()) {
          <button class="btn-secondary btn-sm" (click)="startRangeLoad()">🔄 Load</button>
        }
      </div>

      @if (!selectedWorkoutId) {
        <div class="empty-state card">
          <div class="empty-icon">📊</div>
          <p>Select a workout to view analytics.</p>
        </div>
      }

      @if (selectedWorkoutId) {
        <!-- Volume Trend -->
        <div class="chart-card card">
          <h3 class="chart-title">Volume Trend</h3>
          <p class="chart-desc">Total volume (reps × kg) per session</p>
          <div class="canvas-wrap" [class.hidden-chart]="!hasVolumeData()">
            <canvas #volumeChart></canvas>
          </div>
          @if (!hasVolumeData() && !loading()) {
            <p class="no-data">No data yet.</p>
          }
        </div>

        <!-- Weight Progression -->
        <div class="chart-card card">
          <h3 class="chart-title">Weight Progression</h3>
          <p class="chart-desc">Average weight (kg) per session</p>
          <div class="canvas-wrap" [class.hidden-chart]="!hasVolumeData()">
            <canvas #weightChart></canvas>
          </div>
          @if (!hasVolumeData() && !loading()) {
            <p class="no-data">No data yet.</p>
          }
        </div>

        <!-- Reps Progression -->
        <div class="chart-card card">
          <h3 class="chart-title">Reps Progression</h3>
          <p class="chart-desc">Average reps per session</p>
          <div class="canvas-wrap" [class.hidden-chart]="!hasVolumeData()">
            <canvas #repsChart></canvas>
          </div>
          @if (!hasVolumeData() && !loading()) {
            <p class="no-data">No data yet.</p>
          }
        </div>

        <!-- Personal Records -->
        <div class="chart-card card">
          <h3 class="chart-title">Personal Records</h3>
          <p class="chart-desc">Max weight lifted per session</p>
          <div class="canvas-wrap" [class.hidden-chart]="!hasVolumeData()">
            <canvas #prChart></canvas>
          </div>
          @if (!hasVolumeData() && !loading()) {
            <p class="no-data">No data yet.</p>
          }
        </div>

        <!-- Fatigue Curve -->
        <div class="chart-card card">
          <h3 class="chart-title">Fatigue Curve</h3>
          <p class="chart-desc">Average weight by set number (across all sessions)</p>
          <div class="canvas-wrap" [class.hidden-chart]="!hasFatigueData()">
            <canvas #fatigueChart></canvas>
          </div>
          @if (!hasFatigueData() && !loading()) {
            <p class="no-data">No fatigue data yet.</p>
          }
        </div>

        <!-- Est. 1RM Progression -->
        <div class="chart-card card">
          <h3 class="chart-title">Estimated 1RM</h3>
          <p class="chart-desc">Max estimated one-rep max (Epley formula) per session</p>
          <div class="canvas-wrap" [class.hidden-chart]="!hasOneRmData()">
            <canvas #oneRmChart></canvas>
          </div>
          @if (!hasOneRmData() && !loading()) {
            <p class="no-data">No 1RM data yet (need weight & rep data).</p>
          }
        </div>
      }

      <!-- Frequency Heatmap (all workouts) -->
      <div class="chart-card card">
        <h3 class="chart-title">Session Frequency</h3>
        <p class="chart-desc">Sessions logged per week</p>
        <div class="canvas-wrap" [class.hidden-chart]="!hasFreqData()">
          <canvas #freqChart></canvas>
        </div>
        @if (!hasFreqData() && !loading()) {
          <p class="no-data">No sessions logged yet.</p>
        }
      </div>

      <!-- Muscle Group Balance -->
      <div class="chart-card card">
        <h3 class="chart-title">Muscle Group Balance</h3>
        <p class="chart-desc">Sessions involving each muscle group in loaded date range</p>
        <div class="canvas-wrap" [class.hidden-chart]="!hasMuscleBalData()">
          <canvas #muscleBalChart></canvas>
        </div>
        @if (!hasMuscleBalData() && !loading()) {
          <p class="no-data">No muscle data yet. Load a date range first.</p>
        }
      </div>

      <!-- Session Comparison Table -->
      @if (selectedWorkoutId && comparisonRows().length > 0) {
        <div class="comparison-card card">
          <h3 class="chart-title">Session Comparison (last {{ comparisonRows().length }})</h3>
          <div class="table-wrap">
            <table class="comp-table">
              <thead>
                <tr>
                  <th>Date</th><th>Sets</th><th>Volume</th><th>Avg kg</th><th>Avg reps</th>
                </tr>
              </thead>
              <tbody>
                @for (row of comparisonRows(); track row.date) {
                  <tr>
                    <td>{{ row.date }}</td>
                    <td>{{ row.totalSets }}</td>
                    <td>{{ row.totalVolume | number:'1.0-0' }}</td>
                    <td>{{ row.avgWeight | number:'1.1-1' }}</td>
                    <td>{{ row.avgReps | number:'1.1-1' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .analytics-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .selector-card { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .selector-row { display: flex; flex-direction: column; gap: 6px; }
    .selector-label { font-size: 13px; font-weight: 600; color: var(--text-muted); }
    .form-select { padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 15px; width: 100%; box-sizing: border-box; }
    .form-select:focus { outline: none; border-color: var(--primary); }
    .range-row { display: flex; flex-direction: column; gap: 10px; }
    .range-field { display: flex; flex-direction: column; gap: 6px; }
    .preset-chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .preset-chip { padding: 6px 14px; border-radius: 20px; border: 1.5px solid var(--border); background: var(--surface-2); color: var(--text); font-size: 13px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .confirm-banner { background: var(--surface-2); border: 1.5px solid var(--border); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .confirm-banner p { font-size: 14px; color: var(--text); margin: 0; }
    .confirm-btns { display: flex; gap: 8px; }
    .progress-wrap { display: flex; flex-direction: column; gap: 6px; }
    .progress-bar-track { height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
    .progress-bar-fill { height: 100%; border-radius: 4px; background: var(--primary); transition: width .3s; }
    .progress-label { font-size: 12px; color: var(--text-muted); margin: 0; text-align: center; }
    .btn-sm { font-size: 13px; padding: 8px 14px; }
    .empty-state { padding: 36px 24px; text-align: center; }
    .empty-icon { font-size: 40px; margin-bottom: 10px; }
    .empty-state p { margin: 0; font-size: 16px; color: var(--text-muted); }
    .chart-card { padding: 16px; }
    .chart-title { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
    .chart-desc { font-size: 12px; color: var(--text-muted); margin: 0 0 12px; }
    .canvas-wrap { position: relative; width: 100%; max-height: 240px; }
    .canvas-wrap.hidden-chart { display: none; }
    canvas { width: 100% !important; max-height: 240px; }
    .no-data { font-size: 14px; color: var(--text-muted); text-align: center; padding: 20px; }
    .comparison-card { padding: 16px; }
    .table-wrap { overflow-x: auto; }
    .comp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .comp-table th { text-align: left; padding: 6px 8px; border-bottom: 2px solid var(--border); color: var(--text-muted); font-weight: 600; font-size: 12px; }
    .comp-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); }
    .comp-table tr:last-child td { border-bottom: none; }
  `],
})
export class WorkoutAnalyticsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('volumeChart') volumeChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('weightChart') weightChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('repsChart') repsChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('prChart') prChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fatigueChart') fatigueChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('freqChart') freqChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('oneRmChart') oneRmChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('muscleBalChart') muscleBalChartRef!: ElementRef<HTMLCanvasElement>;

  readonly anSvc = inject(WorkoutAnalyticsService);
  readonly workoutState = inject(WorkoutStateService);
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly log = inject(LoggingService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly router = inject(Router);

  goHub(): void { this.router.navigate(['/workout/hub']); }

  selectedWorkoutId = '';
  readonly loading = signal(false);
  readonly hasVolumeData = signal(false);
  readonly hasFatigueData = signal(false);
  readonly hasFreqData = signal(false);
  readonly hasOneRmData = signal(false);
  readonly hasMuscleBalData = signal(false);
  readonly comparisonRows = signal<ReturnType<WorkoutAnalyticsService['computeComparisonTable']>>([]);

  // Range picker state
  rangeStart = addDaysToDateString(getTodayString(), -30);
  rangeEnd = getTodayString();
  readonly confirmLarge = signal(false);
  readonly pendingDays = signal(0);
  readonly loadProgress = signal<{ done: number; total: number } | null>(null);
  readonly progressPct = computed(() => {
    const p = this.loadProgress();
    if (!p || p.total === 0) return 0;
    return Math.round((p.done / p.total) * 100);
  });

  private charts: Array<{ destroy(): void } | null> = Array(8).fill(null);
  private viewReady = false;

  ngOnInit(): void {
    if (!this.workoutState.workoutsLoaded()) {
      this.workoutGithub.loadWorkouts().catch(err =>
        this.log.dbg('Analytics: load workouts failed: ' + String(err), 'error')
      );
    }
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.buildFreqChart();
    this.buildMuscleBalanceChart();
  }

  ngOnDestroy(): void {
    this.destroyAllCharts();
  }

  setPreset(days: number): void {
    this.rangeEnd = getTodayString();
    this.rangeStart = addDaysToDateString(this.rangeEnd, -days);
  }

  startRangeLoad(): void {
    if (!this.rangeStart || !this.rangeEnd || this.rangeStart > this.rangeEnd) {
      this.log.dbg('Invalid date range', 'warn');
      return;
    }
    const start = new Date(this.rangeStart + 'T00:00:00');
    const end = new Date(this.rangeEnd + 'T00:00:00');
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (days > 30) {
      this.pendingDays.set(days);
      this.confirmLarge.set(true);
      return;
    }
    void this.executeRangeLoad();
  }

  async executeRangeLoad(): Promise<void> {
    this.confirmLarge.set(false);
    this.loadProgress.set({ done: 0, total: 0 });
    this.loading.set(true);
    try {
      await this.anSvc.loadSessionsInRange(this.rangeStart, this.rangeEnd, (done, total) => {
        this.loadProgress.set({ done, total });
        this.cdr.detectChanges();
      });
      if (this.selectedWorkoutId) this.refreshCharts();
      this.buildFreqChart();
      this.buildMuscleBalanceChart();
    } finally {
      this.loading.set(false);
      this.loadProgress.set(null);
    }
  }

  onWorkoutChange(id: string): void {
    this.selectedWorkoutId = id;
    if (id) {
      this.refreshCharts();
    } else {
      this.destroyWorkoutCharts();
    }
  }

  private refreshCharts(): void {
    if (!this.viewReady) return;
    this.cdr.detectChanges(); // ensure canvases are in DOM

    const stats = this.anSvc.computePerSessionStats(this.selectedWorkoutId);
    this.hasVolumeData.set(stats.length > 0);
    this.comparisonRows.set(this.anSvc.computeComparisonTable(this.selectedWorkoutId));

    const colors = this.cssVars();
    if (stats.length > 0) {
      const labels = stats.map(s => s.date);

      this.buildLineChart(0, this.volumeChartRef, labels, stats.map(s => s.totalVolume), 'Volume (kg)', colors.primary);
      this.buildLineChart(1, this.weightChartRef, labels, stats.map(s => Math.round(s.avgWeight * 10) / 10), 'Avg Weight (kg)', colors.secondary);
      this.buildLineChart(2, this.repsChartRef, labels, stats.map(s => Math.round(s.avgReps * 10) / 10), 'Avg Reps', colors.success);
      this.buildLineChart(3, this.prChartRef, labels, stats.map(s => s.maxWeight), 'Max Weight (kg)', colors.danger);
    }

    // Est. 1RM chart
    const oneRmData = stats.filter(s => s.estimated1RM > 0);
    this.hasOneRmData.set(oneRmData.length > 0);
    if (oneRmData.length > 0) {
      this.cdr.detectChanges();
      this.buildLineChart(6, this.oneRmChartRef, oneRmData.map(s => s.date), oneRmData.map(s => Math.round(s.estimated1RM * 10) / 10), 'Est. 1RM (kg)', colors.secondary);
    }

    const fatigue = this.anSvc.computeFatigueCurve(this.selectedWorkoutId);
    this.hasFatigueData.set(fatigue.length > 0);
    if (fatigue.length > 0) {
      this.cdr.detectChanges();
      const colors = this.cssVars();
      this.destroyChart(4);
      this.charts[4] = new Chart(this.fatigueChartRef.nativeElement, {
        type: 'line',
        data: {
          labels: fatigue.map(f => `Set ${f.setNumber}`),
          datasets: [
            {
              label: 'Avg Weight (kg)',
              data: fatigue.map(f => f.avgWeight),
              borderColor: colors.primary,
              backgroundColor: colors.primaryAlpha,
              tension: 0.3,
              fill: true,
            },
            {
              label: 'Avg Reps',
              data: fatigue.map(f => f.avgReps),
              borderColor: colors.secondary,
              backgroundColor: 'transparent',
              tension: 0.3,
              yAxisID: 'reps',
            },
          ],
        },
        options: this.lineOptions('Fatigue Curve', true, 'reps', 'Reps'),
      });
    }

    this.buildFreqChart();
    this.cdr.detectChanges();
  }

  private buildFreqChart(): void {
    if (!this.viewReady || !this.freqChartRef) return;
    const freq = this.anSvc.computeFrequencyByWeek();
    this.hasFreqData.set(freq.length > 0);
    if (freq.length === 0) return;
    this.cdr.detectChanges();
    const colors = this.cssVars();
    this.destroyChart(5);
    this.charts[5] = new Chart(this.freqChartRef.nativeElement, {
      type: 'bar',
      data: {
        labels: freq.map(f => f.weekMonday),
        datasets: [{
          label: 'Sessions',
          data: freq.map(f => f.count),
          backgroundColor: colors.primaryAlpha,
          borderColor: colors.primary,
          borderWidth: 1.5,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: colors.textMuted, stepSize: 1 },
            grid: { color: colors.border },
          },
          x: {
            ticks: { color: colors.textMuted, maxRotation: 45 },
            grid: { color: colors.border },
          },
        },
      },
    });
  }

  private buildMuscleBalanceChart(): void {
    if (!this.viewReady || !this.muscleBalChartRef) return;
    const freq = this.anSvc.computeMuscleGroupFrequency(this.rangeStart, this.rangeEnd);
    this.hasMuscleBalData.set(freq.length > 0);
    if (freq.length === 0) return;
    this.cdr.detectChanges();
    const colors = this.cssVars();
    this.destroyChart(7);
    this.charts[7] = new Chart(this.muscleBalChartRef.nativeElement, {
      type: 'bar',
      data: {
        labels: freq.map(f => f.muscleGroup),
        datasets: [{
          label: 'Sessions',
          data: freq.map(f => f.sessionCount),
          backgroundColor: colors.primaryAlpha,
          borderColor: colors.primary,
          borderWidth: 1.5,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: colors.textMuted, stepSize: 1 },
            grid: { color: colors.border },
          },
          y: {
            ticks: { color: colors.textMuted },
            grid: { color: colors.border },
          },
        },
      },
    });
  }

  private buildLineChart(
    index: number,
    ref: ElementRef<HTMLCanvasElement>,
    labels: string[],
    data: number[],
    label: string,
    color: string
  ): void {
    if (!ref) return;
    this.destroyChart(index);
    const alpha = color + '33';
    this.charts[index] = new Chart(ref.nativeElement, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data,
          borderColor: color,
          backgroundColor: alpha,
          tension: 0.3,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
        }],
      },
      options: this.lineOptions(label),
    });
  }

  private lineOptions(label: string, dual = false, secondAxisId?: string, secondAxisLabel?: string): unknown {
    const colors = this.cssVars();
    const scales: Record<string, unknown> = {
      y: {
        beginAtZero: false,
        ticks: { color: colors.textMuted },
        grid: { color: colors.border },
        title: { display: true, text: label, color: colors.textMuted, font: { size: 11 } },
      },
      x: {
        ticks: { color: colors.textMuted, maxRotation: 45, font: { size: 10 } },
        grid: { color: colors.border },
      },
    };
    if (dual && secondAxisId) {
      scales[secondAxisId] = {
        position: 'right',
        beginAtZero: false,
        ticks: { color: colors.textMuted },
        grid: { display: false },
        title: { display: true, text: secondAxisLabel ?? '', color: colors.textMuted, font: { size: 11 } },
      };
    }
    return {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: dual, labels: { color: colors.text, font: { size: 11 } } },
      },
      scales,
    };
  }

  private destroyChart(index: number): void {
    if (this.charts[index]) {
      try { this.charts[index]!.destroy(); } catch { /* ignore */ }
      this.charts[index] = null;
    }
  }

  private destroyWorkoutCharts(): void {
    [0, 1, 2, 3, 4, 6].forEach(i => this.destroyChart(i));
  }

  private destroyAllCharts(): void {
    this.charts.forEach((_, i) => this.destroyChart(i));
  }

  private cssVars(): {
    primary: string; secondary: string; success: string; danger: string;
    primaryAlpha: string; text: string; textMuted: string; border: string;
  } {
    const style = getComputedStyle(document.documentElement);
    const get = (v: string) => style.getPropertyValue(v).trim();
    return {
      primary: get('--primary'),
      secondary: get('--secondary'),
      success: get('--success'),
      danger: get('--danger'),
      primaryAlpha: get('--primary') + '33',
      text: get('--text'),
      textMuted: get('--text-muted'),
      border: get('--border'),
    };
  }
}
