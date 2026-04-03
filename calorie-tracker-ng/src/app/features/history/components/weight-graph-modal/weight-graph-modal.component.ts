import {
  Component, Input, Output, EventEmitter, inject, OnInit, OnDestroy, ElementRef, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfigService } from '../../../../core/services/config.service';
import { LoggingService } from '../../../../core/services/logging.service';

interface WeightPoint { date: string; weight: number; }

@Component({
  selector: 'app-weight-graph-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal-card" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h3>Weight Over Time</h3>
          <button class="modal-close" (click)="close.emit()">✕</button>
        </div>
        <div class="modal-body">
          @if (stats) {
            <div class="weight-stats">
              <div class="stat">
                <span class="stat-label">Start</span>
                <span class="stat-val">{{ stats.start | number: '1.1-1' }} kg</span>
              </div>
              <div class="stat">
                <span class="stat-label">End</span>
                <span class="stat-val">{{ stats.end | number: '1.1-1' }} kg</span>
              </div>
              <div class="stat">
                <span class="stat-label">Change</span>
                <span class="stat-val" [class.pos]="stats.delta > 0" [class.neg]="stats.delta < 0">
                  {{ stats.delta > 0 ? '+' : '' }}{{ stats.delta | number: '1.1-1' }} kg
                </span>
              </div>
              <div class="stat">
                <span class="stat-label">Avg</span>
                <span class="stat-val">{{ stats.avg | number: '1.1-1' }} kg</span>
              </div>
            </div>
          }
          <div class="chart-wrap">
            <canvas #chartCanvas></canvas>
          </div>
          @if (data.length === 0) {
            <p class="no-data">No weight data in the selected range.</p>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 9000; display: flex; align-items: center; justify-content: center; }
    .modal-card { background: var(--card-bg); border-radius: 18px; padding: 20px; max-width: 520px; width: 95vw; max-height: 90vh; overflow: auto; box-shadow: 0 8px 40px rgba(0,0,0,.18); }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .modal-header h3 { margin: 0; font-size: 17px; }
    .modal-close { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-muted); }
    .modal-body { display: flex; flex-direction: column; gap: 16px; }
    .weight-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .stat { background: var(--bg); border-radius: 10px; padding: 10px; text-align: center; }
    .stat-label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
    .stat-val { font-size: 16px; font-weight: 700; color: var(--text); }
    .stat-val.pos { color: #f87171; }
    .stat-val.neg { color: #34d399; }
    .chart-wrap { height: 220px; }
    .no-data { text-align: center; color: var(--text-muted); padding: 16px; }
  `],
})
export class WeightGraphModalComponent implements OnInit, OnDestroy {
  @Input({ required: true }) data: WeightPoint[] = [];
  @Output() close = new EventEmitter<void>();
  @ViewChild('chartCanvas', { static: true }) chartCanvas!: ElementRef<HTMLCanvasElement>;

  private readonly log = inject(LoggingService);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private chart: any = null;

  stats: { start: number; end: number; delta: number; avg: number } | null = null;

  ngOnInit(): void {
    if (this.data.length > 0) {
      const weights = this.data.map(d => d.weight);
      const start = weights[0];
      const end = weights[weights.length - 1];
      const avg = Math.round((weights.reduce((s, w) => s + w, 0) / weights.length) * 10) / 10;
      this.stats = { start, end, delta: Math.round((end - start) * 10) / 10, avg };
    }
    this.initChart();
  }

  ngOnDestroy(): void {
    if (this.chart) { this.chart.destroy(); this.chart = null; }
  }

  private async initChart(): Promise<void> {
    if (this.data.length === 0) return;
    try {
      const { Chart, registerables } = await import('chart.js');
      Chart.register(...registerables);
      const ctx = this.chartCanvas.nativeElement.getContext('2d');
      if (!ctx) return;
      if (this.chart) this.chart.destroy();
      this.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: this.data.map(d => d.date),
          datasets: [{
            label: 'Weight (kg)',
            data: this.data.map(d => d.weight),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,.1)',
            fill: true,
            tension: 0.3,
            pointRadius: this.data.length < 30 ? 4 : 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { maxTicksLimit: 8, maxRotation: 30 } },
            y: { beginAtZero: false },
          },
        },
      });
    } catch (err) {
      this.log.dbg('Weight chart init error: ' + String(err), 'error');
    }
  }
}
