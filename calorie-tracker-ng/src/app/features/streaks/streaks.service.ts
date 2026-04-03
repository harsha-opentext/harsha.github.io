import { Injectable, inject, signal, computed } from '@angular/core';
import { StateService } from '../../core/services/state.service';
import { GithubApiService } from '../../core/services/github-api.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { getTodayString, getEntryDate, addDaysToDateString, formatDateLocal } from '../../shared/utils/date.utils';
import { isWeightEntry } from '../../core/models/entry.model';

export interface MonthCalendarData {
  year: number;
  monthIndex: number;
  activeDates: Set<string>;
  loaded: boolean;
  loading: boolean;
}

@Injectable({ providedIn: 'root' })
export class StreaksService {
  private readonly state = inject(StateService);
  private readonly github = inject(GithubApiService);
  private readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);

  readonly computing = signal(false);
  readonly computeProgress = signal<{ done: number; total: number; current: string } | null>(null);

  // Keyed by YYYY-MM
  private readonly monthCache = new Map<string, MonthCalendarData>();
  readonly currentMonthData = signal<MonthCalendarData | null>(null);

  readonly offsetMonths = computed(() => this.state.streakCalendar().offsetMonths);

  async showMonth(offset: number): Promise<void> {
    this.state.streakCalendar.update(s => ({ ...s, offsetMonths: offset }));
    const { year, monthIndex } = this.getYearMonthFromOffset(offset);
    const key = this.monthKey(year, monthIndex);
    const cached = this.monthCache.get(key);
    if (cached?.loaded) {
      this.currentMonthData.set(cached);
      return;
    }
    if (cached?.loading) return;
    const monthData: MonthCalendarData = { year, monthIndex, activeDates: new Set(), loaded: false, loading: true };
    this.monthCache.set(key, monthData);
    this.currentMonthData.set(monthData);

    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const days: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(`${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }

    this.computeProgress.set({ done: 0, total: days.length, current: '' });
    const CHUNK = 6;
    for (let i = 0; i < days.length; i += CHUNK) {
      const chunk = days.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async (dateStr) => {
        try {
          const res = await this.github.fetchDateFromGit(dateStr);
          if (res.status === 200 && Array.isArray(res.entries)) {
            const hasActive = res.entries.some(e => !isWeightEntry(e));
            if (hasActive) monthData.activeDates.add(dateStr);
          }
        } catch {}
        this.computeProgress.update(p => p ? { ...p, done: p.done + 1, current: dateStr } : null);
      }));
    }

    monthData.loaded = true;
    monthData.loading = false;
    this.computeProgress.set(null);
    this.currentMonthData.set({ ...monthData });
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
    } catch { return `${year}-${monthIndex + 1}`; }
  }

  buildCalendarCells(year: number, monthIndex: number, activeDates: Set<string>): Array<{ day: number | null; dateStr: string | null; active: boolean }> {
    const first = new Date(year, monthIndex, 1);
    const startOffset = (first.getDay() + 6) % 7; // 0=Monday
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const totalSlots = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    const cells: Array<{ day: number | null; dateStr: string | null; active: boolean }> = [];
    for (let slot = 0; slot < totalSlots; slot++) {
      if (slot < startOffset || slot >= startOffset + daysInMonth) {
        cells.push({ day: null, dateStr: null, active: false });
      } else {
        const day = slot - startOffset + 1;
        const ds = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        cells.push({ day, dateStr: ds, active: activeDates.has(ds) });
      }
    }
    return cells;
  }

  async computeCurrentStreak(): Promise<void> {
    this.computing.set(true);
    try {
      const all = this.state.entries();
      const activeDates = new Set<string>();
      for (const e of all) {
        if (isWeightEntry(e)) continue;
        const d = getEntryDate(e as Record<string, unknown>);
        if (d) activeDates.add(d);
      }
      const today = getTodayString();
      let count = 0;
      let cursor = today;
      for (let i = 0; i < 365; i++) {
        if (activeDates.has(cursor)) {
          count++;
          cursor = addDaysToDateString(cursor, -1);
        } else {
          // Try fetching from GitHub
          try {
            const res = await this.github.fetchDateFromGit(cursor);
            if (res.status === 200 && Array.isArray(res.entries)) {
              const hasActive = res.entries.some(e => !isWeightEntry(e));
              if (hasActive) { count++; cursor = addDaysToDateString(cursor, -1); continue; }
            }
          } catch {}
          break;
        }
      }
      const streak = this.state.streak();
      this.state.streak.set({
        ...streak,
        currentStreak: count,
        lastActiveDate: count > 0 ? today : streak.lastActiveDate,
        computedAt: new Date().toISOString(),
      });
      this.notify.showNotification(`Current streak: ${count}d`, 'info');
      await this.github.pushStreakFile(this.state.streak()).catch(() => {});
    } finally {
      this.computing.set(false);
    }
  }
}
