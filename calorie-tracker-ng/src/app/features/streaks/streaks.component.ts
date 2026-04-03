import { Component, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StreaksService } from './streaks.service';
import { StateService } from '../../core/services/state.service';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

@Component({
  selector: 'app-streaks',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="streaks-page">
      <!-- Hero numbers -->
      <div class="streak-heroes">
        <div class="hero-card card">
          <div class="hero-flame">🔥</div>
          <div class="hero-value">{{ state.streak().currentStreak }}</div>
          <div class="hero-label">{{ state.streak().currentStreak === 1 ? 'day streak' : 'days streak' }}</div>
        </div>
        <div class="hero-card card">
          <div class="hero-flame">🏆</div>
          <div class="hero-value">{{ state.streak().longestStreak }}</div>
          <div class="hero-label">longest streak</div>
        </div>
      </div>

      <!-- Compute button -->
      <div class="compute-row">
        <button class="btn-primary" [class.loading]="streakSvc.computing()" (click)="streakSvc.computeCurrentStreak()">
          Compute Current Streak
        </button>
        @if (streakSvc.computeProgress(); as prog) {
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" [style.width.%]="prog.total > 0 ? (prog.done / prog.total * 100) : 0"></div>
          </div>
          <span class="progress-text">{{ prog.done }}/{{ prog.total }} {{ prog.current }}</span>
        }
      </div>

      <!-- Calendar navigation -->
      <div class="calendar-nav card">
        <button class="btn-secondary btn-circle" (click)="changeMonth(-1)">←</button>
        <span class="month-label">{{ monthLabel() }}</span>
        <button class="btn-secondary btn-circle" [disabled]="streakSvc.offsetMonths() >= 0" (click)="changeMonth(1)">→</button>
      </div>

      <!-- Calendar grid -->
      @if (streakSvc.currentMonthData(); as monthData) {
        <div class="calendar card">
          <!-- Weekday headers -->
          <div class="cal-grid">
            @for (wd of weekDays; track wd) {
              <div class="cal-header">{{ wd }}</div>
            }
            @for (cell of calendarCells(); track cell.dateStr ?? ('empty-' + $index)) {
              <div class="cal-cell" [class.active]="cell.active" [class.empty]="cell.day === null">
                @if (cell.day !== null) {
                  <span class="cal-day">{{ cell.day }}</span>
                  @if (cell.active) {
                    <span class="cal-flame">🔥</span>
                  }
                }
              </div>
            }
          </div>
          @if (monthData.loading) {
            <div class="calendar-loading">⏳ Loading calendar data…</div>
          }
        </div>
      }

      <!-- Streak details -->
      @if (state.streak().computedAt) {
        <div class="streak-meta card">
          <div class="meta-row">
            <span class="meta-label">Last Active</span>
            <span class="meta-val">{{ state.streak().lastActiveDate || '—' }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Computed</span>
            <span class="meta-val">{{ state.streak().computedAt | date: 'medium' }}</span>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .streaks-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .streak-heroes { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .hero-card { padding: 20px; text-align: center; }
    .hero-flame { font-size: 32px; margin-bottom: 8px; }
    .hero-value { font-size: 48px; font-weight: 800; color: var(--primary); line-height: 1; }
    .hero-label { font-size: 14px; color: var(--text-muted); margin-top: 6px; }
    .compute-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .progress-bar-wrap { flex: 1; min-width: 100px; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
    .progress-bar-fill { height: 100%; background: var(--primary); transition: width .3s; border-radius: 4px; }
    .progress-text { font-size: 12px; color: var(--text-muted); }
    .calendar-nav { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; }
    .month-label { font-size: 16px; font-weight: 700; }
    .btn-circle { border-radius: 50%; width: 36px; height: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; }
    .calendar { padding: 16px; }
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .cal-header { text-align: center; font-size: 11px; font-weight: 700; color: var(--text-muted); padding: 4px 0; }
    .cal-cell { aspect-ratio: 1; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1.5px solid var(--border); background: var(--bg); }
    .cal-cell.active { background: rgba(255, 149, 0, .15); border-color: #ff9500; }
    .cal-cell.empty { border-color: transparent; background: transparent; }
    .cal-day { font-size: 12px; font-weight: 500; color: var(--text-muted); }
    .cal-flame { font-size: 14px; }
    .calendar-loading { text-align: center; font-size: 13px; color: var(--text-muted); padding: 12px; }
    .streak-meta { padding: 14px; }
    .meta-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); }
    .meta-row:last-child { border-bottom: none; }
    .meta-label { font-size: 13px; color: var(--text-muted); }
    .meta-val { font-size: 14px; font-weight: 600; }
  `],
})
export class StreaksComponent implements OnInit {
  readonly streakSvc = inject(StreaksService);
  readonly state = inject(StateService);

  readonly weekDays = WEEK_DAYS;

  ngOnInit(): void {
    this.streakSvc.showMonth(0);
  }

  changeMonth(delta: number): void {
    const newOffset = this.streakSvc.offsetMonths() + delta;
    if (newOffset > 0) return; // Don't go into the future
    this.streakSvc.showMonth(newOffset);
  }

  readonly monthLabel = computed(() => {
    const offset = this.streakSvc.offsetMonths();
    const { year, monthIndex } = this.streakSvc.getYearMonthFromOffset(offset);
    return this.streakSvc.formatMonthLabel(year, monthIndex);
  });

  readonly calendarCells = computed(() => {
    const monthData = this.streakSvc.currentMonthData();
    if (!monthData) return [];
    return this.streakSvc.buildCalendarCells(monthData.year, monthData.monthIndex, monthData.activeDates);
  });
}
