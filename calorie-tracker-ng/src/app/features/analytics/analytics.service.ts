import { Injectable, inject, signal, computed } from '@angular/core';
import { StateService } from '../../core/services/state.service';
import { GithubApiService } from '../../core/services/github-api.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { AnyEntry } from '../../core/models/entry.model';
import { getTodayString, getEntryDate } from '../../shared/utils/date.utils';

export interface ScoredMeal {
  food: string;
  calories: number;
  score: number;
  color: string;
}

export interface NutritionQuality {
  dayScore: number | null;
  highCals: number;
  midCals: number;
  lowCals: number;
  totalCals: number;
  hasScores: boolean;
  scoredMeals: ScoredMeal[];
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly state = inject(StateService);
  private readonly github = inject(GithubApiService);
  private readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);

  readonly loading = signal(false);
  private fetchAttempts = new Set<string>();
  private tempCache: Record<string, AnyEntry[]> = {};

  readonly selectedDate = this.state.analyticsDate;

  readonly entriesForDate = computed(() => {
    const dateStr = this.selectedDate();
    const cached = this.tempCache[dateStr];
    if (cached) return cached;
    const all = this.state.entries();
    return all.filter(e => getEntryDate(e as Record<string, unknown>) === dateStr);
  });

  readonly mealData = computed(() => {
    const entries = this.entriesForDate();
    const map: Record<string, number> = {};
    for (const e of entries) {
      const entry = e as Record<string, unknown>;
      const time = String(entry['time'] || 'No Time');
      map[time] = (map[time] || 0) + (parseFloat(String(entry['calories'] ?? '0')) || 0);
    }
    return map;
  });

  readonly macroData = computed(() => {
    const entries = this.entriesForDate();
    let protein = 0, carbs = 0, fat = 0;
    for (const e of entries) {
      const entry = e as Record<string, unknown>;
      protein += parseFloat(String(entry['protein'] ?? '0')) || 0;
      carbs += parseFloat(String(entry['carbs'] ?? '0')) || 0;
      fat += parseFloat(String(entry['fat'] ?? '0')) || 0;
    }
    return { protein, carbs, fat };
  });

  readonly nutritionQuality = computed<NutritionQuality>(() => {
    const entries = this.entriesForDate();
    const totalCals = entries.reduce((s, e) => s + (parseFloat(String((e as Record<string, unknown>)['calories'] ?? '0')) || 0), 0);
    const scored = entries.filter(e => !isNaN(parseInt(String((e as Record<string, unknown>)['healthScore'] ?? ''), 10)));
    let highCals = 0, midCals = 0, lowCals = 0;
    for (const e of entries) {
      const entry = e as Record<string, unknown>;
      const hs = parseInt(String(entry['healthScore'] ?? ''), 10);
      const kcal = parseFloat(String(entry['calories'] ?? '0')) || 0;
      if (isNaN(hs)) continue;
      if (hs >= 7) highCals += kcal;
      else if (hs >= 4) midCals += kcal;
      else lowCals += kcal;
    }
    let dayScore: number | null = null;
    if (scored.length > 0 && totalCals > 0) {
      const scoredCals = highCals + midCals + lowCals;
      dayScore = scored.reduce((s, e) => {
        const entry = e as Record<string, unknown>;
        const hs = parseInt(String(entry['healthScore'] ?? ''), 10);
        const kcal = parseFloat(String(entry['calories'] ?? '0')) || 0;
        return s + (hs * kcal);
      }, 0) / (scoredCals || 1);
    }
    const scoredMeals: ScoredMeal[] = scored
      .map(e => {
        const entry = e as Record<string, unknown>;
        const hs = parseInt(String(entry['healthScore'] ?? ''), 10);
        const kcal = parseFloat(String(entry['calories'] ?? '0')) || 0;
        const color = hs >= 7 ? '#34c759' : hs >= 4 ? '#ff9500' : '#ff3b30';
        return { food: String(entry['food'] ?? 'Meal'), calories: kcal, score: hs, color };
      })
      .sort((a, b) => b.score - a.score);
    return { dayScore, highCals, midCals, lowCals, totalCals, hasScores: scored.length > 0, scoredMeals };
  });

  async loadDateIfNeeded(dateStr: string): Promise<void> {
    const has = this.state.entries().some(e => getEntryDate(e as Record<string, unknown>) === dateStr);
    if (has || this.tempCache[dateStr]) return;
    if (this.fetchAttempts.has(dateStr)) return;
    this.fetchAttempts.add(dateStr);
    this.loading.set(true);
    try {
      const res = await this.github.fetchDateFromGit(dateStr);
      if (res.status === 200 && Array.isArray(res.entries)) {
        this.tempCache[dateStr] = res.entries;
        const existingKeys = new Set(this.state.entries().map(e => JSON.stringify(e)));
        const newEntries = res.entries.filter(e => !existingKeys.has(JSON.stringify(e)));
        if (newEntries.length > 0) this.state.entries.update(prev => [...prev, ...newEntries]);
      } else if (res.status === 404) {
        this.tempCache[dateStr] = [];
        this.log.dbg(`Analytics: ${dateStr} not found on GitHub (404)`, 'info');
      }
    } catch (err) {
      this.log.dbg(`Analytics fetch error for ${dateStr}: ${String(err)}`, 'error');
      this.notify.showNotification('Analytics per-date fetch failed', 'error');
    } finally {
      this.loading.set(false);
    }
  }
}
