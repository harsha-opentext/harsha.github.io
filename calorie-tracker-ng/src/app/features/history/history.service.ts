import { Injectable, inject, computed, signal } from '@angular/core';
import { StateService } from '../../core/services/state.service';
import { GithubApiService } from '../../core/services/github-api.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ConfigService } from '../../core/services/config.service';
import { ConfirmService } from '../../shared/components/confirm-modal/confirm.service';
import { AnyEntry, isWeightEntry } from '../../core/models/entry.model';
import { getTodayString, getEntryDate, formatDateLocal, addDaysToDateString } from '../../shared/utils/date.utils';
import { escapeHtml } from '../../shared/utils/date.utils';

export interface HistoryStats {
  totalEntries: number;
  totalCalories: number;
  avgCaloriesPerDay: number;
  avgProtein: number;
  avgCarbs: number;
  avgFat: number;
}

export interface GroupedDate {
  dateStr: string;
  entries: Array<{ entry: AnyEntry; globalIdx: number }>;
  weight: number | null;
}

const MACRO_ALIAS_MAP: Record<string, string[]> = {
  protein: ['protein', 'Protein', 'protein_g', 'protein(g)', 'protein (g)', 'Protein (g)'],
  carbs: ['carbs', 'Carbs', 'carbohydrates', 'carbohydrate', 'carbs_g', 'carbs(g)', 'carbs (g)', 'Carbs (g)'],
  fat: ['fat', 'Fat', 'fats', 'fat_g', 'fat(g)', 'fat (g)', 'Fat (g)'],
};

function resolveMacroValue(entry: Record<string, unknown>, macroName: string): number {
  const normalizeKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
  const parseNumeric = (v: unknown): number => {
    if (v === undefined || v === null || v === '') return NaN;
    if (typeof v === 'number') return v;
    const m = String(v).match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  };
  const aliases = MACRO_ALIAS_MAP[macroName] || [macroName];
  for (const key of aliases) {
    if (entry[key] !== undefined && entry[key] !== null && entry[key] !== '') {
      const v = parseNumeric(entry[key]);
      if (!isNaN(v)) return v;
    }
  }
  const aliasNorm = aliases.map(normalizeKey);
  for (const [k, raw] of Object.entries(entry)) {
    const nk = normalizeKey(k);
    if (aliasNorm.some(a => nk === a || nk.includes(a) || a.includes(nk))) {
      const v = parseNumeric(raw);
      if (!isNaN(v)) return v;
    }
  }
  const pools: unknown[] = [entry['macros'], entry['macro'], entry['nutrients']];
  for (const pool of pools) {
    if (!pool || typeof pool !== 'object') continue;
    const p = pool as Record<string, unknown>;
    for (const key of aliases) {
      if (p[key] !== undefined) { const v = parseNumeric(p[key]); if (!isNaN(v)) return v; }
    }
    for (const [k, raw] of Object.entries(p)) {
      const nk = normalizeKey(k);
      if (aliasNorm.some(a => nk === a || nk.includes(a) || a.includes(nk))) {
        const v = parseNumeric(raw); if (!isNaN(v)) return v;
      }
    }
  }
  return 0;
}

export const HISTORY_PAGE_SIZE = 5; // dates per page

@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly state = inject(StateService);
  private readonly github = inject(GithubApiService);
  private readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);
  private readonly config = inject(ConfigService);
  private readonly confirm = inject(ConfirmService);

  readonly rangePreset = signal<string>('all');
  readonly loading = signal(false);

  readonly filteredEntries = computed(() => {
    const start = this.state.dateRangeStart();
    const end = this.state.dateRangeEnd();
    const foodFilter = this.state.historyFoodFilter().toLowerCase();
    let entries = this.state.entries().slice();
    if (start && end) {
      if (start === end) {
        entries = entries.filter(e => getEntryDate(e as Record<string, unknown>) === start);
      } else {
        entries = entries.filter(e => {
          const d = getEntryDate(e as Record<string, unknown>);
          return d !== null && d >= start && d <= end;
        });
      }
    }
    if (foodFilter) {
      entries = entries.filter(e => {
        const food = String((e as Record<string, unknown>)['food'] ?? '').toLowerCase();
        const meal = String((e as Record<string, unknown>)['meal'] ?? '').toLowerCase();
        return food.includes(foodFilter) || meal.includes(foodFilter);
      });
    }
    entries.sort((a, b) => {
      const ta = new Date(
        String((a as Record<string, unknown>)['timestamp'] ?? (a as Record<string, unknown>)['date'] ?? '')
      ).getTime();
      const tb = new Date(
        String((b as Record<string, unknown>)['timestamp'] ?? (b as Record<string, unknown>)['date'] ?? '')
      ).getTime();
      return tb - ta;
    });
    return entries;
  });

  readonly stats = computed<HistoryStats>(() => {
    const filtered = this.filteredEntries();
    const uniqueDates = [...new Set(filtered.map(e => getEntryDate(e as Record<string, unknown>)).filter(Boolean))] as string[];
    const numDays = uniqueDates.length || 1;
    const totalCal = filtered.reduce((s, e) => s + (parseFloat(String((e as Record<string, unknown>)['calories'] ?? '0')) || 0), 0);
    let totalP = 0, totalC = 0, totalF = 0;
    filtered.forEach(e => {
      const entry = e as Record<string, unknown>;
      totalP += resolveMacroValue(entry, 'protein');
      totalC += resolveMacroValue(entry, 'carbs');
      totalF += resolveMacroValue(entry, 'fat');
    });
    return {
      totalEntries: filtered.length,
      totalCalories: Math.round(totalCal),
      avgCaloriesPerDay: uniqueDates.length > 0 ? Math.round(totalCal / numDays) : 0,
      avgProtein: Math.round(totalP / numDays),
      avgCarbs: Math.round(totalC / numDays),
      avgFat: Math.round(totalF / numDays),
    };
  });

  readonly groupedDates = computed<GroupedDate[]>(() => {
    const filtered = this.filteredEntries();
    const all = this.state.entries();
    const map: Record<string, GroupedDate> = {};
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      const d = getEntryDate(e as Record<string, unknown>);
      if (!d) continue;
      if (!isWeightEntry(e)) continue; // weight-only pass — collect weights
      if (!map[d]) map[d] = { dateStr: d, entries: [], weight: null };
      const w = (e as Record<string, unknown>)['weightKg'] !== undefined
        ? Number((e as Record<string, unknown>)['weightKg'])
        : Number((e as Record<string, unknown>)['weight'] ?? NaN);
      if (!isNaN(w)) map[d].weight = Math.round(w * 10) / 10;
    }
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      const d = getEntryDate(e as Record<string, unknown>);
      if (!d || isWeightEntry(e)) continue;
      if (!filtered.includes(e)) continue; // only include what passes the filter
      if (!map[d]) map[d] = { dateStr: d, entries: [], weight: null };
      map[d].entries.push({ entry: e, globalIdx: i });
    }
    // Sort entries within each group (newest first)
    for (const d of Object.keys(map)) {
      map[d].entries.sort((a, b) => {
        const ta = new Date(String((a.entry as Record<string, unknown>)['timestamp'] ?? (a.entry as Record<string, unknown>)['date'] ?? '')).getTime();
        const tb = new Date(String((b.entry as Record<string, unknown>)['timestamp'] ?? (b.entry as Record<string, unknown>)['date'] ?? '')).getTime();
        return tb - ta;
      });
    }
    // Return sorted by date descending
    return Object.values(map).sort((a, b) => (a.dateStr < b.dateStr ? 1 : -1));
  });

  readonly totalPages = computed(() => {
    const dates = this.groupedDates();
    return Math.max(1, Math.ceil(dates.length / HISTORY_PAGE_SIZE));
  });

  readonly pagedDates = computed<GroupedDate[]>(() => {
    const groups = this.groupedDates();
    const page = this.state.historyPage();
    const start = (page - 1) * HISTORY_PAGE_SIZE;
    return groups.slice(start, start + HISTORY_PAGE_SIZE);
  });

  readonly weightDataForGraph = computed<Array<{ date: string; weight: number }>>(() => {
    const groups = this.groupedDates();
    return groups
      .filter(g => g.weight !== null)
      .map(g => ({ date: g.dateStr, weight: g.weight! }))
      .sort((a, b) => a.date.localeCompare(b.date));
  });

  setRangePreset(preset: string): void {
    this.rangePreset.set(preset);
    const today = getTodayString();
    if (!preset || preset === 'all') {
      this.state.dateRangeStart.set(null);
      this.state.dateRangeEnd.set(null);
    } else if (preset === 'today') {
      this.state.dateRangeStart.set(today);
      this.state.dateRangeEnd.set(today);
    } else if (preset === 'yesterday') {
      const y = addDaysToDateString(today, -1);
      this.state.dateRangeStart.set(y);
      this.state.dateRangeEnd.set(y);
    } else {
      const days = parseInt(preset, 10);
      if (!isNaN(days)) {
        this.state.dateRangeStart.set(addDaysToDateString(today, -(days - 1)));
        this.state.dateRangeEnd.set(today);
      }
    }
    this.state.historyPage.set(1);
    this.triggerPrefetchIfNeeded();
  }

  setCustomRange(start: string, end: string): void {
    this.state.dateRangeStart.set(start || null);
    this.state.dateRangeEnd.set(end || null);
    this.state.historyUsingCalendar.set(true);
    this.state.historyPage.set(1);
    this.triggerPrefetchIfNeeded();
  }

  private prefetchAttempts = new Set<string>();
  private cacheNotified = new Set<string>();

  async triggerPrefetchIfNeeded(): Promise<void> {
    const start = this.state.dateRangeStart();
    const end = this.state.dateRangeEnd();
    if (!start && !end) return;
    if (this.state.historyFetchInProgress()) return;

    const targets: string[] = [];
    if (start && end) {
      let cur = new Date(start);
      const endDate = new Date(end);
      while (cur <= endDate) {
        targets.push(formatDateLocal(cur));
        cur.setDate(cur.getDate() + 1);
      }
    } else if (start) {
      targets.push(start);
    } else if (end) {
      targets.push(end!);
    }

    const all = this.state.entries();
    const hasAll = targets.every(td => all.some(e => getEntryDate(e as Record<string, unknown>) === td));
    if (hasAll) {
      const key = targets.join(',');
      if (!this.cacheNotified.has(key)) {
        this.cacheNotified.add(key);
        const count = all.filter(e => targets.includes(getEntryDate(e as Record<string, unknown>) ?? '')).length;
        this.notify.showNotification(`History: ${targets.length} date(s) from local cache (${count} entries)`, 'info');
      }
      return;
    }

    const key = targets.join(',');
    if (this.prefetchAttempts.has(key)) return;
    this.prefetchAttempts.add(key);
    this.state.historyFetchInProgress.set(true);

    const missing = targets.filter(td => !all.some(e => getEntryDate(e as Record<string, unknown>) === td));
    this.notify.showNotification(`Fetching ${missing.length} date(s) from GitHub…`, 'info');

    const CHUNK = 5;
    let filesFetched = 0;
    let entriesFetched = 0;
    try {
      if (targets.length === 1) {
        const dateToFetch = missing[0] || targets[0];
        const res = await this.github.fetchDateFromGit(dateToFetch);
        if (res.status === 200 && Array.isArray(res.entries)) {
          this.mergeEntries(res.entries);
          filesFetched = 1; entriesFetched = res.entries.length;
        }
      } else {
        for (let i = 0; i < missing.length; i += CHUNK) {
          const chunk = missing.slice(i, i + CHUNK);
          const results = await Promise.all(chunk.map(async d => {
            try {
              const r = await this.github.fetchDateFromGit(d);
              if (r.status === 200 && Array.isArray(r.entries)) {
                const merged = this.mergeEntries(r.entries);
                return { ok: true, count: merged };
              }
              return { ok: r.status === 404, count: 0 };
            } catch { return { ok: false, count: 0 }; }
          }));
          filesFetched += results.filter(r => r.ok).length;
          entriesFetched += results.reduce((s, r) => s + r.count, 0);
          if (results.some(r => !r.ok)) {
            this.log.dbg('One or more per-date fetches failed', 'warn');
            this.notify.showNotification('One or more per-day fetches failed; full-folder fallback disabled.', 'error');
            break;
          }
        }
        this.notify.showNotification(`Fetched ${filesFetched} files (${entriesFetched} entries)`, 'info');
      }
    } finally {
      this.state.historyFetchInProgress.set(false);
    }
  }

  private mergeEntries(newEntries: AnyEntry[]): number {
    const existingKeys = new Set(this.state.entries().map(e => JSON.stringify(e)));
    const toAdd = newEntries.filter(e => !existingKeys.has(JSON.stringify(e)));
    if (toAdd.length > 0) this.state.entries.update(prev => [...prev, ...toAdd]);
    return toAdd.length;
  }

  async deleteEntry(globalIdx: number): Promise<void> {
    const entries = this.state.entries();
    const removed = entries[globalIdx];
    if (!removed) return;
    const dateStr = getEntryDate(removed as Record<string, unknown>);
    if (!dateStr) return;
    const remaining = entries.filter(
      (e, i) => i !== globalIdx && getEntryDate(e as Record<string, unknown>) === dateStr
    );
    let ok: boolean;
    if (remaining.length === 0) {
      ok = await this.github.deleteDateFile(dateStr);
    } else {
      ok = await this.github.pushDateFile(dateStr, remaining);
    }
    if (ok) {
      this.state.entries.update(ents => ents.filter((_, i) => i !== globalIdx));
      this.notify.showNotification('Entry deleted', 'info');
      this.confirm.close();
    } else {
      alert('Failed to delete entry remotely. See logs.');
    }
  }

  async editWeightForDate(dateStr: string, newWeight: number): Promise<boolean> {
    const entries = this.state.entries();
    const existing = entries.findIndex(e => {
      const entry = e as Record<string, unknown>;
      return entry['_meta'] === 'dailyWeight' && getEntryDate(entry) === dateStr;
    });
    const rounded = Math.round(newWeight * 10) / 10;
    let ok: boolean;
    if (existing !== -1) {
      const updated = { ...(entries[existing] as Record<string, unknown>), weightKg: rounded } as AnyEntry;
      const others = entries.filter(
        (e, i) => i !== existing && getEntryDate(e as Record<string, unknown>) === dateStr
      );
      ok = await this.github.pushDateFile(dateStr, [...others, updated]);
      if (ok) {
        this.state.entries.update(ents => ents.map((e, i) => i === existing ? updated : e));
      }
    } else {
      const newEntry: AnyEntry = {
        _meta: 'dailyWeight', weightKg: rounded,
        timestamp: new Date().toISOString(), date: dateStr, _sourceDate: dateStr,
      } as unknown as AnyEntry;
      const dateEntries = entries.filter(e => getEntryDate(e as Record<string, unknown>) === dateStr);
      ok = await this.github.pushDateFile(dateStr, [...dateEntries, newEntry]);
      if (ok) {
        this.state.entries.update(ents => [...ents, newEntry]);
      }
    }
    return ok;
  }

  async bulkDelete(indices: number[]): Promise<void> {
    const entries = this.state.entries();
    const toRemove = new Set(indices);
    const previewByDate: Record<string, AnyEntry[]> = {};
    for (const i of indices) {
      const e = entries[i];
      const d = getEntryDate(e as Record<string, unknown>) || 'Unknown';
      if (!previewByDate[d]) previewByDate[d] = [];
      previewByDate[d].push(e);
    }

    let detailsHtml = '<div style="display:flex;flex-direction:column;gap:8px;">';
    for (const d of Object.keys(previewByDate).sort().slice(0, 50)) {
      const items = previewByDate[d];
      detailsHtml += `<div style="font-weight:600">${d} (${items.length})</div><ul style="margin:0 0 8px 16px">`;
      for (let j = 0; j < Math.min(items.length, 10); j++) {
        const f = (items[j] as Record<string, unknown>)['food'] || '(entry)';
        detailsHtml += `<li>${escapeHtml(String(f))}</li>`;
      }
      if (items.length > 10) detailsHtml += `<li>...and ${items.length - 10} more</li>`;
      detailsHtml += '</ul>';
    }
    detailsHtml += '</div>';

    const proceed = await this.confirm.show(`Delete ${indices.length} entries?`, 'Confirm Delete', detailsHtml);
    if (!proceed) return;

    const affectedDates = new Set<string>();
    const remainingByDate: Record<string, AnyEntry[]> = {};
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const d = getEntryDate(e as Record<string, unknown>);
      if (!d) continue;
      if (!remainingByDate[d]) remainingByDate[d] = [];
      if (!toRemove.has(i)) remainingByDate[d].push(e);
      if (toRemove.has(i)) affectedDates.add(d);
    }

    for (const dateStr of affectedDates) {
      const remaining = remainingByDate[dateStr] || [];
      let ok: boolean;
      if (remaining.length === 0) {
        ok = await this.github.deleteDateFile(dateStr);
      } else {
        ok = await this.github.pushDateFile(dateStr, remaining);
      }
      if (!ok) { alert(`Failed to write ${dateStr}`); return; }
    }

    const removeIdx = indices.slice().sort((a, b) => b - a);
    this.state.entries.update(ents => {
      const arr = ents.slice();
      removeIdx.forEach(idx => arr.splice(idx, 1));
      return arr;
    });
    this.state.historySelectedEntries.set(new Set());
    this.state.historySelectMode.set(false);
    this.confirm.close();
    this.notify.showNotification(`Deleted ${indices.length} entries`, 'info');
  }
}
