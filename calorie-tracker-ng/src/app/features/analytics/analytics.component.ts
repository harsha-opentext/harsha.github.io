import {
  Component, inject, OnInit, OnDestroy, AfterViewInit,
  ElementRef, ViewChild, ChangeDetectorRef, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnalyticsService } from './analytics.service';
import { StateService } from '../../core/services/state.service';
import { getTodayString } from '../../shared/utils/date.utils';
import { LoggingService } from '../../core/services/logging.service';

const DONUT_COLORS = ['#007aff', '#5856d6', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#ff6b00', '#30b0c7'];

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <div class="analytics-page">

      <!-- Header / date picker -->
      <div class="analytics-header card">
        <label class="date-label">Date</label>
        <input
          type="date"
          class="form-input date-input"
          [ngModel]="anSvc.selectedDate()"
          (ngModelChange)="onDateChange($event)"
        />
        @if (anSvc.loading()) {
          <span class="loading-text">⏳ Loading…</span>
        }
      </div>

      <!-- Meal distribution -->
      <div class="chart-card card">
        <div class="chart-header">
          <h3>Meal Distribution</h3>
          @if (mealTotal() > 0) {
            <span class="total-badge">{{ mealTotal() | number: '1.0-0' }} kcal</span>
          }
        </div>
        <!-- canvas always stays in DOM so ViewChild is stable; hidden when no data -->
        <div class="canvas-wrap" [class.hidden-chart]="!hasMealData()">
          <canvas #mealChart></canvas>
        </div>
        @if (!hasMealData() && !anSvc.loading()) {
          <p class="no-data">No meal data for this date.</p>
        }
      </div>

      <!-- Macro distribution -->
      <div class="chart-card card">
        <h3>Macro Distribution</h3>
        <div class="canvas-wrap" [class.hidden-chart]="!hasMacroData()">
          <canvas #macroChart></canvas>
        </div>
        @if (!hasMacroData() && !anSvc.loading()) {
          <p class="no-data">No macro data for this date.</p>
        }
      </div>

      <!-- Nutrition Quality Breakdown -->
      <div class="chart-card card">
        <h3>Nutrition Quality Breakdown</h3>
        @let nq = anSvc.nutritionQuality();
        @if (nq.hasScores && nq.dayScore !== null) {

          <!-- Day Quality Score bar -->
          <div class="nq-score-row">
            <span class="nq-label">Day Quality Score</span>
            <div class="nq-bar-wrap">
              <div class="nq-bar-fill"
                [style.width.%]="nq.dayScore * 10"
                [style.background]="nq.dayScore >= 7 ? '#34c759' : nq.dayScore >= 4 ? '#ff9500' : '#ff3b30'">
              </div>
            </div>
            <span class="nq-number"
              [style.color]="nq.dayScore >= 7 ? '#34c759' : nq.dayScore >= 4 ? '#ff9500' : '#ff3b30'">
              {{ nq.dayScore | number: '1.1-1' }} / 10
            </span>
          </div>

          <!-- Tier breakdown bar -->
          @if (nq.totalCals > 0) {
            <div class="nq-tier-wrap">
              <div class="nq-tier-label">Calories by Quality</div>
              <div class="nq-tier-bar">
                @if (nq.highCals > 0) {
                  <div class="nq-tier-seg" style="background:#34c759"
                    [style.width.%]="nq.highCals / nq.totalCals * 100"
                    [title]="'Quality: ' + (nq.highCals | number:'1.0-0') + ' kcal'">
                  </div>
                }
                @if (nq.midCals > 0) {
                  <div class="nq-tier-seg" style="background:#ff9500"
                    [style.width.%]="nq.midCals / nq.totalCals * 100"
                    [title]="'Moderate: ' + (nq.midCals | number:'1.0-0') + ' kcal'">
                  </div>
                }
                @if (nq.lowCals > 0) {
                  <div class="nq-tier-seg" style="background:#ff3b30"
                    [style.width.%]="nq.lowCals / nq.totalCals * 100"
                    [title]="'Low: ' + (nq.lowCals | number:'1.0-0') + ' kcal'">
                  </div>
                }
              </div>
              <div class="nq-tier-legend">
                @if (nq.highCals > 0) {
                  <div class="nq-tier-item">
                    <span class="nq-dot" style="background:#34c759"></span>
                    Quality (7–10): <b>{{ (nq.highCals / nq.totalCals * 100) | number:'1.0-0' }}%</b> ({{ nq.highCals | number:'1.0-0' }} kcal)
                  </div>
                }
                @if (nq.midCals > 0) {
                  <div class="nq-tier-item">
                    <span class="nq-dot" style="background:#ff9500"></span>
                    Moderate (4–6): <b>{{ (nq.midCals / nq.totalCals * 100) | number:'1.0-0' }}%</b> ({{ nq.midCals | number:'1.0-0' }} kcal)
                  </div>
                }
                @if (nq.lowCals > 0) {
                  <div class="nq-tier-item">
                    <span class="nq-dot" style="background:#ff3b30"></span>
                    Low (1–3): <b>{{ (nq.lowCals / nq.totalCals * 100) | number:'1.0-0' }}%</b> ({{ nq.lowCals | number:'1.0-0' }} kcal)
                  </div>
                }
              </div>
            </div>
          }

          <!-- Per-meal health score list -->
          @if (nq.scoredMeals.length > 0) {
            <div class="nqb-meal-list">
              <div class="nqb-meal-list-title">Health Score per Meal</div>
              @for (meal of nq.scoredMeals; track meal.food + meal.calories) {
                <div class="nqb-meal-row">
                  <div class="nqb-meal-name">{{ meal.food }}</div>
                  <div class="nqb-meal-bar-wrap">
                    <div class="nqb-meal-bar" [style.width.%]="meal.score * 10" [style.background]="meal.color"></div>
                  </div>
                  <div class="nqb-meal-score" [style.color]="meal.color">{{ meal.score }}/10</div>
                </div>
              }
            </div>
          }

        } @else {
          <p class="no-data">Add health scores to your meals to see the Nutrition Quality Breakdown.</p>
        }
      </div>


    </div>
  `,
  styles: [`
    .analytics-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .analytics-header { display: flex; align-items: center; gap: 12px; padding: 14px; flex-wrap: wrap; }
    .date-label { font-size: 14px; font-weight: 600; color: var(--text-muted); }
    .date-input { flex: 1; min-width: 140px; }
    .loading-text { font-size: 13px; color: var(--text-muted); }
    .chart-card { padding: 16px; }
    .chart-card h3 { margin: 0 0 14px; font-size: 16px; font-weight: 700; color: var(--text); }
    .chart-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .chart-header h3 { margin: 0; }
    .total-badge { font-size: 13px; background: var(--primary-light, rgba(0,122,255,0.15)); color: var(--primary); border-radius: 8px; padding: 3px 10px; font-weight: 600; }
    .canvas-wrap { height: 220px; position: relative; }
    .canvas-wrap canvas { width: 100% !important; height: 100% !important; }
    .canvas-wrap-scatter { height: 260px; position: relative; margin-top: 12px; }
    .canvas-wrap-scatter canvas { width: 100% !important; height: 100% !important; }
    .hidden-chart { display: none !important; }
    .no-data { color: var(--text-muted); text-align: center; padding: 16px; font-size: 14px; }

    /* NQB */
    .nq-score-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .nq-label { font-size: 13px; color: var(--text-muted); min-width: 120px; }
    .nq-bar-wrap { flex: 1; height: 14px; background: var(--border); border-radius: 7px; overflow: hidden; min-width: 80px; }
    .nq-bar-fill { height: 100%; border-radius: 7px; transition: width .4s; }
    .nq-number { font-weight: 700; font-size: 15px; min-width: 60px; text-align: right; }
    .nq-tier-label { font-size: 13px; color: var(--text-muted); margin-bottom: 8px; }
    .nq-tier-bar { display: flex; height: 18px; border-radius: 9px; overflow: hidden; }
    .nq-tier-seg { height: 100%; transition: width .3s; }
    .nq-tier-legend { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; font-size: 13px; }
    .nq-tier-item { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }
    .nq-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .nq-tier-wrap { margin-bottom: 16px; }

    /* Per-meal list */
    .nqb-meal-list { margin-top: 8px; }
    .nqb-meal-list-title { font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 10px; }
    .nqb-meal-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .nqb-meal-name { font-size: 13px; color: var(--text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nqb-meal-bar-wrap { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; min-width: 60px; }
    .nqb-meal-bar { height: 100%; border-radius: 4px; transition: width .3s; }
    .nqb-meal-score { font-size: 13px; font-weight: 700; min-width: 36px; text-align: right; }

    .canvas-wrap-scatter { height: 260px; position: relative; margin-top: 12px; }
    .canvas-wrap-scatter canvas { width: 100% !important; height: 100% !important; }
    .btn-sm { font-size: 13px; padding: 7px 12px; }
  `],
})
export class AnalyticsComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly anSvc = inject(AnalyticsService);
  readonly state = inject(StateService);
  private readonly log = inject(LoggingService);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('mealChart') mealChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('macroChart') macroChartRef!: ElementRef<HTMLCanvasElement>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private charts: Record<string, any> = {};

  hasMealData(): boolean { return Object.keys(this.anSvc.mealData()).length > 0; }
  hasMacroData(): boolean {
    const m = this.anSvc.macroData();
    return m.protein > 0 || m.carbs > 0 || m.fat > 0;
  }
  mealTotal(): number {
    return this.anSvc.entriesForDate().reduce(
      (s, e) => s + (parseFloat(String((e as Record<string, unknown>)['calories'] ?? '0')) || 0), 0
    );
  }

  ngOnInit(): void {
    const date = this.state.analyticsDate() || getTodayString();
    this.anSvc.loadDateIfNeeded(date).then(() => {
      this.cdr.detectChanges();
      setTimeout(() => this.rebuildCharts(), 0);
    });
  }

  ngAfterViewInit(): void {
    // Rebuild if data was already available synchronously
    setTimeout(() => this.rebuildCharts(), 50);
  }

  ngOnDestroy(): void { this.destroyCharts(); }

  onDateChange(dateStr: string): void {
    this.state.analyticsDate.set(dateStr);
    this.destroyCharts();
    this.anSvc.loadDateIfNeeded(dateStr).then(() => {
      this.cdr.detectChanges();
      setTimeout(() => this.rebuildCharts(), 0);
    });
  }

  private destroyCharts(): void {
    for (const c of Object.values(this.charts)) { try { c?.destroy(); } catch { /* ignore */ } }
    this.charts = {};
  }

  private async rebuildCharts(): Promise<void> {
    this.destroyCharts();
    if (this.hasMealData()) await this.buildMealChart();
    if (this.hasMacroData()) await this.buildMacroChart();
  }

  private getChartTextColor(): string {
    // Read CSS var at call time so dark/light mode switch is reflected correctly
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    return raw || (document.documentElement.classList.contains('dark') ? '#f2f2f7' : '#1c1c1e');
  }

  private async buildMealChart(): Promise<void> {
    if (!this.mealChartRef?.nativeElement) return;
    try {
      const { Chart, registerables } = await import('chart.js');
      Chart.register(...registerables);
      const existing = this.charts['meal'];
      if (existing) { try { existing.destroy(); } catch { /* ignore */ } }
      const mealData = this.anSvc.mealData();
      const ctx = this.mealChartRef.nativeElement.getContext('2d');
      if (!ctx) return;
      const textColor = this.getChartTextColor();
      const labels = Object.keys(mealData);
      const data = Object.values(mealData);
      const total = data.reduce((s, v) => s + v, 0) || 1;
      this.charts['meal'] = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: DONUT_COLORS }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '65%',
          animation: { animateRotate: true, duration: 500 },
          plugins: {
            legend: {
              position: 'right',
              labels: {
                color: textColor, boxWidth: 12, padding: 14, font: { size: 12 },
                generateLabels: (chart) => {
                  const ds = chart.data.datasets[0];
                  return (chart.data.labels as string[]).map((lab, i) => {
                    const val = (ds.data[i] as number) || 0;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return { text: `${lab}: ${Math.round(val)} kcal (${Math.round(val / total * 100)}%)`, fillStyle: (ds.backgroundColor as any)[i], strokeStyle: 'transparent', color: textColor, hidden: false, index: i };
                  });
                },
              },
            },
            tooltip: { callbacks: { label: ctx => `${ctx.label}: ${Math.round(ctx.parsed)} kcal` } },
          },
        },
      });
    } catch (err) { this.log.dbg('Meal chart error: ' + String(err), 'error'); }
  }

  private async buildMacroChart(): Promise<void> {
    if (!this.macroChartRef?.nativeElement) return;
    try {
      const { Chart, registerables } = await import('chart.js');
      Chart.register(...registerables);
      const existing = this.charts['macro'];
      if (existing) { try { existing.destroy(); } catch { /* ignore */ } }
      const { protein, carbs, fat } = this.anSvc.macroData();
      const data = [protein, carbs, fat];
      const total = data.reduce((s, v) => s + v, 0) || 1;
      const ctx = this.macroChartRef.nativeElement.getContext('2d');
      if (!ctx) return;
      const textColor = this.getChartTextColor();
      this.charts['macro'] = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Protein', 'Carbs', 'Fat'], datasets: [{ data, backgroundColor: DONUT_COLORS }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '65%',
          animation: { animateRotate: true, duration: 500 },
          plugins: {
            legend: {
              position: 'right',
              labels: {
                color: textColor, boxWidth: 12, padding: 14, font: { size: 12 },
                generateLabels: (chart) => {
                  const ds = chart.data.datasets[0];
                  return (chart.data.labels as string[]).map((lab, i) => {
                    const val = (ds.data[i] as number) || 0;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return { text: `${lab}: ${Math.round(val)}g (${Math.round(val / total * 100)}%)`, fillStyle: (ds.backgroundColor as any)[i], strokeStyle: 'transparent', color: textColor, hidden: false, index: i };
                  });
                },
              },
            },
            tooltip: { callbacks: { label: ctx => { const val = ctx.parsed || 0; return `${ctx.label}: ${Math.round(val)}g (${Math.round(val / total * 100)}%)`; } } },
          },
        },
      });
    } catch (err) { this.log.dbg('Macro chart error: ' + String(err), 'error'); }
  }
}

