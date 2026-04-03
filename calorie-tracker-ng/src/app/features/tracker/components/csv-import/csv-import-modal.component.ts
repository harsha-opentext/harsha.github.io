import { Component, inject, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CsvImportService, CsvImportEntry } from './csv-import.service';

const EXAMPLE_CSV = `date,time,food,calories,protein,carbs,fat,healthScore
2026-04-04,8:00 AM,Eggs & toast,320,22,28,10,7
2026-04-04,12:30 PM,Chicken salad,480,38,20,18,8`;

@Component({
  selector: 'app-csv-import-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (svc.state().open) {
      <div class="modal-overlay" (click)="onOverlayClick($event)">
        <div class="modal-box" role="dialog" aria-modal="true">

          <div class="modal-header">
            <h2>📂 Import from CSV</h2>
            <button class="close-btn" (click)="svc.close()">✕</button>
          </div>

          <!-- Step 1: Input -->
          @if (svc.state().step === 'input') {
            <div class="modal-body">
              <p class="hint">Paste CSV data below. Required columns: <code>date</code>, <code>calories</code>.</p>
              <p class="hint">Optional: <code>time</code>, <code>food</code>, <code>protein</code>, <code>carbs</code>, <code>fat</code>, <code>healthScore</code></p>

              <div class="example-row">
                <span class="hint-label">Example:</span>
                <button class="tag-btn" (click)="fillExample()">Insert example</button>
              </div>
              <pre class="example-pre">{{ exampleCsv }}</pre>

              <textarea
                class="csv-textarea"
                [(ngModel)]="rawText"
                placeholder="Paste your CSV here…"
                rows="8"
              ></textarea>

              @if (parseError) {
                <p class="error-msg">{{ parseError }}</p>
              }
            </div>

            <div class="modal-footer">
              <button class="btn-secondary" (click)="svc.close()">Cancel</button>
              <button class="btn-primary" (click)="onParse()">Preview →</button>
            </div>
          }

          <!-- Step 2: Preview -->
          @if (svc.state().step === 'preview') {
            <div class="modal-body preview-body">
              <p class="count-line">{{ svc.state().parsed.length }} entries ready to import. Edit or remove any row below.</p>

              <div class="preview-list">
                @for (entry of svc.state().parsed; track $index) {
                  <div class="preview-card">
                    <div class="preview-row-main">
                      <input type="text" class="pi-input pi-food" [(ngModel)]="entry.food" placeholder="Food" />
                      <input type="number" class="pi-input pi-cal" [(ngModel)]="entry.calories" placeholder="kcal" step="1" />
                      <button class="remove-btn" title="Remove" (click)="svc.removeEntry($index)">✕</button>
                    </div>
                    <div class="preview-row-sub">
                      <input type="date" class="pi-input" [(ngModel)]="entry.date" />
                      <input type="time" class="pi-input" [ngModel]="timeTo24(entry.time)" (ngModelChange)="onTimeChange($index, $event)" />
                      <input type="number" class="pi-input" [(ngModel)]="entry.protein" placeholder="Prot g" step="0.1" />
                      <input type="number" class="pi-input" [(ngModel)]="entry.carbs" placeholder="Carbs g" step="0.1" />
                      <input type="number" class="pi-input" [(ngModel)]="entry.fat" placeholder="Fat g" step="0.1" />
                      <select class="pi-input" [(ngModel)]="entry.healthScore">
                        <option [ngValue]="undefined">Score</option>
                        @for (s of scoreOpts; track s) {
                          <option [value]="s">{{ s }}</option>
                        }
                      </select>
                    </div>
                  </div>
                }
              </div>
            </div>

            <div class="modal-footer">
              <button class="btn-secondary" (click)="backToInput()">← Back</button>
              <button class="btn-primary" [disabled]="svc.state().parsed.length === 0" (click)="onImport()">
                ✅ Import {{ svc.state().parsed.length }} entries
              </button>
            </div>
          }

        </div>
      </div>
    }
  `,
  styles: [`
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 9000; display: flex; align-items: flex-end; justify-content: center; padding: 0; }
    .modal-box { background: var(--card-bg); border-radius: 20px 20px 0 0; width: 100%; max-width: 560px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 18px 10px; border-bottom: 1px solid var(--border); }
    .modal-header h2 { margin: 0; font-size: 18px; font-weight: 700; color: var(--text); }
    .close-btn { background: var(--surface-2); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 16px; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; justify-content: center; }
    .modal-body { flex: 1; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; }
    .preview-body { padding: 10px 12px; }
    .modal-footer { padding: 12px 18px; border-top: 1px solid var(--border); display: flex; gap: 10px; justify-content: flex-end; }
    .hint { font-size: 13px; color: var(--text-muted); margin: 0; line-height: 1.5; }
    .hint code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; font-size: 12px; color: var(--text); }
    .example-row { display: flex; align-items: center; gap: 10px; }
    .hint-label { font-size: 12px; color: var(--text-muted); }
    .tag-btn { padding: 4px 10px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 16px; font-size: 12px; cursor: pointer; }
    .example-pre { background: var(--surface-2); border-radius: 8px; padding: 10px; font-size: 11px; color: var(--text-muted); overflow-x: auto; white-space: pre; margin: 0; }
    .csv-textarea { width: 100%; background: var(--surface-2); color: var(--text); border: 1.5px solid var(--border); border-radius: 10px; padding: 10px 12px; font-size: 13px; font-family: monospace; resize: vertical; box-sizing: border-box; }
    .csv-textarea:focus { outline: none; border-color: var(--primary); }
    .error-msg { color: var(--danger); font-size: 13px; font-weight: 600; margin: 0; }
    .count-line { font-size: 14px; color: var(--text-muted); margin: 0 0 10px; font-weight: 500; }
    .preview-list { display: flex; flex-direction: column; gap: 10px; }
    .preview-card { background: var(--surface-2); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
    .preview-row-main { display: flex; gap: 6px; align-items: center; }
    .preview-row-sub { display: flex; flex-wrap: wrap; gap: 6px; }
    .pi-input { padding: 7px 9px; background: var(--card-bg); color: var(--text); border: 1.5px solid var(--border); border-radius: 8px; font-size: 13px; box-sizing: border-box; min-width: 0; }
    .pi-food { flex: 1; }
    .pi-cal { width: 78px; }
    .remove-btn { background: transparent; border: none; color: var(--danger); font-size: 15px; cursor: pointer; padding: 4px 6px; border-radius: 6px; }
    .remove-btn:hover { background: rgba(255,59,48,0.1); }
  `],
})
export class CsvImportModalComponent {
  readonly svc = inject(CsvImportService);
  @Output() importEntries = new EventEmitter<CsvImportEntry[]>();

  rawText = '';
  parseError = '';
  exampleCsv = EXAMPLE_CSV;
  scoreOpts = Array.from({ length: 10 }, (_, i) => i + 1);

  onOverlayClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) this.svc.close();
  }

  fillExample(): void {
    this.rawText = EXAMPLE_CSV;
    this.parseError = '';
  }

  onParse(): void {
    this.parseError = '';
    if (!this.rawText.trim()) { this.parseError = 'Please paste CSV data first.'; return; }
    const result = this.svc.parse(this.rawText);
    if (!result) { this.parseError = 'No valid rows found. Check your CSV — ensure date and calories columns exist.'; return; }
    this.svc.setParsed(result);
  }

  backToInput(): void {
    this.svc.state.update(s => ({ ...s, step: 'input', parsed: [] }));
  }

  onTimeChange(index: number, time24: string): void {
    if (!time24) return;
    const [h, m] = time24.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const fmt = `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
    const parsed = [...this.svc.state().parsed];
    parsed[index] = { ...parsed[index], time: fmt };
    this.svc.state.update(s => ({ ...s, parsed }));
  }

  onImport(): void {
    const entries = this.svc.state().parsed;
    if (!entries.length) return;
    this.importEntries.emit(entries);
    this.svc.close();
  }

  timeTo24(timeStr: string): string {
    if (!timeStr) return '';
    try {
      const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (!match) return timeStr;
      let h = parseInt(match[1], 10);
      const m = match[2];
      const period = match[3].toUpperCase();
      if (period === 'AM' && h === 12) h = 0;
      if (period === 'PM' && h !== 12) h += 12;
      return `${String(h).padStart(2, '0')}:${m}`;
    } catch { return ''; }
  }
}
