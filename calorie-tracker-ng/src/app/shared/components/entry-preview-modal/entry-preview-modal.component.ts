import {
  Component, inject, signal, computed, effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../../core/services/state.service';
import { SchemaField } from '../../../core/models/schema.model';
import { AnyEntry } from '../../../core/models/entry.model';
import { getTodayString } from '../../utils/date.utils';
import { time24To12, timeTo24 } from '../../utils/time.utils';
import { EntryPreviewService } from './entry-preview.service';

@Component({
  selector: 'app-entry-preview-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (svc.state().open) {
      <div class="modal-overlay" (click)="cancel()">
        <div class="modal-box" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>{{ svc.state().title }}</h3>
            <button class="modal-close" (click)="cancel()">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              @for (field of editableFields(); track field.name) {
                <div class="form-field" [class.full-width]="field.type === 'text' || field.name === 'food'">
                  <label class="field-label">{{ field.label ?? field.name }}</label>
                  @if (field.type === 'select') {
                    <select class="form-input" [(ngModel)]="editValues[field.name]">
                      @for (opt of field.options ?? []; track opt) {
                        <option [value]="opt">{{ opt }}</option>
                      }
                    </select>
                  } @else if (field.name === 'time') {
                    <input type="time" class="form-input" [(ngModel)]="editValues[field.name]" />
                  } @else {
                    <input
                      [type]="field.type === 'number' ? 'number' : 'text'"
                      class="form-input"
                      [placeholder]="field.placeholder ?? field.label ?? field.name"
                      [(ngModel)]="editValues[field.name]"
                      [min]="field.min ?? null"
                    />
                  }
                </div>
              }
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" (click)="cancel()">Cancel</button>
            <button class="btn-primary" [class.loading]="saving()" (click)="confirm()">
              {{ svc.state().confirmLabel ?? 'Add to Today' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; align-items: flex-end; justify-content: center; padding: 0; }
    @media (min-width: 500px) { .modal-overlay { align-items: center; padding: 16px; } }
    .modal-box { width: 100%; max-width: 480px; background: var(--card-bg); border-radius: 20px 20px 0 0; padding: 20px 16px 32px; max-height: 90vh; overflow-y: auto; }
    @media (min-width: 500px) { .modal-box { border-radius: 16px; padding: 20px; } }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
    .modal-header h3 { margin: 0; font-size: 17px; font-weight: 700; color: var(--text); }
    .modal-close { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-muted); padding: 4px; }
    .modal-body { display: flex; flex-direction: column; gap: 0; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-field { display: flex; flex-direction: column; gap: 4px; }
    .form-field.full-width { grid-column: span 2; }
    .field-label { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
    .form-input { padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 15px; width: 100%; box-sizing: border-box; }
    .form-input:focus { outline: none; border-color: var(--primary); }
    .modal-footer { display: flex; gap: 10px; margin-top: 20px; }
    .modal-footer button { flex: 1; padding: 13px; font-size: 15px; }
  `],
})
export class EntryPreviewModalComponent {
  readonly svc = inject(EntryPreviewService);
  readonly state = inject(StateService);
  readonly saving = signal(false);

  editValues: Record<string, string> = {};

  readonly SKIP_FIELDS = ['timestamp', '_meta', '_sourceDate'];

  readonly editableFields = computed(() => {
    const schema = this.state.schema();
    if (!schema) return [];
    return schema.fields.filter(
      (f: SchemaField) => f.type !== 'hidden' && !this.SKIP_FIELDS.includes(f.name)
    );
  });

  constructor() {
    // Pre-fill form whenever modal opens with a new entry
    effect(() => {
      const st = this.svc.state();
      if (st.open && st.entry) {
        this.prefill(st.entry);
      }
    });
  }

  prefill(entry: AnyEntry): void {
    const schema = this.state.schema();
    if (!schema) return;
    const e = entry as Record<string, unknown>;
    const vals: Record<string, string> = {};
    schema.fields.forEach((f: SchemaField) => {
      if (f.type === 'hidden' || this.SKIP_FIELDS.includes(f.name)) return;
      const raw = e[f.name];
      if (f.name === 'date') {
        vals[f.name] = getTodayString();
      } else if (f.name === 'time' && typeof raw === 'string') {
        // convert "12h AM/PM" → 24h for the time input
        vals[f.name] = timeTo24(raw) || raw;
      } else {
        vals[f.name] = raw !== undefined && raw !== null ? String(raw) : '';
      }
    });
    this.editValues = vals;
  }

  cancel(): void {
    this.svc.reject();
  }

  async confirm(): Promise<void> {
    this.saving.set(true);
    try {
      const schema = this.state.schema();
      const original = this.svc.state().entry!;
      const e = original as Record<string, unknown>;
      const updated: Record<string, unknown> = {
        ...e,
        timestamp: new Date().toISOString(),
        date: getTodayString(),
        _sourceDate: getTodayString(),
      };
      schema?.fields.forEach((f: SchemaField) => {
        if (f.type === 'hidden' || this.SKIP_FIELDS.includes(f.name)) return;
        const raw = this.editValues[f.name];
        if (raw === '' || raw === undefined || raw === null) {
          delete updated[f.name];
          return;
        }
        if (f.name === 'time') {
          updated[f.name] = time24To12(raw) || raw;
        } else if (f.type === 'number') {
          const n = parseFloat(raw);
          if (!isNaN(n) && n !== 0) updated[f.name] = n;
          else delete updated[f.name];
        } else {
          updated[f.name] = raw;
        }
      });
      this.svc.resolve(updated as AnyEntry);
    } finally {
      this.saving.set(false);
    }
  }
}
