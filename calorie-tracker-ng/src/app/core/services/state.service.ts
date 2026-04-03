import { Injectable, signal, computed } from '@angular/core';
import { AnyEntry, isWeightEntry } from '../models/entry.model';
import { StreakData } from '../models/streak.model';
import { Schema } from '../models/schema.model';
import { getTodayString } from '../../shared/utils/date.utils';

export interface StreakCalendarState {
  offsetMonths: number;
  cache: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class StateService {
  // Core data
  readonly entries = signal<AnyEntry[]>([]);
  readonly fileIndex = signal<Record<string, string>>({});
  readonly schema = signal<Schema | null>(null);

  // Streak
  readonly streak = signal<StreakData>({
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: null,
    computedAt: null,
    activeDates: [],
    recentActiveDates: [],
  });
  readonly streakCalendar = signal<StreakCalendarState>({ offsetMonths: 0, cache: {} });

  // Logging
  readonly logLevel = signal<string>('info');
  readonly retentionMinutes = signal<number>(5);

  // History filter
  readonly dateRangeStart = signal<string | null>(null);
  readonly dateRangeEnd = signal<string | null>(null);
  readonly historyPage = signal<number>(1);
  readonly historyUsingCalendar = signal<boolean>(false);
  readonly historyFetchInProgress = signal<boolean>(false);
  readonly historyPrefetchAttempts = signal<Set<string>>(new Set());
  readonly historyCacheNotified = signal<Set<string>>(new Set());

  // Selection
  readonly selectMode = signal<boolean>(false);
  readonly selectedEntries = signal<Set<number>>(new Set());
  readonly historySelectMode = signal<boolean>(false);
  readonly historySelectedEntries = signal<Set<number>>(new Set());

  // UI transient
  readonly hasUnsavedChanges = signal<boolean>(false);
  readonly autoSyncing = signal<boolean>(false);
  readonly weightEditMode = signal<boolean>(false);
  readonly weightEditTargetDate = signal<string | null>(null);
  readonly tempCsvData = signal<string | null>(null);
  readonly csvSource = signal<string | null>(null);
  readonly historyFoodFilter = signal<string>('');

  // Analytics
  readonly analyticsDate = signal<string>(getTodayString());

  // Derived
  readonly todayEntries = computed(() => {
    const today = getTodayString();
    return this.entries().filter(e => {
      const entry = e as Record<string, unknown>;
      const d = (entry['date'] || entry['_sourceDate']) as string | undefined;
      return d === today && !isWeightEntry(e);
    });
  });

  readonly todayCalories = computed(() =>
    this.todayEntries().reduce((s, e) => s + (parseFloat(String((e as Record<string, unknown>)['calories'] ?? 0)) || 0), 0)
  );

  readonly todayMacros = computed(() => {
    const today = getTodayString();
    return this.entries()
      .filter(e => {
        const entry = e as Record<string, unknown>;
        const d = (entry['date'] || entry['_sourceDate']) as string | undefined;
        return d === today && !isWeightEntry(e);
      })
      .reduce(
        (acc, e) => {
          const entry = e as Record<string, unknown>;
          acc.protein += parseFloat(String(entry['protein'] ?? 0)) || 0;
          acc.carbs += parseFloat(String(entry['carbs'] ?? 0)) || 0;
          acc.fat += parseFloat(String(entry['fat'] ?? 0)) || 0;
          return acc;
        },
        { protein: 0, carbs: 0, fat: 0 }
      );
  });

  normalizeEntries(): void {
    const e = this.entries();
    if (Array.isArray(e)) return;
    if (!e || typeof e !== 'object') { this.entries.set([]); return; }
    const obj = e as Record<string, AnyEntry[]>;
    const keys = Object.keys(obj);
    const looksLikeDateMap = keys.length > 0 && keys.every(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(obj[k]));
    if (looksLikeDateMap) {
      const merged = keys.sort().reduce((acc, k) => acc.concat(obj[k] || []), [] as AnyEntry[]);
      this.entries.set(merged);
    } else {
      this.entries.set([]);
    }
  }
}
