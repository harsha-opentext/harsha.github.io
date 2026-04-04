import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { ConfirmService } from '../../../shared/components/confirm-modal/confirm.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LoggingService } from '../../../core/services/logging.service';
import { SessionTemplate, TemplateEntry, TemplateSet } from '../../../core/models/session-template.model';
import { Workout } from '../../../core/models/workout.model';
import { generateUUID } from '../../../shared/utils/uuid.utils';
import { getTodayString } from '../../../shared/utils/date.utils';
import { Session } from '../../../core/models/session.model';

type PageView = 'list' | 'create' | 'edit' | 'apply';

interface EditableSet {
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  breakSeconds: number | null;
}

interface EditableEntry {
  workoutId: string;
  sets: EditableSet[];
}

@Component({
  selector: 'app-session-templates',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="templates-page">

      <!-- ── List view ── -->
      @if (view() === 'list') {
        <div class="page-header">
          <div class="header-left">
            <button class="hub-back-btn" (click)="goHub()">← Hub</button>
            <h2 class="page-title">Templates</h2>
          </div>
          <button class="btn-primary btn-sm" (click)="startCreate()">+ New</button>
        </div>

        @if (!templatesLoaded()) {
          <div class="loading-card card"><p>⏳ Loading…</p></div>
        } @else if (templates().length === 0) {
          <div class="empty-state card">
            <div class="empty-icon">📋</div>
            <p>No templates yet.</p>
            <p class="text-muted">Create a template to quickly start a session with predefined exercises.</p>
          </div>
        }

        @for (tmpl of templates(); track tmpl.id) {
          <div class="template-card card">
            <div class="template-header">
              <div class="template-info">
                <div class="template-name">{{ tmpl.name }}</div>
                @if (tmpl.gymName) {
                  <div class="template-gym">🏢 {{ tmpl.gymName }}</div>
                }
                <div class="template-meta">{{ tmpl.entries.length }} exercise{{ tmpl.entries.length !== 1 ? 's' : '' }}</div>
              </div>
              <div class="template-actions">
                <button class="btn-primary btn-sm" (click)="applyTemplate(tmpl)">▶ Use</button>
                <button class="icon-btn edit" (click)="startEdit(tmpl)" title="Edit">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button class="icon-btn delete" (click)="deleteTemplate(tmpl)" title="Delete">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </button>
              </div>
            </div>
            <div class="exercise-list">
              @for (entry of tmpl.entries; track entry.workoutId) {
                <div class="exercise-pill">
                  <span>{{ workoutName(entry.workoutId) }}</span>
                  <span class="pill-sets">{{ entry.sets.length }}×</span>
                </div>
              }
            </div>
          </div>
        }
      }

      <!-- ── Create / Edit form ── -->
      @if (view() === 'create' || view() === 'edit') {
        <div class="page-header">
          <h2 class="page-title">{{ view() === 'create' ? 'New Template' : 'Edit Template' }}</h2>
          <button class="btn-secondary btn-sm" (click)="view.set('list')">← Back</button>
        </div>

        <div class="form-card card">
          <div class="field-group">
            <label class="field-label">Template Name <span class="required">*</span></label>
            <input type="text" class="form-input" [(ngModel)]="formName" placeholder="e.g. Push Day A" maxlength="60" />
          </div>
          <div class="field-group">
            <label class="field-label">Default Gym</label>
            <input type="text" class="form-input" [(ngModel)]="formGym" placeholder="Optional" />
          </div>
        </div>

        <!-- Exercise entries in form -->
        @for (entry of formEntries; track entry.workoutId; let ei = $index) {
          <div class="entry-card card">
            <div class="entry-header">
              <div class="entry-info">
                <span class="entry-name">{{ workoutName(entry.workoutId) }}</span>
                <span class="entry-set-count">{{ entry.sets.length }} set{{ entry.sets.length !== 1 ? 's' : '' }}</span>
              </div>
              <button class="icon-btn delete" (click)="removeFormEntry(ei)" title="Remove">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            @for (set of entry.sets; track set.setNumber; let si = $index) {
              <div class="set-row">
                <span class="set-num">{{ set.setNumber }}</span>
                <div class="set-field">
                  <span class="set-label">Reps</span>
                  <input type="number" class="set-input" [(ngModel)]="set.reps" min="1" />
                </div>
                <div class="set-field">
                  <span class="set-label">Weight (kg)</span>
                  <input type="number" class="set-input" [(ngModel)]="set.weightKg" min="0" step="0.5" />
                </div>
                <div class="set-field">
                  <span class="set-label">Rest (s)</span>
                  <input type="number" class="set-input" [(ngModel)]="set.breakSeconds" min="0" placeholder="—" />
                </div>
                <button class="remove-set-btn" (click)="removeFormSet(ei, si)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            }
            <button class="btn-ghost btn-xs add-set-btn" (click)="addFormSet(ei)">+ Add Set</button>
          </div>
        }

        <!-- Add exercise selector -->
        <div class="add-exercise card">
          <div class="add-exercise-row">
            <select class="form-input" [(ngModel)]="formSelectedWorkoutId">
              <option value="">— Select exercise —</option>
              @for (w of workouts(); track w.id) {
                <option [value]="w.id">{{ w.name }}</option>
              }
            </select>
            <button class="btn-secondary btn-sm" [disabled]="!formSelectedWorkoutId" (click)="addFormEntry()">+ Add</button>
          </div>
          @if (workouts().length === 0) {
            <p class="hint-text">No workouts defined yet. Add workouts first.</p>
          }
        </div>

        <div class="form-actions">
          <button class="btn-primary save-btn" [class.loading]="saving()" (click)="saveForm()">
            {{ view() === 'create' ? 'Create Template' : 'Save Changes' }}
          </button>
          <button class="btn-secondary" (click)="view.set('list')">Cancel</button>
        </div>
      }

      <!-- ── Apply view — edit values before starting session ── -->
      @if (view() === 'apply') {
        <div class="page-header">
          <h2 class="page-title">{{ applyName }}</h2>
          <button class="btn-secondary btn-sm" (click)="view.set('list')">← Back</button>
        </div>
        <p class="apply-hint card">Edit weights and reps below, then tap <strong>Start Session</strong> to log this workout for today.</p>

        <div class="apply-header-card card">
          <div class="field-group">
            <label class="field-label">Gym</label>
            <input type="text" class="form-input" [(ngModel)]="applyGym" placeholder="Optional" />
          </div>
        </div>

        @for (entry of applyEntries; track entry.workoutId; let ei = $index) {
          <div class="entry-card card">
            <div class="entry-header">
              <div class="entry-info">
                <span class="entry-name">{{ workoutName(entry.workoutId) }}</span>
                <span class="entry-set-count">{{ entry.sets.length }} sets</span>
              </div>
            </div>
            @for (set of entry.sets; track set.setNumber) {
              <div class="set-row">
                <span class="set-num">{{ set.setNumber }}</span>
                <div class="set-field">
                  <span class="set-label">Reps</span>
                  <input type="number" class="set-input" [(ngModel)]="set.reps" min="1" />
                </div>
                <div class="set-field">
                  <span class="set-label">Weight (kg)</span>
                  <input type="number" class="set-input" [(ngModel)]="set.weightKg" min="0" step="0.5" />
                </div>
                <div class="set-field">
                  <span class="set-label">Rest (s)</span>
                  <input type="number" class="set-input" [(ngModel)]="set.breakSeconds" min="0" placeholder="—" />
                </div>
              </div>
            }
          </div>
        }

        <div class="form-actions">
          <button class="btn-primary save-btn" (click)="startSession()">▶ Start Session</button>
          <button class="btn-secondary" (click)="view.set('list')">Cancel</button>
        </div>
      }

    </div>
  `,
  styles: [`
    .templates-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .page-header { display: flex; align-items: center; justify-content: space-between; }
    .page-title { font-size: 20px; font-weight: 700; margin: 0; }
    .loading-card, .empty-state { padding: 36px 24px; text-align: center; }
    .empty-icon { font-size: 40px; margin-bottom: 10px; }
    .empty-state p { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: var(--text); }
    .text-muted { font-size: 13px; color: var(--text-muted) !important; font-weight: 400 !important; }
    /* Template card */
    .template-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
    .template-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .template-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .template-name { font-size: 17px; font-weight: 700; color: var(--text); }
    .template-gym { font-size: 12px; color: var(--text-muted); }
    .template-meta { font-size: 12px; color: var(--text-muted); }
    .template-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .exercise-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .exercise-pill { background: var(--surface-2); border-radius: 10px; padding: 4px 10px; font-size: 12px; color: var(--text); display: flex; align-items: center; gap: 6px; }
    .pill-sets { color: var(--primary); font-weight: 700; }
    /* Form */
    .form-card { padding: 16px; }
    .field-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .field-group:last-child { margin-bottom: 0; }
    .field-label { font-size: 13px; font-weight: 600; color: var(--text-muted); }
    .required { color: var(--danger); }
    .form-input { padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 15px; width: 100%; box-sizing: border-box; }
    .form-input:focus { outline: none; border-color: var(--primary); }
    /* Entry cards */
    .entry-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
    .entry-header { display: flex; align-items: center; justify-content: space-between; }
    .entry-info { display: flex; flex-direction: column; gap: 2px; }
    .entry-name { font-size: 15px; font-weight: 700; color: var(--text); }
    .entry-set-count { font-size: 12px; color: var(--text-muted); }
    .set-row { display: flex; align-items: flex-end; gap: 6px; padding: 6px 0; border-bottom: 1px solid var(--border); }
    .set-num { font-size: 12px; font-weight: 700; color: var(--text-muted); min-width: 18px; text-align: center; padding-bottom: 8px; }
    .set-field { display: flex; flex-direction: column; gap: 3px; flex: 1; }
    .set-label { font-size: 10px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
    .set-input { padding: 8px 4px; border: 1.5px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 14px; width: 100%; box-sizing: border-box; text-align: center; -webkit-appearance: none; }
    .set-input:focus { outline: none; border-color: var(--primary); }
    .remove-set-btn { background: none; border: none; padding: 6px; color: var(--text-muted); cursor: pointer; border-radius: 6px; display: flex; align-items: center; flex-shrink: 0; }
    .remove-set-btn:hover { color: var(--danger); }
    .add-set-btn { margin-top: 4px; align-self: flex-start; }
    /* Add exercise */
    .add-exercise { padding: 14px; }
    .add-exercise-row { display: flex; gap: 10px; align-items: center; }
    .hint-text { font-size: 13px; color: var(--text-muted); margin: 8px 0 0; }
    /* Form actions */
    .form-actions { display: flex; gap: 10px; }
    .save-btn { flex: 1; justify-content: center; font-size: 15px; padding: 14px; }
    /* Apply view */
    .apply-hint { padding: 12px 16px; font-size: 14px; color: var(--text-muted); margin: 0; }
    .apply-header-card { padding: 14px 16px; }
    /* Icon buttons */
    .icon-btn { background: none; border: none; padding: 7px; border-radius: 8px; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; justify-content: center; transition: background .15s, color .15s; -webkit-tap-highlight-color: transparent; }
    .icon-btn:hover { background: var(--surface-2); }
    .icon-btn.edit:hover { color: var(--primary); }
    .icon-btn.delete:hover { color: var(--danger); }
    .btn-sm { font-size: 13px; padding: 8px 14px; }
    .btn-xs { font-size: 12px; padding: 5px 10px; min-height: 28px; }
    .btn-ghost { background: var(--surface-2); color: var(--text); border: 1.5px solid var(--border); border-radius: 10px; cursor: pointer; font-weight: 600; -webkit-tap-highlight-color: transparent; }
  `],
})
export class SessionTemplatesComponent implements OnInit {
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly workoutState = inject(WorkoutStateService);
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotificationService);
  private readonly log = inject(LoggingService);
  private readonly router = inject(Router);

  goHub(): void { this.router.navigate(['/workout/hub']); }

  readonly templates = this.workoutState.templates;
  readonly workouts = this.workoutState.workouts;
  readonly templatesLoaded = this.workoutState.templatesLoaded;
  readonly view = signal<PageView>('list');
  readonly saving = signal(false);

  // Form state (create/edit)
  formName = '';
  formGym = '';
  formEntries: EditableEntry[] = [];
  formSelectedWorkoutId = '';
  private editingId: string | null = null;

  // Apply state
  applyName = '';
  applyGym = '';
  applyEntries: EditableEntry[] = [];

  ngOnInit(): void {
    if (!this.workoutState.templatesLoaded()) {
      this.workoutGithub.loadTemplates().catch(e =>
        this.log.dbg('Failed to load templates: ' + String(e), 'error')
      );
    }
    if (!this.workoutState.workoutsLoaded()) {
      this.workoutGithub.loadWorkouts().catch(e =>
        this.log.dbg('Failed to load workouts: ' + String(e), 'error')
      );
    }
  }

  workoutName(id: string): string {
    return this.workouts().find(w => w.id === id)?.name ?? id;
  }

  // ── Create/Edit ─────────────────────────────────────────────────────────

  startCreate(): void {
    this.editingId = null;
    this.formName = '';
    this.formGym = '';
    this.formEntries = [];
    this.formSelectedWorkoutId = '';
    this.view.set('create');
  }

  startEdit(tmpl: SessionTemplate): void {
    this.editingId = tmpl.id;
    this.formName = tmpl.name;
    this.formGym = tmpl.gymName ?? '';
    this.formEntries = tmpl.entries.map(e => ({
      workoutId: e.workoutId,
      sets: e.sets.map(s => ({
        setNumber: s.setNumber,
        reps: s.reps,
        weightKg: s.weightKg,
        breakSeconds: s.breakSeconds ?? null,
      })),
    }));
    this.formSelectedWorkoutId = '';
    this.view.set('edit');
  }

  addFormEntry(): void {
    if (!this.formSelectedWorkoutId) return;
    this.formEntries.push({
      workoutId: this.formSelectedWorkoutId,
      sets: [{ setNumber: 1, reps: 8, weightKg: 0, breakSeconds: null }],
    });
    this.formSelectedWorkoutId = '';
  }

  removeFormEntry(index: number): void {
    this.formEntries.splice(index, 1);
  }

  addFormSet(entryIndex: number): void {
    const entry = this.formEntries[entryIndex];
    const n = entry.sets.length + 1;
    const last = entry.sets[entry.sets.length - 1];
    entry.sets.push({
      setNumber: n,
      reps: last?.reps ?? 8,
      weightKg: last?.weightKg ?? 0,
      breakSeconds: last?.breakSeconds ?? null,
    });
  }

  removeFormSet(entryIndex: number, setIndex: number): void {
    const entry = this.formEntries[entryIndex];
    entry.sets.splice(setIndex, 1);
    entry.sets.forEach((s, i) => (s.setNumber = i + 1));
  }

  async saveForm(): Promise<void> {
    if (!this.formName.trim()) {
      this.notify.showNotification('Template name is required', 'error');
      return;
    }
    this.saving.set(true);
    try {
      const all = this.templates().slice();
      const templateData: SessionTemplate = {
        id: this.editingId ?? generateUUID(),
        name: this.formName.trim(),
        gymName: this.formGym.trim() || undefined,
        entries: this.formEntries.map(e => ({
          workoutId: e.workoutId,
          sets: e.sets.map(s => ({
            setNumber: s.setNumber,
            reps: s.reps ?? 0,
            weightKg: s.weightKg ?? 0,
            breakSeconds: s.breakSeconds ?? undefined,
          })),
        })),
        createdAt: this.editingId
          ? (all.find(t => t.id === this.editingId)?.createdAt ?? new Date().toISOString())
          : new Date().toISOString(),
      };
      if (this.editingId) {
        const idx = all.findIndex(t => t.id === this.editingId);
        if (idx !== -1) all[idx] = templateData; else all.push(templateData);
      } else {
        all.push(templateData);
      }
      const ok = await this.workoutGithub.saveTemplates(all);
      if (ok) {
        this.notify.showNotification(
          this.editingId ? 'Template updated' : 'Template created',
          'success'
        );
        this.view.set('list');
      }
    } finally {
      this.saving.set(false);
    }
  }

  async deleteTemplate(tmpl: SessionTemplate): Promise<void> {
    const proceed = await this.confirm.show(`Delete "${tmpl.name}"?`, 'Delete Template');
    if (!proceed) return;
    const remaining = this.templates().filter(t => t.id !== tmpl.id);
    const ok = await this.workoutGithub.saveTemplates(remaining);
    if (ok) {
      this.notify.showNotification(`Deleted "${tmpl.name}"`, 'delete');
      this.confirm.close();
    } else {
      this.confirm.close();
    }
  }

  // ── Apply template ───────────────────────────────────────────────────────

  applyTemplate(tmpl: SessionTemplate): void {
    this.applyName = tmpl.name;
    this.applyGym = tmpl.gymName ?? '';
    this.applyEntries = tmpl.entries.map(e => ({
      workoutId: e.workoutId,
      sets: e.sets.map(s => ({
        setNumber: s.setNumber,
        reps: s.reps,
        weightKg: s.weightKg,
        breakSeconds: s.breakSeconds ?? null,
      })),
    }));
    this.view.set('apply');
  }

  startSession(): void {
    const session: Session = {
      id: generateUUID(),
      date: getTodayString(),
      gymName: this.applyGym.trim() || undefined,
      entries: this.applyEntries.map(e => ({
        id: generateUUID(),
        workoutId: e.workoutId,
        sets: e.sets.map(s => ({
          setNumber: s.setNumber,
          reps: s.reps ?? 0,
          weightKg: s.weightKg ?? 0,
          breakSeconds: s.breakSeconds ?? undefined,
        })),
      })),
    };
    this.workoutState.templateSession.set(session);
    this.router.navigate(['/workout/log']);
  }
}
