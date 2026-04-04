import { Injectable, inject, signal } from '@angular/core';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { LoggingService } from '../../../core/services/logging.service';
import { NotificationService } from '../../../core/services/notification.service';
import { WorkoutStreakData } from '../../../core/models/workout-streak.model';
import { getTodayString } from '../../../shared/utils/date.utils';

export interface WeekCalendarData {
  year: number;
  monthIndex: number;
  qualifyingWeeks: Set<string>; // monday date strings of qualifying weeks
  loaded: boolean;
  loading: boolean;
}

@Injectable({ providedIn: 'root' })
export class WorkoutStreaksService {
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly workoutState = inject(WorkoutStateService);
  private readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);

  readonly computing = signal(false);
  readonly offsetMonths = signal(0);
  readonly currentMonthData = signal<WeekCalendarData | null>(null);

  private readonly monthCache = new Map<string, WeekCalendarData>();

  /** Returns the Monday of the ISO week containing dateStr (YYYY-MM-DD) */
  getWeekMonday(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay(); // 0=Sun, 1=Mon, …
    const diff = (day + 6) % 7; // days since Monday
    d.setDate(d.getDate() - diff);
    return d.toISOString().slice(0, 10);
  }

  getYearMonthFromOffset(offset: number): { year: number; monthIndex: number } {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return { year: d.getFullYear(), monthIndex: d.getMonth() };
  }

  monthKey(year: number, monthIndex: number): string {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  }

  formatMonthLabel(year: number, monthIndex: number): string {
    try {
      return new Date(year, monthIndex, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    } catch {
      return `${year}-${monthIndex + 1}`;
    }
  }

  /**
   * Compute week streak from all session date files.
   * A week qualifies if session count >= weeklyTarget.
   */
  async computeStreak(): Promise<void> {
    if (this.computing()) return;
    this.computing.set(true);
    try {
      const target = this.workoutState.config().weeklyTarget;
      const dates = await this.workoutGithub.listSessionFiles();
      if (dates.length === 0) {
        const newStreak: WorkoutStreakData = {
          currentStreak: 0,
          bestStreak: 0,
          weeklyTarget: target,
          lastUpdated: new Date().toISOString(),
        };
        this.workoutState.streakData.set(newStreak);
        await this.workoutGithub.saveWorkoutStreak(newStreak);
        return;
      }

      // Group sessions by their Monday
      const weekCounts = new Map<string, number>();
      for (const d of dates) {
        const monday = this.getWeekMonday(d);
        weekCounts.set(monday, (weekCounts.get(monday) ?? 0) + 1);
      }

      // Sort qualifying weeks
      const qualifyingWeeks = Array.from(weekCounts.entries())
        .filter(([, cnt]) => cnt >= target)
        .map(([monday]) => monday)
        .sort();

      // Compute best and current streak (consecutive weeks)
      let bestStreak = 0;
      let currentStreak = 0;
      let run = 0;

      for (let i = 0; i < qualifyingWeeks.length; i++) {
        if (i === 0) {
          run = 1;
        } else {
          const prev = new Date(qualifyingWeeks[i - 1] + 'T00:00:00');
          prev.setDate(prev.getDate() + 7);
          const prevNext = prev.toISOString().slice(0, 10);
          if (prevNext === qualifyingWeeks[i]) {
            run++;
          } else {
            run = 1;
          }
        }
        if (run > bestStreak) bestStreak = run;
      }

      // Current streak: count back from current/last week
      const todayMonday = this.getWeekMonday(getTodayString());
      const qSet = new Set(qualifyingWeeks);
      let check = todayMonday;
      while (qSet.has(check)) {
        currentStreak++;
        const d = new Date(check + 'T00:00:00');
        d.setDate(d.getDate() - 7);
        check = d.toISOString().slice(0, 10);
      }
      // Also check previous week if this week isn't qualifying yet
      if (currentStreak === 0) {
        const lastWeek = new Date(todayMonday + 'T00:00:00');
        lastWeek.setDate(lastWeek.getDate() - 7);
        let c = lastWeek.toISOString().slice(0, 10);
        while (qSet.has(c)) {
          currentStreak++;
          const d = new Date(c + 'T00:00:00');
          d.setDate(d.getDate() - 7);
          c = d.toISOString().slice(0, 10);
        }
      }

      const newStreak: WorkoutStreakData = {
        currentStreak,
        bestStreak,
        weeklyTarget: target,
        lastUpdated: new Date().toISOString(),
      };
      this.workoutState.streakData.set(newStreak);
      await this.workoutGithub.saveWorkoutStreak(newStreak);
      this.notify.showNotification(`Streak computed: ${currentStreak} weeks`, 'info');
    } catch (err) {
      this.log.dbg('computeStreak error', 'error', err);
    } finally {
      this.computing.set(false);
    }
  }

  /** Count sessions in the current calendar week */
  async currentWeekCount(): Promise<number> {
    const todayMonday = this.getWeekMonday(getTodayString());
    const dates = await this.workoutGithub.listSessionFiles();
    return dates.filter(d => this.getWeekMonday(d) === todayMonday).length;
  }

  async showMonth(offset: number): Promise<void> {
    this.offsetMonths.set(offset);
    const { year, monthIndex } = this.getYearMonthFromOffset(offset);
    const key = this.monthKey(year, monthIndex);
    const cached = this.monthCache.get(key);
    if (cached?.loaded) {
      this.currentMonthData.set(cached);
      return;
    }
    if (cached?.loading) return;

    const monthData: WeekCalendarData = {
      year, monthIndex,
      qualifyingWeeks: new Set(),
      loaded: false, loading: true,
    };
    this.monthCache.set(key, monthData);
    this.currentMonthData.set(monthData);

    try {
      const target = this.workoutState.config().weeklyTarget;
      const dates = await this.workoutGithub.listSessionFiles();
      const weekCounts = new Map<string, number>();
      for (const d of dates) {
        const monday = this.getWeekMonday(d);
        weekCounts.set(monday, (weekCounts.get(monday) ?? 0) + 1);
      }
      // Mark qualifying weeks that fall in this month
      weekCounts.forEach((cnt, monday) => {
        if (cnt >= target) {
          const d = new Date(monday + 'T00:00:00');
          // A week belongs to the month if its Monday or any of its days is in the month
          if (d.getFullYear() === year && d.getMonth() === monthIndex) {
            monthData.qualifyingWeeks.add(monday);
          }
          // Also include if Sunday of that week is in month
          const sun = new Date(d);
          sun.setDate(sun.getDate() + 6);
          if (sun.getFullYear() === year && sun.getMonth() === monthIndex) {
            monthData.qualifyingWeeks.add(monday);
          }
        }
      });
    } catch (err) {
      this.log.dbg('showMonth error', 'error', err);
    } finally {
      monthData.loaded = true;
      monthData.loading = false;
      this.currentMonthData.set({ ...monthData });
    }
  }

  /** Build calendar week rows for a given month — same pattern as calorie streaks */
  buildWeekRows(year: number, monthIndex: number, qualifyingWeeks: Set<string>): Array<{
    monday: string;
    days: Array<{ date: string; inMonth: boolean; isToday: boolean }>;
    qualifies: boolean;
  }> {
    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7; // Monday=0
    const gridStart = new Date(firstDay);
    gridStart.setDate(gridStart.getDate() - startOffset);

    const today = getTodayString();
    const rows: Array<{
      monday: string;
      days: Array<{ date: string; inMonth: boolean; isToday: boolean }>;
      qualifies: boolean;
    }> = [];

    let d = new Date(gridStart);
    while (d <= lastDay || d.getMonth() === monthIndex) {
      const monday = d.toISOString().slice(0, 10);
      const days = Array.from({ length: 7 }, (_, i) => {
        const day = new Date(d);
        day.setDate(day.getDate() + i);
        const dateStr = day.toISOString().slice(0, 10);
        return {
          date: dateStr,
          inMonth: day.getMonth() === monthIndex,
          isToday: dateStr === today,
        };
      });
      if (days.some(day => day.inMonth)) {
        rows.push({ monday, days, qualifies: qualifyingWeeks.has(monday) });
      }
      d.setDate(d.getDate() + 7);
      if (d.getMonth() > monthIndex && d.getFullYear() >= year) break;
    }
    return rows;
  }
}
