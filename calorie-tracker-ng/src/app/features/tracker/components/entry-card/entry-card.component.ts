import {
  Component, Input, Output, EventEmitter, inject, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnyEntry, isWeightEntry } from '../../../../core/models/entry.model';
import { SchemaField } from '../../../../core/models/schema.model';
import { StateService } from '../../../../core/services/state.service';
import { formatDateReadable } from '../../../../shared/utils/date.utils';

@Component({
  selector: 'app-entry-card',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="entry-card" [class.selected]="isSelected" [class.editing]="isEditing">
      <!-- Select checkbox (select mode) -->
      @if (selectMode) {
        <input
          type="checkbox"
          class="entry-checkbox"
          [checked]="isSelected"
          (change)="toggleSelect.emit()"
        />
      }

      @if (!isEditing) {
        <!-- View mode -->
        <div class="entry-main">
          <div class="entry-header">
            <span class="entry-meal">{{ displayLabel() }}</span>
            @if (healthScore()) {
              <span class="health-badge score-{{ healthScore() }}">{{ healthScore() }}</span>
            }
            <span class="entry-time">{{ entryTime() }}</span>
            @if (mode === 'history') {
              <span class="entry-date-badge">{{ entryDate() }}</span>
            }
          </div>
          <div class="entry-calories">
            <span class="cals-num">{{ calories() }}</span>
            <span class="cals-label">cal</span>
          </div>
          @if (hasMacros()) {
            <div class="entry-macros">
              @if (protein()) { <span>P: {{ protein() }}g</span> }
              @if (carbs()) { <span>C: {{ carbs() }}g</span> }
              @if (fat()) { <span>F: {{ fat() }}g</span> }
            </div>
          }
        </div>

        <!-- Actions -->
        <div class="entry-actions">
          @if (mode === 'tracker') {
            <button class="btn-icon" title="Edit" (click)="startEdit()">✏️</button>
            <button class="btn-icon" title="+1 serving" (click)="repeatEntry.emit()">🔁</button>
            <button class="btn-icon btn-danger" title="Delete" (click)="deleteEntry.emit()">🗑️</button>
          }
          @if (mode === 'history') {
            <button class="btn-icon" title="Add to today" (click)="addToToday.emit()">➕</button>
            <button class="btn-icon btn-danger" title="Delete" (click)="deleteEntry.emit()">🗑️</button>
          }
        </div>
      } @else {
        <!-- Edit mode -->
        <div class="edit-form">
          @for (field of editableFields(); track field.name) {
            <div class="edit-field">
              @if (field.type === 'select') {
                <select class="form-input" [(ngModel)]="editValues[field.name]">
                  @for (opt of field.options ?? []; track opt) {
                    <option [value]="opt">{{ opt }}</option>
                  }
                </select>
              } @else {
                <input
                  [type]="field.name === 'time' ? 'time' : field.type"
                  class="form-input"
                  [placeholder]="field.label ?? field.name"
                  [(ngModel)]="editValues[field.name]"
                />
              }
            </div>
          }
          <div class="edit-actions">
            <button class="btn-primary" (click)="saveEdit()">Save</button>
            <button class="btn-secondary" (click)="cancelEdit()">Cancel</button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .entry-card { display: flex; align-items: flex-start; gap: 10px; background: var(--card-bg); border-radius: 14px; padding: 14px; border: 1.5px solid var(--border); transition: border-color .2s; }
    .entry-card.selected { border-color: var(--primary); background: var(--primary-light, #f0f4ff); }
    .entry-main { flex: 1; min-width: 0; }
    .entry-header { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
    .entry-meal { font-weight: 600; color: var(--text); font-size: 15px; }
    .entry-time { font-size: 12px; color: var(--text-muted); }
    .entry-date-badge { font-size: 11px; background: var(--primary-light, #e8f0fe); color: var(--primary); border-radius: 6px; padding: 2px 6px; }
    .health-badge { font-size: 11px; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; background: var(--primary-light, #e8f4fc); color: var(--primary); }
    .entry-calories { font-size: 22px; font-weight: 700; color: var(--primary); margin-bottom: 4px; }
    .cals-label { font-size: 13px; font-weight: 400; color: var(--text-muted); margin-left: 2px; }
    .entry-macros { display: flex; gap: 10px; font-size: 12px; color: var(--text-muted); }
    .entry-actions { display: flex; flex-direction: column; gap: 4px; }
    .btn-icon { background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px; border-radius: 6px; }
    .btn-icon:hover { background: var(--surface-3); }
    .btn-danger:hover { color: #f44336; }
    .edit-form { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .edit-field { display: flex; }
    .edit-actions { grid-column: span 2; display: flex; gap: 8px; }
    .form-input { padding: 8px 10px; border: 1.5px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 14px; width: 100%; box-sizing: border-box; }
    .entry-checkbox { margin-top: 4px; width: 18px; height: 18px; cursor: pointer; flex-shrink: 0; }
  `],
})
export class EntryCardComponent {
  @Input({ required: true }) entry!: AnyEntry;
  @Input() mode: 'tracker' | 'history' = 'tracker';
  @Input() selectMode = false;
  @Input() isSelected = false;
  @Output() deleteEntry = new EventEmitter<void>();
  @Output() repeatEntry = new EventEmitter<void>();
  @Output() addToToday = new EventEmitter<void>();
  @Output() saveEdited = new EventEmitter<AnyEntry>();
  @Output() toggleSelect = new EventEmitter<void>();

  readonly state = inject(StateService);

  isEditing = false;
  editValues: Record<string, string> = {};

  private getField(name: string): unknown {
    return (this.entry as Record<string, unknown>)[name];
  }

  displayLabel(): string {
    const meal = this.getField('food') || this.getField('meal') || this.getField('name') || 'Entry';
    return String(meal);
  }

  calories(): number {
    const c = this.getField('calories');
    return c ? Number(c) : 0;
  }

  protein(): number | null {
    const p = this.getField('protein');
    return p !== undefined && p !== '' && p !== null ? Number(p) : null;
  }

  carbs(): number | null {
    const c = this.getField('carbs');
    return c !== undefined && c !== '' && c !== null ? Number(c) : null;
  }

  fat(): number | null {
    const f = this.getField('fat');
    return f !== undefined && f !== '' && f !== null ? Number(f) : null;
  }

  hasMacros(): boolean {
    return this.protein() !== null || this.carbs() !== null || this.fat() !== null;
  }

  healthScore(): string {
    const hs = this.getField('healthScore');
    return hs ? String(hs) : '';
  }

  entryTime(): string {
    const t = this.getField('time');
    return t ? String(t) : '';
  }

  entryDate(): string {
    const d = this.getField('date');
    return d ? formatDateReadable(String(d)) : '';
  }

  readonly editableFields = computed(() => {
    const schema = this.state.schema();
    if (!schema) return [];
    return schema.fields.filter(
      (f: SchemaField) => f.type !== 'hidden' && !f.autoCapture
    );
  });

  startEdit(): void {
    const schema = this.state.schema();
    if (!schema) return;
    const vals: Record<string, string> = {};
    schema.fields
      .filter((f: SchemaField) => f.type !== 'hidden' && !f.autoCapture)
      .forEach((f: SchemaField) => {
        let v = (this.entry as Record<string, unknown>)[f.name];
        if (f.name === 'time' && v) {
          // convert 12h to 24h for time input
          const raw = String(v);
          const m = raw.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
          if (m) {
            let h = parseInt(m[1], 10);
            const min = m[2];
            const ampm = m[3].toUpperCase();
            if (ampm === 'PM' && h !== 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            v = `${String(h).padStart(2, '0')}:${min}`;
          }
        }
        vals[f.name] = v !== undefined && v !== null ? String(v) : '';
      });
    this.editValues = vals;
    this.isEditing = true;
  }

  cancelEdit(): void {
    this.isEditing = false;
    this.editValues = {};
  }

  saveEdit(): void {
    const schema = this.state.schema();
    if (!schema) return;
    const updated: Record<string, unknown> = { ...(this.entry as object) };
    schema.fields
      .filter((f: SchemaField) => f.type !== 'hidden' && !f.autoCapture)
      .forEach((f: SchemaField) => {
        let v: unknown = this.editValues[f.name];
        if (v === '' || v === null || v === undefined) {
          delete updated[f.name];
          return;
        }
        if (f.type === 'number') {
          const n = parseFloat(String(v));
          if (!isNaN(n)) v = n;
        }
        if (f.name === 'time') {
          // convert 24h back to 12h
          const raw = String(v);
          const parts = raw.split(':');
          if (parts.length === 2) {
            let h = parseInt(parts[0], 10);
            const min = parts[1];
            const ampm = h >= 12 ? 'PM' : 'AM';
            if (h > 12) h -= 12;
            if (h === 0) h = 12;
            v = `${h}:${min} ${ampm}`;
          }
        }
        updated[f.name] = v;
      });
    this.saveEdited.emit(updated as AnyEntry);
    this.isEditing = false;
    this.editValues = {};
  }
}
