import { Component, inject, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { WorkoutStreaksService } from './workout-streaks.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

@Component({
  selector: 'app-workout-streaks',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="streaks-page">
      <div class="sub-nav">
        <button class="hub-back-btn" (click)="goHub()">← Hub</button>
        <h2 class="page-title">Streaks</h2>
      </div>
      <!-- Hero streak numbers -->
      <div class="streak-heroes">
        <div class="hero-card card">
          <div class="hero-flame">🔥</div>
          <div class="hero-value">{{ streakData().currentStreak }}</div>
          <div class="hero-label">{{ streakData().currentStreak === 1 ? 'week streak' : 'weeks streak' }}</div>
        </div>
        <div class="hero-card card">
          <div class="hero-flame">🏆</div>
          <div class="hero-value">{{ streakData().bestStreak }}</div>
          <div class="hero-label">best streak</div>
        </div>
      </div>

      <!-- Current week progress -->
      <div class="progress-card card">
        <div class="progress-header">
          <span class="progress-label">This week</span>
          <span class="progress-count">{{ currentWeekCount() }} / {{ streakData().weeklyTarget }} sessions</span>
        </div>
        <div class="progress-bar-wrap">
          <div
            class="progress-bar-fill"
            [style.width.%]="Math.min(100, (currentWeekCount() / streakData().weeklyTarget) * 100)"
            [class.complete]="currentWeekCount() >= streakData().weeklyTarget"
          ></div>
        </div>
      </div>

      <!-- Compute button -->
      <div class="compute-row">
        <button class="btn-primary" [class.loading]="streakSvc.computing()" (click)="streakSvc.computeStreak()">
          Compute Streak
        </button>
      </div>

      <!-- Calendar navigation -->
      <div class="calendar-nav card">
        <button class="btn-secondary btn-circle" (click)="changeMonth(-1)">←</button>
        <span class="month-label">{{ monthLabel() }}</span>
        <button class="btn-secondary btn-circle" [disabled]="streakSvc.offsetMonths() >= 0" (click)="changeMonth(1)">→</button>
      </div>

      <!-- Weekly calendar -->
      @if (streakSvc.currentMonthData(); as monthData) {
        <div class="calendar card">
          <div class="week-header">
            @for (wd of weekDays; track wd) {
              <div class="cal-header">{{ wd }}</div>
            }
          </div>
          @for (row of weekRows(); track row.monday) {
            <div class="week-row" [class.qualifying]="row.qualifies">
              @for (day of row.days; track day.date) {
                <div class="cal-cell" [class.out-of-month]="!day.inMonth" [class.today]="day.isToday">
                  <span class="cal-day">{{ day.inMonth ? dayNum(day.date) : '' }}</span>
                </div>
              }
              @if (row.qualifies) {
                <div class="week-flame">🔥</div>
              }
            </div>
          }
          @if (monthData.loading) {
            <div class="calendar-loading">⏳ Loading calendar data…</div>
          }
        </div>
      }

      <!-- Streak meta -->
      @if (streakData().lastUpdated) {
        <div class="streak-meta card">
          <div class="meta-row">
            <span class="meta-label">Weekly target</span>
            <span class="meta-val">{{ streakData().weeklyTarget }} sessions</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Last computed</span>
            <span class="meta-val">{{ streakData().lastUpdated | date:'medium' }}</span>
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
    .progress-card { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .progress-header { display: flex; justify-content: space-between; align-items: center; }
    .progress-label { font-size: 14px; font-weight: 700; }
    .progress-count { font-size: 14px; color: var(--text-muted); }
    .progress-bar-wrap { height: 10px; background: var(--border); border-radius: 5px; overflow: hidden; }
    .progress-bar-fill { height: 100%; background: var(--primary); border-radius: 5px; transition: width .4s; }
    .progress-bar-fill.complete { background: var(--success); }
    .compute-row { display: flex; align-items: center; gap: 10px; }
    .calendar-nav { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; }
    .month-label { font-size: 16px; font-weight: 700; }
    .btn-circle { border-radius: 50%; width: 36px; height: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; }
    .calendar { padding: 14px; display: flex; flex-direction: column; gap: 4px; }
    .week-header { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 4px; }
    .cal-header { text-align: center; font-size: 11px; font-weight: 700; color: var(--text-muted); padding: 2px 0; }
    .week-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; position: relative; border-radius: 8px; padding: 2px; }
    .week-row.qualifying { background: rgba(255, 149, 0, .12); border: 1.5px solid #ff9500; }
    .cal-cell { aspect-ratio: 1; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: var(--bg); border: 1px solid var(--border); }
    .cal-cell.out-of-month { opacity: 0.3; }
    .cal-cell.today { border-color: var(--primary); background: var(--primary-light); }
    .cal-day { font-size: 12px; font-weight: 500; color: var(--text-muted); }
    .week-flame { position: absolute; right: -22px; top: 50%; transform: translateY(-50%); font-size: 16px; }
    .calendar-loading { text-align: center; font-size: 13px; color: var(--text-muted); padding: 12px; }
    .streak-meta { padding: 14px; }
    .meta-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); }
    .meta-row:last-child { border-bottom: none; }
    .meta-label { font-size: 13px; color: var(--text-muted); }
    .meta-val { font-size: 14px; font-weight: 600; }
  `],
})
export class WorkoutStreaksComponent implements OnInit {
  readonly streakSvc = inject(WorkoutStreaksService);
  private readonly workoutState = inject(WorkoutStateService);
  private readonly router = inject(Router);

  goHub(): void { this.router.navigate(['/workout/hub']); }

  readonly weekDays = WEEK_DAYS;
  readonly streakData = this.workoutState.streakData;
  readonly currentWeekCount = signal(0);

  protected readonly Math = Math;

  ngOnInit(): void {
    this.streakSvc.showMonth(0);
    this.loadCurrentWeekCount();
  }

  private async loadCurrentWeekCount(): Promise<void> {
    const count = await this.streakSvc.currentWeekCount();
    this.currentWeekCount.set(count);
  }

  changeMonth(delta: number): void {
    const newOffset = this.streakSvc.offsetMonths() + delta;
    if (newOffset > 0) return;
    this.streakSvc.showMonth(newOffset);
  }

  readonly monthLabel = computed(() => {
    const offset = this.streakSvc.offsetMonths();
    const { year, monthIndex } = this.streakSvc.getYearMonthFromOffset(offset);
    return this.streakSvc.formatMonthLabel(year, monthIndex);
  });

  readonly weekRows = computed(() => {
    const monthData = this.streakSvc.currentMonthData();
    if (!monthData) return [];
    return this.streakSvc.buildWeekRows(monthData.year, monthData.monthIndex, monthData.qualifyingWeeks);
  });

  dayNum(dateStr: string): number {
    return parseInt(dateStr.slice(8), 10);
  }
}
