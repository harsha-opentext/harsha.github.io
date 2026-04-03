import { Injectable, signal } from '@angular/core';

export interface CsvModalState {
  open: boolean;
  csv: string;
  count: number;
  source: string;
}

@Injectable({ providedIn: 'root' })
export class CsvExportService {
  readonly state = signal<CsvModalState>({ open: false, csv: '', count: 0, source: '' });

  show(csv: string, count: number, source: string): void {
    this.state.set({ open: true, csv, count, source });
  }

  close(): void {
    this.state.update(s => ({ ...s, open: false }));
  }

  download(): void {
    const csv = this.state().csv;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `entries_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async copyToClipboard(): Promise<void> {
    await navigator.clipboard.writeText(this.state().csv);
  }
}
