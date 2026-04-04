import { Component, inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { StateService } from '../../core/services/state.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { getEntryDate, getTodayString } from '../../shared/utils/date.utils';

@Component({
  selector: 'app-report-generator',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <div class="report-page">
      <div class="sub-nav">
        <button class="hub-back-btn" (click)="goHub()">← Hub</button>
        <h2 class="page-title">Report Generator</h2>
      </div>
      <p class="page-subtitle">Export all tracked data as a structured JSON report</p>

      <div class="card summary-card">
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-val">{{ totalEntries }}</span>
            <span class="summary-lbl">Entries</span>
          </div>
          <div class="summary-item">
            <span class="summary-val">{{ activeDays }}</span>
            <span class="summary-lbl">Active days</span>
          </div>
          <div class="summary-item">
            <span class="summary-val">{{ dateRange }}</span>
            <span class="summary-lbl">Date range</span>
          </div>
        </div>
      </div>

      <div class="card actions-card">
        <p class="actions-desc">
          The report includes all entries, daily summaries with macro totals, body weight log, and streak data.
        </p>
        <div class="actions-row">
          <button class="btn-primary" (click)="downloadReport()">
            📄 Download JSON
          </button>
          <button class="btn-secondary" (click)="copyReport()">
            📋 Copy to Clipboard
          </button>
        </div>
        @if (copied) {
          <p class="copied-msg">✅ Copied to clipboard!</p>
        }
      </div>

      <!-- Preview snippet -->
      @if (previewJson) {
        <div class="card preview-card">
          <div class="preview-header">
            <span class="preview-label">Preview (first 20 lines)</span>
            <button class="btn-secondary btn-sm" (click)="previewJson = null">✕</button>
          </div>
          <pre class="preview-code">{{ previewJson }}</pre>
        </div>
      }

      <button class="btn-ghost" (click)="showPreview()">👁 Preview Report</button>
    </div>
  `,
  styles: [`
    .report-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .page-title { font-size: 24px; font-weight: 700; color: var(--text); margin: 0 0 2px; }
    .page-subtitle { font-size: 14px; color: var(--text-muted); margin: 0 0 4px; }
    .summary-card { padding: 16px; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .summary-item { text-align: center; }
    .summary-val { display: block; font-size: 22px; font-weight: 700; color: var(--primary); }
    .summary-lbl { display: block; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .actions-card { padding: 16px; }
    .actions-desc { font-size: 14px; color: var(--text-muted); margin: 0 0 16px; line-height: 1.5; }
    .actions-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .actions-row button { flex: 1; padding: 14px; font-size: 15px; }
    .copied-msg { font-size: 13px; color: #34c759; margin-top: 12px; font-weight: 600; }
    .preview-card { padding: 16px; }
    .preview-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .preview-label { font-size: 13px; font-weight: 600; color: var(--text-muted); }
    .preview-code { font-family: monospace; font-size: 11px; color: var(--text); background: var(--surface-2); border-radius: 8px; padding: 12px; overflow: auto; max-height: 300px; white-space: pre; margin: 0; }
    .btn-ghost { background: none; border: 1px solid var(--border); border-radius: 12px; padding: 12px; font-size: 14px; color: var(--text-muted); cursor: pointer; align-self: flex-start; }
    .btn-sm { font-size: 12px; padding: 6px 10px; }
  `],
})
export class ReportGeneratorComponent {
  private readonly state = inject(StateService);
  private readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly router = inject(Router);

  goHub(): void { this.router.navigate(['/calorie-hub']); }

  copied = false;
  previewJson: string | null = null;

  get totalEntries(): number {
    return this.state.entries().filter(e => (e as Record<string, unknown>)['_meta'] !== 'dailyWeight').length;
  }

  get activeDays(): number {
    const entries = this.state.entries().filter(e => (e as Record<string, unknown>)['_meta'] !== 'dailyWeight');
    return new Set(entries.map(e => getEntryDate(e as Record<string, unknown>)).filter(Boolean)).size;
  }

  get dateRange(): string {
    const entries = this.state.entries().filter(e => (e as Record<string, unknown>)['_meta'] !== 'dailyWeight');
    const dates = entries.map(e => getEntryDate(e as Record<string, unknown>)).filter(Boolean) as string[];
    if (!dates.length) return 'No data';
    dates.sort();
    const first = dates[0], last = dates[dates.length - 1];
    return first === last ? first : `${first} – ${last}`;
  }

  downloadReport(): void {
    try {
      const json = this._buildReport();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `calorie-tracker-report-${getTodayString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.notify.showNotification('Report downloaded', 'success');
    } catch (err) {
      this.log.dbg('Report download error: ' + String(err), 'error');
      this.notify.showNotification('Failed to generate report', 'error');
    }
  }

  async copyReport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this._buildReport());
      this.copied = true;
      this.cdr.detectChanges();
      setTimeout(() => { this.copied = false; this.cdr.detectChanges(); }, 2500);
    } catch {
      this.notify.showNotification('Failed to copy — try download instead', 'error');
    }
  }

  showPreview(): void {
    const lines = this._buildReport().split('\n');
    this.previewJson = lines.slice(0, 20).join('\n') + (lines.length > 20 ? '\n  ...' : '');
  }

  private _buildReport(): string {
    const entries = this.state.entries();
    const streak = this.state.streak();
    const round1 = (v: number) => Math.round((v || 0) * 10) / 10;
    const food = entries.filter(e => (e as Record<string, unknown>)['_meta'] !== 'dailyWeight');
    const dates = new Set(food.map(e => getEntryDate(e as Record<string, unknown>)).filter(Boolean));
    const activeDays = dates.size;
    let totCal = 0, totProt = 0, totCarbs = 0, totFat = 0, hsSum = 0, hsCount = 0;
    for (const e of food) {
      const en = e as Record<string, unknown>;
      totCal   += parseFloat(String(en['calories'] ?? '0')) || 0;
      totProt  += parseFloat(String(en['protein']  ?? '0')) || 0;
      totCarbs += parseFloat(String(en['carbs']    ?? '0')) || 0;
      totFat   += parseFloat(String(en['fat']      ?? '0')) || 0;
      if (en['healthScore'] != null) { hsSum += parseFloat(String(en['healthScore'])); hsCount++; }
    }
    const avg = (total: number) => activeDays > 0 ? round1(total / activeDays) : 0;
    const byDate: Record<string, { date: string; totalCalories: number; totalProtein: number; totalCarbs: number; totalFat: number; entryCount: number; _hsSum: number; _hsCount: number; bodyWeightKg: number | null }> = {};
    for (const e of entries) {
      const en = e as Record<string, unknown>;
      const d = getEntryDate(en);
      if (!d) continue;
      if (!byDate[d]) byDate[d] = { date: d, totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, entryCount: 0, _hsSum: 0, _hsCount: 0, bodyWeightKg: null };
      if (String(en['_meta']) === 'dailyWeight') {
        byDate[d].bodyWeightKg = parseFloat(String(en['weightKg'] ?? en['weight'] ?? '')) || null;
      } else {
        byDate[d].totalCalories += parseFloat(String(en['calories'] ?? '0')) || 0;
        byDate[d].totalProtein  += parseFloat(String(en['protein']  ?? '0')) || 0;
        byDate[d].totalCarbs    += parseFloat(String(en['carbs']    ?? '0')) || 0;
        byDate[d].totalFat      += parseFloat(String(en['fat']      ?? '0')) || 0;
        byDate[d].entryCount++;
        if (en['healthScore'] != null) { byDate[d]._hsSum += parseFloat(String(en['healthScore'])); byDate[d]._hsCount++; }
      }
    }
    const report = {
      metadata: { exportedAt: new Date().toISOString(), appVersion: '3.0.0-ng', totalEntries: food.length, dateRange: { start: [...dates].sort()[0] ?? null, end: [...dates].sort().at(-1) ?? null } },
      summary: { activeDays, totalCalories: Math.round(totCal), avgCaloriesPerDay: avg(totCal), totalProtein: round1(totProt), avgProteinPerDay: avg(totProt), totalCarbs: round1(totCarbs), avgCarbsPerDay: avg(totCarbs), totalFat: round1(totFat), avgFatPerDay: avg(totFat), avgHealthScore: hsCount > 0 ? round1(hsSum / hsCount) : null, streaks: streak ? { currentStreak: streak.currentStreak ?? 0, longestStreak: streak.longestStreak ?? 0 } : null },
      dailySummaries: Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ date: d.date, totalCalories: Math.round(d.totalCalories), totalProtein: round1(d.totalProtein), totalCarbs: round1(d.totalCarbs), totalFat: round1(d.totalFat), entryCount: d.entryCount, avgHealthScore: d._hsCount > 0 ? round1(d._hsSum / d._hsCount) : null, bodyWeightKg: d.bodyWeightKg })),
      entries: food.map(e => { const en = e as Record<string, unknown>; return { date: getEntryDate(en), timestamp: en['timestamp'] ?? null, time: en['time'] ?? null, food: en['food'] ?? '', calories: parseFloat(String(en['calories'] ?? '0')) || 0, protein: en['protein'] != null ? round1(parseFloat(String(en['protein']))) : null, carbs: en['carbs'] != null ? round1(parseFloat(String(en['carbs']))) : null, fat: en['fat'] != null ? round1(parseFloat(String(en['fat']))) : null, healthScore: en['healthScore'] != null ? parseFloat(String(en['healthScore'])) : null }; }),
      bodyWeightLog: entries.filter(e => (e as Record<string, unknown>)['_meta'] === 'dailyWeight').map(e => { const en = e as Record<string, unknown>; return { date: getEntryDate(en), weightKg: parseFloat(String(en['weightKg'] ?? en['weight'] ?? '')) || null, timestamp: en['timestamp'] ?? null }; }),
    };
    return JSON.stringify(report, null, 2);
  }
}
