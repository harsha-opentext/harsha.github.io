import { Injectable, inject } from '@angular/core';
import { StateService } from '../../core/services/state.service';
import { GithubApiService } from '../../core/services/github-api.service';
import { SchemaService } from '../../core/services/schema.service';
import { ConfigService } from '../../core/services/config.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ConfirmService } from '../../shared/components/confirm-modal/confirm.service';
import { CsvExportService } from '../../shared/components/csv-export-modal/csv-export.service';
import { AnyEntry, isWeightEntry } from '../../core/models/entry.model';
import { SchemaField } from '../../core/models/schema.model';
import { getTodayString, getEntryDate } from '../../shared/utils/date.utils';
import { time24To12 } from '../../shared/utils/time.utils';
import { escapeHtml } from '../../shared/utils/date.utils';

@Injectable({ providedIn: 'root' })
export class TrackerService {
  private readonly state = inject(StateService);
  private readonly github = inject(GithubApiService);
  private readonly schema = inject(SchemaService);
  private readonly config = inject(ConfigService);
  private readonly log = inject(LoggingService);
  private readonly notify = inject(NotificationService);
  private readonly confirm = inject(ConfirmService);
  private readonly csv = inject(CsvExportService);

  getFormData(formValues: Record<string, string>): AnyEntry | null {
    const schema = this.state.schema();
    if (!schema) return null;
    const data: Record<string, unknown> = {};
    schema.fields.forEach((field: SchemaField) => {
      if (field.autoCapture) {
        if (field.name === 'timestamp') data['timestamp'] = new Date().toISOString();
        return;
      }
      let value: unknown = formValues[field.name];
      if (value === undefined || value === null || value === '') return;
      if (field.type === 'number') {
        const n = parseFloat(value as string);
        if (isNaN(n) || n === 0) return;
        value = n;
      }
      if (field.name === 'time') {
        const raw = value as string;
        if (!raw) {
          value = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        } else {
          value = time24To12(raw) || raw;
        }
      }
      if (value === '' || value === null || value === undefined) return;
      data[field.name] = value;
    });
    return data as AnyEntry;
  }

  validateRequiredFields(data: AnyEntry): boolean {
    const schema = this.state.schema();
    if (!schema) return false;
    const entry = data as Record<string, unknown>;
    return schema.fields
      .filter((f: SchemaField) => f.required && !f.autoCapture)
      .every((f: SchemaField) => {
        const val = entry[f.name];
        return val !== undefined && val !== null && val !== '';
      });
  }

  async addEntry(data: AnyEntry): Promise<boolean> {
    // Weight entries have a different shape — skip schema-based validation
    if (!isWeightEntry(data) && !this.validateRequiredFields(data)) {
      this.log.dbg('Required fields missing', 'error');
      return false;
    }
    this.state.entries.update(entries => [...entries, data]);
    this.state.hasUnsavedChanges.set(true);
    const dateStr = getEntryDate(data as Record<string, unknown>) || getTodayString();
    try {
      const ok = await this.github.pushEntryForDate(dateStr, data);
      if (ok) this.state.hasUnsavedChanges.set(false);
      return ok;
    } catch (err) {
      this.log.dbg('Auto-save per-date push failed', 'error', err);
      return false;
    }
  }

  async editEntry(index: number, updated: AnyEntry): Promise<boolean> {
    const entries = this.state.entries();
    if (index < 0 || index >= entries.length) return false;
    const removed = entries[index];
    const dateStr = getEntryDate(removed as Record<string, unknown>);
    if (!dateStr) return false;

    // Build updated list for the date
    const dateEntries = entries.filter((e, i) => i !== index && getEntryDate(e as Record<string, unknown>) === dateStr);
    dateEntries.push(updated);

    const ok = await this.github.pushDateFile(dateStr, dateEntries);
    if (ok) {
      this.state.entries.update(ents => ents.map((e, i) => (i === index ? updated : e)));
      this.state.hasUnsavedChanges.set(false);
    }
    return ok;
  }

  async deleteEntry(index: number): Promise<void> {
    const proceed = await this.confirm.show('Delete this entry?');
    if (!proceed) return;
    return this._doDelete(index);
  }

  /** Delete without confirmation dialog (for programmatic deletions like weight=0 removal) */
  async deleteEntryDirect(index: number): Promise<boolean> {
    const entries = this.state.entries();
    const removed = entries[index];
    if (!removed) return false;
    const dateStr = getEntryDate(removed as Record<string, unknown>);
    if (!dateStr) return false;
    const remaining = entries.filter((e, i) => i !== index && getEntryDate(e as Record<string, unknown>) === dateStr);
    let ok: boolean;
    if (remaining.length === 0) {
      ok = await this.github.deleteDateFile(dateStr);
    } else {
      ok = await this.github.pushDateFile(dateStr, remaining);
    }
    if (ok) {
      this.state.entries.update(ents => ents.filter((_, i) => i !== index));
      this.state.hasUnsavedChanges.set(false);
    }
    return ok;
  }

  private async _doDelete(index: number): Promise<void> {
    const entries = this.state.entries();
    const removed = entries[index];
    if (!removed) { this.confirm.close(); return; }
    const dateStr = getEntryDate(removed as Record<string, unknown>);
    if (!dateStr) { this.confirm.close(); return; }

    const remaining = entries.filter((e, i) => i !== index && getEntryDate(e as Record<string, unknown>) === dateStr);
    this.state.hasUnsavedChanges.set(true);

    let ok: boolean;
    if (remaining.length === 0) {
      ok = await this.github.deleteDateFile(dateStr);
    } else {
      ok = await this.github.pushDateFile(dateStr, remaining);
    }

    if (ok) {
      this.state.entries.update(ents => ents.filter((_, i) => i !== index));
      this.state.hasUnsavedChanges.set(false);
      const food = (removed as Record<string, unknown>)['food'];
      this.notify.showNotification(`Deleted entry${food ? ': ' + String(food) : ''}`, 'delete');
      this.confirm.close();
    } else {
      this.log.dbg('Delete aborted: remote write/delete failed', 'error');
      alert('Failed to persist delete to repo. Check logs.');
      this.state.hasUnsavedChanges.set(false);
    }
  }

  async repeatEntryToday(index: number): Promise<void> {
    const entries = this.state.entries();
    const original = entries[index];
    if (!original) return;
    const today = getTodayString();
    const copy: AnyEntry = {
      ...(original as Record<string, unknown>),
      timestamp: new Date().toISOString(),
      date: today,
      _sourceDate: today,
    } as AnyEntry;
    await this.addEntry(copy);
  }

  async addEntryToToday(index: number): Promise<void> {
    return this.repeatEntryToday(index);
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

    let detailsHtml = '<div style="display:flex; flex-direction:column; gap:8px;">';
    for (const d of Object.keys(previewByDate).sort().slice(0, 50)) {
      const items = previewByDate[d];
      detailsHtml += `<div style="font-weight:600; margin-bottom:4px;">${d} (${items.length})</div><ul style="margin:0 0 8px 16px; padding:0; list-style:disc; max-height:120px; overflow:auto;">`;
      for (let j = 0; j < Math.min(items.length, 10); j++) {
        const f = (items[j] as Record<string, unknown>)['food'] || '(no food)';
        detailsHtml += `<li>${escapeHtml(String(f))}</li>`;
      }
      if (items.length > 10) detailsHtml += `<li>...and ${items.length - 10} more</li>`;
      detailsHtml += '</ul>';
    }
    detailsHtml += '</div>';

    const proceed = await this.confirm.show(`Delete ${indices.length} selected entries?`, 'Confirm Delete', detailsHtml);
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

    this.state.hasUnsavedChanges.set(true);
    this.log.dbg(`Bulk delete: removing ${indices.length} entries`, 'info');

    try {
      for (const dateStr of affectedDates) {
        const remaining = remainingByDate[dateStr] || [];
        let ok: boolean;
        if (remaining.length === 0) {
          ok = await this.github.deleteDateFile(dateStr);
        } else {
          ok = await this.github.pushDateFile(dateStr, remaining);
        }
        if (!ok) throw new Error(`Failed to write ${dateStr}`);
      }
      const removeIdx = indices.slice().sort((a, b) => b - a);
      this.state.entries.update(ents => {
        const arr = ents.slice();
        removeIdx.forEach(idx => arr.splice(idx, 1));
        return arr;
      });
      this.state.selectedEntries.set(new Set());
      this.state.selectMode.set(false);
      this.state.historySelectedEntries.set(new Set());
      this.state.historySelectMode.set(false);
      this.state.hasUnsavedChanges.set(false);
      this.confirm.close();
      this.log.dbg(`Bulk deleted ${indices.length} entries`, 'info');
    } catch (e) {
      this.log.dbg('Bulk delete failed', 'error', e);
      this.confirm.close();
      alert('Failed to persist bulk delete. Check logs.');
      this.state.hasUnsavedChanges.set(false);
    }
  }

  exportToCsv(indices: number[], source: string): void {
    const entries = this.state.entries();
    const selected = indices.map(i => entries[i]);
    const headers = ['Date', 'Time', 'Food', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Health Score (1-10)'];
    let csvText = headers.join(',') + '\n';
    selected.forEach(entry => {
      const e = entry as Record<string, unknown>;
      const row = [
        e['date'] || '', e['time'] || '', e['food'] || '',
        e['calories'] || '', e['protein'] || '', e['carbs'] || '',
        e['fat'] || '', e['healthScore'] || '',
      ];
      csvText += row.join(',') + '\n';
    });
    this.csv.show(csvText, selected.length, source);
  }

  findWeightForDate(dateStr: string): number | null {
    for (const e of this.state.entries()) {
      if (isWeightEntry(e)) {
        const d = (e as Record<string, unknown>)['date'] || (e as Record<string, unknown>)['_sourceDate'];
        if (d === dateStr) {
          const w = e.weightKg !== undefined ? Number(e.weightKg) : (e.weight !== undefined ? Number(e.weight) : NaN);
          if (!isNaN(w)) return Math.round(w * 10) / 10;
        }
      }
    }
    return null;
  }
}
