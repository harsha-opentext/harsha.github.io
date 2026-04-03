import {
  Component, Input, Output, EventEmitter, inject, computed, signal, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../../../core/services/state.service';
import { SchemaField } from '../../../../core/models/schema.model';
import { AnyEntry } from '../../../../core/models/entry.model';
import { getTodayString } from '../../../../shared/utils/date.utils';
import { time24To12, timeTo24 } from '../../../../shared/utils/time.utils';

@Component({
  selector: 'app-entry-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (state.schema(); as schema) {
      <div class="form-grid">
        @for (field of visibleMainFields(); track field.name) {
          <div class="form-field" [style.gridColumn]="field.type === 'date' ? '1' : 'auto'">
            @if (field.name === 'time') {
              <input
                type="time"
                class="form-input"
                [id]="'field-' + field.name"
                [(ngModel)]="formValues[field.name]"
                placeholder="Meal time"
              />
            } @else if (field.name === 'healthScore') {
              <select
                class="form-input"
                [id]="'field-' + field.name"
                [(ngModel)]="formValues[field.name]"
              >
                <option value="">{{ 'Select ' + (field.label ?? field.name) }}</option>
                @for (opt of healthScoreOptions(); track opt) {
                  <option [value]="opt">{{ opt }}</option>
                }
              </select>
            } @else if (field.type === 'select') {
              <select
                class="form-input"
                [id]="'field-' + field.name"
                [(ngModel)]="formValues[field.name]"
                [required]="!!field.required"
              >
                @if (!field.required) {
                  <option value="">{{ 'Select ' + (field.label ?? field.name) }}</option>
                }
                @for (opt of field.options ?? []; track opt) {
                  <option [value]="opt">{{ opt }}</option>
                }
              </select>
            } @else {
              <input
                [type]="field.type"
                class="form-input"
                [id]="'field-' + field.name"
                [(ngModel)]="formValues[field.name]"
                [placeholder]="field.placeholder ?? field.label ?? field.name"
                [required]="!!field.required"
                [min]="field.min ?? null"
                [max]="field.max ?? null"
              />
            }
          </div>
        }

        <!-- Macro toggle button -->
        <div class="form-field" style="grid-column: span 2;">
          <button type="button" class="btn-secondary macro-toggle" (click)="toggleMacros()">
            {{ macrosVisible ? '📊 Hide Macros' : '📊 Add Macros (Optional)' }}
          </button>
        </div>

        <!-- Macro fields (collapsible) -->
        @if (macrosVisible) {
          <div class="macro-section">
            @for (field of macroFields(); track field.name) {
              <div class="form-field">
                <input
                  type="number"
                  class="form-input"
                  [id]="'field-' + field.name"
                  [(ngModel)]="formValues[field.name]"
                  [placeholder]="field.label ?? field.name"
                  [min]="field.min ?? 0"
                />
              </div>
            }
          </div>
        }

        <!-- Submit -->
        <div class="form-field" style="grid-column: span 2;">
          <button type="button" class="btn-primary submit-btn" [class.loading]="loading" (click)="onSubmit()">
            ➕ Add Entry
          </button>
        </div>
      </div>
    } @else {
      <div class="schema-error">
        <h3>⚠️ Schema Loading Error</h3>
        <p>The app cannot load the form without a valid schema.yaml file.</p>
        <p>Run a local server: <code>python3 -m http.server 8000</code></p>
      </div>
    }
  `,
  styles: [`
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    @media (max-width: 380px) { .form-grid { grid-template-columns: 1fr; } }
    .form-field { display: flex; flex-direction: column; }
    .form-field:first-child { grid-column: span 2; }
    @media (max-width: 380px) { .form-field:first-child { grid-column: span 1; } }
    .form-input { padding: 12px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 16px; width: 100%; box-sizing: border-box; -webkit-appearance: none; height: 48px; }
    .form-input:focus { outline: none; border-color: var(--primary); }
    .macro-toggle { width: 100%; padding: 10px; font-size: 14px; }
    .macro-section { grid-column: span 2; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    @media (max-width: 380px) { .macro-section { grid-template-columns: 1fr; } }
    .submit-btn { width: 100%; padding: 14px 20px; font-size: 16px; }
    .schema-error { padding: 20px; background: var(--surface-2); color: var(--text); border-radius: 12px; border: 1px solid var(--border); }
    .schema-error code { background: var(--surface-3); color: var(--primary); padding: 2px 6px; border-radius: 4px; }
    :host ::ng-deep .loading { opacity: 0.7; pointer-events: none; }
  `],
})
export class EntryFormComponent implements OnInit {
  @Output() entryAdded = new EventEmitter<AnyEntry>();

  readonly state = inject(StateService);
  loading = false;
  macrosVisible = false;
  formValues: Record<string, string> = {};

  readonly MACRO_FIELDS = ['protein', 'carbs', 'fat'];

  ngOnInit(): void {
    this.resetForm();
  }

  readonly visibleMainFields = computed(() => {
    const schema = this.state.schema();
    if (!schema) return [];
    return schema.fields.filter(
      (f: SchemaField) => f.type !== 'hidden' && !this.MACRO_FIELDS.includes(f.name)
    );
  });

  readonly macroFields = computed(() => {
    const schema = this.state.schema();
    if (!schema) return [];
    return schema.fields.filter((f: SchemaField) => this.MACRO_FIELDS.includes(f.name));
  });

  readonly healthScoreOptions = computed(() => {
    const schema = this.state.schema();
    if (!schema) return [];
    const field = schema.fields.find((f: SchemaField) => f.name === 'healthScore');
    if (!field) return [];
    const min = field.min ?? 1;
    const max = field.max ?? 10;
    const opts: string[] = [];
    for (let i = min; i <= max; i++) opts.push(String(i));
    return opts;
  });

  toggleMacros(): void {
    this.macrosVisible = !this.macrosVisible;
  }

  resetForm(): void {
    const schema = this.state.schema();
    if (!schema) { this.formValues = {}; return; }
    const vals: Record<string, string> = {};
    schema.fields.forEach((f: SchemaField) => {
      if (f.type === 'hidden') return;
      if (f.type === 'date' && f.default === 'today') {
        vals[f.name] = getTodayString();
      } else if (f.type === 'select' && f.default) {
        vals[f.name] = String(f.default);
      } else {
        vals[f.name] = '';
      }
    });
    this.formValues = vals;
    this.macrosVisible = false;
  }

  buildEntry(): AnyEntry | null {
    const schema = this.state.schema();
    if (!schema) return null;
    const data: Record<string, unknown> = {};
    schema.fields.forEach((field: SchemaField) => {
      if (field.autoCapture) {
        if (field.name === 'timestamp') data['timestamp'] = new Date().toISOString();
        return;
      }
      let value: unknown = this.formValues[field.name];
      if (value === undefined || value === null || String(value) === '') return;
      if (field.type === 'number') {
        const n = parseFloat(String(value));
        if (isNaN(n) || n === 0) return;
        value = n;
      }
      if (field.name === 'time') {
        const raw = String(value);
        value = raw ? (time24To12(raw) || raw) : new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      }
      if (value !== '' && value !== null && value !== undefined) data[field.name] = value;
    });
    return data as AnyEntry;
  }

  onSubmit(): void {
    const entry = this.buildEntry();
    if (!entry) return;
    // Validate required fields
    const schema = this.state.schema();
    if (schema) {
      const missingRequired = schema.fields
        .filter((f: SchemaField) => f.required && !f.autoCapture)
        .some((f: SchemaField) => {
          const v = (entry as Record<string, unknown>)[f.name];
          return v === undefined || v === null || v === '';
        });
      if (missingRequired) return;
    }
    this.loading = true;
    this.entryAdded.emit(entry);
    setTimeout(() => {
      this.loading = false;
      this.resetForm();
    }, 500);
  }
}
