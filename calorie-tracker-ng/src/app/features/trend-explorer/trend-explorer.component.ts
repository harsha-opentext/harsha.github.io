import {
  Component, inject, OnDestroy, AfterViewInit,
  ElementRef, ViewChild, ChangeDetectorRef, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/services/state.service';
import { LoggingService } from '../../core/services/logging.service';
import { getEntryDate, getTodayString } from '../../shared/utils/date.utils';

interface DailyPoint { date: string; calories: number; protein: number; carbs: number; fat: number; bodyWeight: number | null; }

@Component({
  selector: 'app-trend-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <div class="trend-page">
      <h2 class="page-title">Trend Explorer</h2>
      <p class="page-subtitle">Correlate variables across days</p>

      <div class="card controls-card">
        <div class="axis-row">
          <div class="axis-group">
            <label class="axis-label">X Axis</label>
            <select class="form-input" [(ngModel)]="trendXVar">
              @for (v of trendVars; track v.key) {
                <option [value]="v.key">{{ v.label }}</option>
              }
            </select>
          </div>
          <div class="axis-group">
            <label class="axis-label">Y Axis</label>
            <select class="form-input" [(ngModel)]="trendYVar">
              @for (v of trendVars; track v.key) {
                <option [value]="v.key">{{ v.label }}</option>
              }
            </select>
          </div>
        </div>

        <div class="period-row">
          <select class="form-input" [(ngModel)]="trendPeriod">
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="0">All time</option>
            <option value="custom">Custom range</option>
          </select>
          <button class="btn-primary btn-sm" [class.loading]="trendLoading" (click)="plotTrend()">Plot</button>
        </div>

        @if (trendPeriod === 'custom') {
          <div class="custom-range">
            <input type="date" class="form-input" [(ngModel)]="trendStartDate" placeholder="Start" />
            <input type="date" class="form-input" [(ngModel)]="trendEndDate" placeholder="End" />
          </div>
        }

        <div class="templates">
          <button class="tag-btn" (click)="setTemplate('calories','bodyWeight')">Calories↔Weight</button>
          <button class="tag-btn" (click)="setTemplate('protein','bodyWeight')">Protein↔Weight</button>
          <button class="tag-btn" (click)="setTemplate('calories','protein')">Calories↔Protein</button>
          <button class="tag-btn" (click)="setTemplate('carbs','fat')">Carbs↔Fat</button>
        </div>
      </div>

      <!-- Chart -->
      <div class="card chart-card">
        <div class="canvas-wrap" [class.hidden-chart]="!trendHasData">
          <canvas #trendChart></canvas>
        </div>
        @if (!trendHasData && !trendLoading) {
          <p class="no-data">{{ trendEmptyMsg }}</p>
        }
      </div>

      <!-- Stats -->
      @if (trendStats) {
        <div class="stats-grid card">
          @for (s of trendStats; track s.lbl) {
            <div class="stat-card">
              <div class="stat-val">{{ s.val }}</div>
              <div class="stat-lbl">{{ s.lbl }}</div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .trend-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .page-title { font-size: 24px; font-weight: 700; color: var(--text); margin: 0 0 2px; }
    .page-subtitle { font-size: 14px; color: var(--text-muted); margin: 0 0 4px; }
    .controls-card { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .axis-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .axis-group { display: flex; flex-direction: column; gap: 4px; }
    .axis-label { font-size: 12px; color: var(--text-muted); font-weight: 500; }
    .period-row { display: flex; gap: 8px; align-items: center; }
    .period-row select { flex: 1; }
    .custom-range { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .templates { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag-btn { padding: 6px 12px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 20px; font-size: 13px; cursor: pointer; transition: all .15s; }
    .tag-btn:hover { background: var(--primary); color: #fff; border-color: var(--primary); }
    .chart-card { padding: 16px; }
    .canvas-wrap { height: 280px; position: relative; }
    .canvas-wrap canvas { width: 100% !important; height: 100% !important; }
    .hidden-chart { display: none !important; }
    .no-data { color: var(--text-muted); text-align: center; padding: 32px 16px; font-size: 14px; }
    .stats-grid { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px; }
    .stat-card { background: var(--surface-2); border-radius: 10px; padding: 10px 14px; min-width: 90px; flex: 1; }
    .stat-val { font-size: 16px; font-weight: 700; color: var(--text); }
    .stat-lbl { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .form-input { padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 15px; width: 100%; box-sizing: border-box; }
    .btn-sm { font-size: 13px; padding: 10px 16px; white-space: nowrap; }
  `],
})
export class TrendExplorerComponent implements AfterViewInit, OnDestroy {
  readonly state = inject(StateService);
  private readonly log = inject(LoggingService);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('trendChart') trendChartRef!: ElementRef<HTMLCanvasElement>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private chart: any = null;

  trendVars = [
    { key: 'calories',   label: 'Total Calories (kcal)' },
    { key: 'protein',    label: 'Protein (g)' },
    { key: 'carbs',      label: 'Carbs (g)' },
    { key: 'fat',        label: 'Fat (g)' },
    { key: 'bodyWeight', label: 'Body Weight (kg)' },
  ];
  trendXVar = 'calories';
  trendYVar = 'bodyWeight';
  trendPeriod = '30';
  trendStartDate = '';
  trendEndDate = '';
  trendHasData = false;
  trendLoading = false;
  trendEmptyMsg = 'Select axes and click "Plot" to explore correlations.';
  trendStats: Array<{ val: string | number; lbl: string }> | null = null;

  ngAfterViewInit(): void { /* chart built on demand */ }

  ngOnDestroy(): void { try { this.chart?.destroy(); } catch { /* ignore */ } }

  setTemplate(x: string, y: string): void { this.trendXVar = x; this.trendYVar = y; this.plotTrend(); }

  async plotTrend(): Promise<void> {
    this.trendLoading = true;
    this.trendHasData = false;
    this.trendStats = null;
    await new Promise(r => setTimeout(r, 0));
    try {
      const allEntries = this.state.entries();
      if (!allEntries.length) { this.trendEmptyMsg = 'No data yet. Add entries and fetch from GitHub first.'; return; }

      const byDate: Record<string, DailyPoint> = {};
      for (const e of allEntries) {
        const entry = e as Record<string, unknown>;
        const d = getEntryDate(entry);
        if (!d) continue;
        if (!byDate[d]) byDate[d] = { date: d, calories: 0, protein: 0, carbs: 0, fat: 0, bodyWeight: null };
        if (String(entry['_meta']) === 'dailyWeight') {
          byDate[d].bodyWeight = parseFloat(String(entry['weightKg'] ?? entry['weight'] ?? '')) || null;
        } else {
          byDate[d].calories += parseFloat(String(entry['calories'] ?? '0')) || 0;
          byDate[d].protein  += parseFloat(String(entry['protein']  ?? '0')) || 0;
          byDate[d].carbs    += parseFloat(String(entry['carbs']    ?? '0')) || 0;
          byDate[d].fat      += parseFloat(String(entry['fat']      ?? '0')) || 0;
        }
      }

      const { startDate, endDate } = this._dateRange();
      const dates = Object.keys(byDate).sort().filter(d => {
        if (startDate && d < startDate) return false;
        if (endDate   && d > endDate)   return false;
        return true;
      });

      const xKey = this.trendXVar as keyof DailyPoint;
      const yKey = this.trendYVar as keyof DailyPoint;
      const pts: Array<{ x: number; y: number; date: string }> = [];
      for (const d of dates) {
        const day = byDate[d];
        const x = day[xKey] as number | null;
        const y = day[yKey] as number | null;
        if (x == null || y == null || isNaN(x as number) || isNaN(y as number)) continue;
        pts.push({ x: parseFloat((x as number).toFixed(2)), y: parseFloat((y as number).toFixed(2)), date: d });
      }

      if (!pts.length) { this.trendEmptyMsg = 'No data for the selected variables. Try "All time" or different axes.'; return; }

      this.trendHasData = true;
      this.cdr.detectChanges();
      await this._drawChart(pts, xKey as string, yKey as string);
      this._computeStats(pts, xKey as string, yKey as string);
    } catch (err) {
      this.log.dbg('Trend plot error: ' + String(err), 'error');
    } finally {
      this.trendLoading = false;
    }
  }

  private _dateRange(): { startDate: string | null; endDate: string | null } {
    if (this.trendPeriod === 'custom') return { startDate: this.trendStartDate || null, endDate: this.trendEndDate || null };
    const days = parseInt(this.trendPeriod, 10);
    const end = getTodayString();
    if (!days) return { startDate: null, endDate: end };
    const start = new Date();
    start.setDate(start.getDate() - days + 1);
    const sy = start.getFullYear(), sm = String(start.getMonth() + 1).padStart(2, '0'), sd = String(start.getDate()).padStart(2, '0');
    return { startDate: `${sy}-${sm}-${sd}`, endDate: end };
  }

  private getTextColor(): string {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    return raw || (document.documentElement.classList.contains('dark') ? '#f2f2f7' : '#1c1c1e');
  }

  private async _drawChart(pts: Array<{ x: number; y: number; date: string }>, xKey: string, yKey: string): Promise<void> {
    if (!this.trendChartRef?.nativeElement) return;
    try {
      const { Chart, registerables } = await import('chart.js');
      Chart.register(...registerables);
      try { this.chart?.destroy(); } catch { /* ignore */ }
      const ctx = this.trendChartRef.nativeElement.getContext('2d');
      if (!ctx) return;
      const textColor = this.getTextColor();
      const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#d1d1d6';
      const xLabel = this.trendVars.find(v => v.key === xKey)?.label ?? xKey;
      const yLabel = this.trendVars.find(v => v.key === yKey)?.label ?? yKey;
      const tl = this._trendLine(pts);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const datasets: any[] = [{ label: 'Daily values', data: pts, backgroundColor: 'rgba(0,122,255,0.65)', pointRadius: 6, pointHoverRadius: 9 }];
      if (tl) datasets.push({ label: 'Trend line', data: tl, type: 'line', borderColor: '#ff3b30', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0 });
      this.chart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: textColor } },
            tooltip: { callbacks: { label: (c: { raw: unknown }) => { const r = c.raw as { date?: string; x: number; y: number }; return r.date ? `${r.date}: (${r.x}, ${r.y})` : `(${r.x}, ${r.y})`; } } },
          },
          scales: {
            x: { title: { display: true, text: xLabel, color: textColor }, ticks: { color: textColor }, grid: { color: gridColor } },
            y: { title: { display: true, text: yLabel, color: textColor }, ticks: { color: textColor }, grid: { color: gridColor } },
          },
        },
      });
    } catch (err) { this.log.dbg('Trend chart error: ' + String(err), 'error'); }
  }

  private _trendLine(pts: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> | null {
    const n = pts.length; if (n < 2) return null;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
    let num = 0, denom = 0;
    for (const p of pts) { const dx = p.x - mx; num += dx * (p.y - my); denom += dx * dx; }
    if (denom === 0) return null;
    const m = num / denom, b = my - m * mx;
    const xs = pts.map(p => p.x), minX = Math.min(...xs), maxX = Math.max(...xs);
    return [{ x: minX, y: parseFloat((m * minX + b).toFixed(2)) }, { x: maxX, y: parseFloat((m * maxX + b).toFixed(2)) }];
  }

  private _pearsonR(pts: Array<{ x: number; y: number }>): number | null {
    const n = pts.length; if (n < 2) return null;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (const p of pts) { const dx = p.x - mx, dy = p.y - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
    const d = Math.sqrt(dx2 * dy2);
    return d === 0 ? null : num / d;
  }

  private _computeStats(pts: Array<{ x: number; y: number }>, xKey: string, yKey: string): void {
    const r = this._pearsonR(pts);
    const rStr = r !== null ? r.toFixed(3) : 'N/A';
    const rInterp = r !== null ? (Math.abs(r) >= 0.7 ? (r > 0 ? 'Strong +' : 'Strong −') : Math.abs(r) >= 0.4 ? (r > 0 ? 'Moderate +' : 'Moderate −') : 'Weak / None') : '';
    const fmt = (v: number) => v.toFixed(1);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const xShort = this.trendVars.find(v => v.key === xKey)?.label.split(' ')[0] ?? xKey;
    const yShort = this.trendVars.find(v => v.key === yKey)?.label.split(' ')[0] ?? yKey;
    this.trendStats = [
      { val: pts.length, lbl: 'Data Points' }, { val: rStr, lbl: 'Pearson r' }, { val: rInterp, lbl: 'Correlation' },
      { val: fmt(Math.min(...xs)), lbl: `Min ${xShort}` }, { val: fmt(Math.max(...xs)), lbl: `Max ${xShort}` },
      { val: fmt(Math.min(...ys)), lbl: `Min ${yShort}` }, { val: fmt(Math.max(...ys)), lbl: `Max ${yShort}` },
    ];
  }
}
