import { Injectable, signal } from '@angular/core';

export interface CsvImportEntry {
  date: string;
  food: string;
  calories: number;
  time: string;
  protein?: number;
  carbs?: number;
  fat?: number;
  healthScore?: number;
  timestamp: string;
}

interface CsvImportState {
  open: boolean;
  parsed: CsvImportEntry[];
  step: 'input' | 'preview';
  rawText: string;
}

@Injectable({ providedIn: 'root' })
export class CsvImportService {
  readonly state = signal<CsvImportState>({ open: false, parsed: [], step: 'input', rawText: '' });

  open(): void {
    this.state.set({ open: true, parsed: [], step: 'input', rawText: '' });
  }

  close(): void {
    this.state.update(s => ({ ...s, open: false }));
  }

  parse(raw: string): CsvImportEntry[] | null {
    const lines = raw.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 1) return null;

    const first = lines[0].split(',').map(h => h.trim().toLowerCase());
    const isHeader = first.some(h => h.includes('date') || h.includes('calor') || h.includes('food') || h.includes('time'));

    let header: string[];
    let startRow: number;
    if (isHeader) {
      header = first;
      startRow = 1;
      if (!header.some(h => h.includes('date')) || !header.some(h => h.includes('calor'))) return null;
    } else {
      header = ['date', 'time', 'food', 'calories', 'protein', 'carbs', 'fat'];
      startRow = 0;
    }

    const idx = (needle: string) => header.findIndex(h => h.includes(needle));
    const dateIdx = idx('date'), timeIdx = idx('time'), foodIdx = idx('food');
    const calIdx = idx('calor'), protIdx = idx('prot'), carbIdx = idx('carb'), fatIdx = idx('fat');
    const hsIdx = header.findIndex(h => h.includes('score') || h.includes('health'));

    const results: CsvImportEntry[] = [];
    for (let i = startRow; i < lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.trim());
      const date = dateIdx >= 0 ? vals[dateIdx] : undefined;
      const calories = calIdx >= 0 ? parseFloat(vals[calIdx]) : NaN;
      if (!date || isNaN(calories)) continue;

      let time = '';
      if (timeIdx >= 0 && vals[timeIdx]) {
        time = vals[timeIdx];
      } else {
        time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      }

      let tsDate = new Date();
      try {
        const ts = new Date(date + (time ? ' ' + time : ''));
        if (!isNaN(ts.getTime())) tsDate = ts;
      } catch { /* ignore */ }

      const entry: CsvImportEntry = {
        date,
        food: (foodIdx >= 0 && vals[foodIdx]) ? vals[foodIdx] : 'Imported',
        calories,
        time,
        timestamp: tsDate.toISOString(),
      };
      if (protIdx >= 0 && vals[protIdx]) { const v = parseFloat(vals[protIdx]); if (!isNaN(v)) entry.protein = v; }
      if (carbIdx >= 0 && vals[carbIdx]) { const v = parseFloat(vals[carbIdx]); if (!isNaN(v)) entry.carbs = v; }
      if (fatIdx >= 0 && vals[fatIdx])  { const v = parseFloat(vals[fatIdx]);  if (!isNaN(v)) entry.fat = v; }
      if (hsIdx >= 0 && vals[hsIdx])    { const v = parseInt(vals[hsIdx], 10); if (!isNaN(v)) entry.healthScore = v; }
      results.push(entry);
    }
    return results.length > 0 ? results : null;
  }

  setParsed(entries: CsvImportEntry[]): void {
    this.state.update(s => ({ ...s, parsed: entries, step: 'preview' }));
  }

  updateEntry(index: number, field: keyof CsvImportEntry, value: string | number): void {
    this.state.update(s => {
      const parsed = [...s.parsed];
      parsed[index] = { ...parsed[index], [field]: value };
      return { ...s, parsed };
    });
  }

  removeEntry(index: number): void {
    this.state.update(s => {
      const parsed = s.parsed.filter((_, i) => i !== index);
      return { ...s, parsed };
    });
  }
}
