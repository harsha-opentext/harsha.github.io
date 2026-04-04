import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { ConfirmService } from '../../../shared/components/confirm-modal/confirm.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LoggingService } from '../../../core/services/logging.service';
import { Workout, MuscleGroup, MUSCLE_GROUPS, WorkoutType, getWorkoutMuscleGroups } from '../../../core/models/workout.model';
import { generateUUID } from '../../../shared/utils/uuid.utils';

type FormMode = 'create' | 'edit';
type ImportStep = 'input' | 'preview';

interface WorkoutForm {
  name: string;
  type: WorkoutType;
  muscleGroups: MuscleGroup[];
  description: string;
  cues: string;
}

interface PreviewWorkout {
  name: string;
  type: WorkoutType;
  muscleGroupsText: string;
  description: string;
  cues: string;
  isDuplicate: boolean;
}

const EXAMPLE_CSV = `name,type,muscleGroups,description,cues
Bench Press,resistance,chest,Flat barbell bench press,Keep shoulder blades retracted
Squat,resistance,"legs,core",Barbell back squat,Break parallel — chest up
Treadmill Run,cardio,legs,30 min steady-state,Maintain 65–75% max HR
Overhead Press,resistance,shoulders,,Press vertically — elbows slightly forward
Deadlift,resistance,"back,legs",Conventional deadlift,"Hinge at hips, bar over mid-foot"`;

@Component({
  selector: 'app-workouts',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="workouts-page">

      <!-- Normal header -->
      @if (!selectMode()) {
        <div class="page-header">
          <div class="header-left">
            <button class="hub-back-btn" (click)="goHub()">← Hub</button>
            <h2 class="page-title">Workouts</h2>
          </div>
          <div class="header-actions">
            <button class="btn-ghost btn-sm" (click)="openImport()">📥 Import</button>
            <button class="btn-ghost btn-sm" (click)="startSelectMode()">Select</button>
            <button class="btn-primary btn-sm" (click)="openCreate()">+ New</button>
          </div>
        </div>
      }

      <!-- Select mode header -->
      @if (selectMode()) {
        <div class="page-header">
          <div class="select-summary">
            <button class="btn-ghost btn-sm" (click)="cancelSelectMode()">✕ Cancel</button>
            <span class="select-count">{{ selectedIds().size }} selected</span>
          </div>
          <div class="header-actions">
            <button class="btn-ghost btn-sm" [disabled]="selectedIds().size === 0" (click)="exportSelected()">📤 Export</button>
            <button class="btn-ghost-danger btn-sm" [disabled]="selectedIds().size === 0" (click)="bulkDelete()">Delete</button>
          </div>
        </div>
      }

      <!-- Create / Edit form -->
      @if (formOpen()) {
        <div class="form-panel card">
          <h3>{{ formMode() === 'create' ? 'New Workout' : 'Edit Workout' }}</h3>
          <div class="field-group">
            <label class="field-label">Name <span class="required">*</span></label>
            <input type="text" class="form-input" [(ngModel)]="form.name" placeholder="e.g. Bench Press" maxlength="80" />
          </div>
          <div class="field-group">
            <label class="field-label">Type</label>
            <div class="type-toggle">
              <button class="type-btn" [class.active]="form.type === 'resistance'" (click)="form.type = 'resistance'">🏋️ Resistance</button>
              <button class="type-btn" [class.active]="form.type === 'cardio'" (click)="form.type = 'cardio'">🏃 Cardio</button>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">Muscle Groups</label>
            <div class="muscle-checkboxes">
              @for (mg of muscleGroups; track mg) {
                <label class="muscle-check-label" [class.checked]="form.muscleGroups.includes(mg)">
                  <input type="checkbox" [checked]="form.muscleGroups.includes(mg)" (change)="toggleMuscleGroup(mg)" />
                  {{ mg | titlecase }}
                </label>
              }
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">Description</label>
            <textarea class="form-input form-textarea" [(ngModel)]="form.description" placeholder="What is this exercise?" rows="2"></textarea>
          </div>
          <div class="field-group">
            <label class="field-label">Cues</label>
            <textarea class="form-input form-textarea" [(ngModel)]="form.cues" placeholder="Form tips, reminders, key points…" rows="2"></textarea>
          </div>
          <div class="btn-row">
            <button class="btn-primary" [class.loading]="saving()" (click)="saveForm()">
              {{ formMode() === 'create' ? 'Create' : 'Save Changes' }}
            </button>
            <button class="btn-secondary" (click)="closeForm()">Cancel</button>
          </div>
        </div>
      }

      <!-- CSV Import modal (2-step) -->
      @if (importOpen()) {
        <div class="modal-overlay" (click)="onImportOverlayClick($event)">
          <div class="modal-box" role="dialog">
            <div class="modal-header">
              @if (importStep() === 'input') {
                <h2>📥 Import Workouts from CSV</h2>
              } @else {
                <h2>Preview — {{ previewRows().length }} workout{{ previewRows().length !== 1 ? 's' : '' }}</h2>
              }
              <button class="close-btn" (click)="closeImport()">✕</button>
            </div>

            <!-- Step 1: input -->
            @if (importStep() === 'input') {
              <div class="modal-body">
                <p class="hint">Required: <code>name</code>. Optional: <code>muscleGroups</code>, <code>description</code>, <code>cues</code>.</p>
                <p class="hint">Quote <code>muscleGroups</code> if multiple: <code>"legs,core"</code>. Duplicate names will be flagged in preview.</p>
                <div class="example-row">
                  <span class="hint-label">Format example:</span>
                  <button class="tag-btn" (click)="copyExample()">{{ copiedExample() ? '✓ Copied' : 'Copy' }}</button>
                </div>
                <pre class="example-pre">{{ exampleCsv }}</pre>
                <textarea class="csv-textarea" [(ngModel)]="importRawText" placeholder="Paste your CSV here…" rows="8"></textarea>
                @if (importError()) {
                  <p class="error-msg">{{ importError() }}</p>
                }
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" (click)="closeImport()">Cancel</button>
                <button class="btn-primary" (click)="parseToPreview()">Preview →</button>
              </div>
            }

            <!-- Step 2: preview -->
            @if (importStep() === 'preview') {
              <div class="modal-body preview-body">
                <p class="count-line">
                  Review and edit before importing. <span class="hint-inline">Duplicate names are flagged and will be skipped.</span>
                </p>
                <div class="preview-list">
                  @for (row of previewRows(); track $index) {
                    <div class="preview-card" [class.is-dup]="row.isDuplicate">
                      <div class="preview-main">
                        @if (row.isDuplicate) {
                          <span class="dup-badge">duplicate</span>
                        }
                        <input class="pi-input pi-name" [(ngModel)]="row.name" placeholder="Name" />
                        <button class="remove-btn" title="Remove" (click)="removePreviewRow($index)">✕</button>
                      </div>
                      <div class="preview-sub">
                        <input class="pi-input pi-mg" [(ngModel)]="row.muscleGroupsText" placeholder="muscle groups" />
                        <input class="pi-input" [(ngModel)]="row.description" placeholder="description" />
                        <input class="pi-input" [(ngModel)]="row.cues" placeholder="cues" />
                      </div>
                    </div>
                  }
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn-secondary" (click)="backToInput()">← Back</button>
                <button class="btn-primary" [class.loading]="importing()" [disabled]="nonDupCount() === 0" (click)="confirmImport()">
                  Import {{ nonDupCount() }} workout{{ nonDupCount() !== 1 ? 's' : '' }}
                </button>
              </div>
            }

          </div>
        </div>
      }

      <!-- Workout list -->
      @if (workouts().length === 0) {
        <div class="empty-state card">
          <div class="empty-icon">🏋️</div>
          <p>No workouts yet.</p>
          <p class="text-muted">Create a workout or import from CSV to start logging.</p>
        </div>
      }

      @for (workout of workouts(); track workout.id) {
        <div
          class="workout-card card"
          [class.detail-open]="!selectMode() && detailId() === workout.id"
          [class.is-selected]="selectMode() && isSelected(workout.id)"
          (click)="selectMode() ? toggleSelect(workout.id) : toggleDetail(workout.id)"
        >
          <div class="workout-card-header">
            <!-- Select checkbox -->
            @if (selectMode()) {
              <div class="check-circle" [class.checked]="isSelected(workout.id)">
                @if (isSelected(workout.id)) {
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                }
              </div>
            }
            <div class="workout-left">
              <div class="workout-name">{{ workout.name }}</div>
              <div class="workout-tags">
                @if (workout.type === 'cardio') {
                  <span class="type-tag cardio-tag">🏃 Cardio</span>
                }
                @for (mg of getMuscleGroups(workout); track mg) {
                  <span class="muscle-tag">{{ mg | titlecase }}</span>
                }
              </div>
            </div>
            @if (!selectMode()) {
              <div class="workout-right" (click)="$event.stopPropagation()">
                <button class="icon-btn edit" (click)="openEdit(workout)" title="Edit">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button class="icon-btn delete" (click)="deleteWorkout(workout)" title="Delete">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </button>
                <span class="chevron">{{ detailId() === workout.id ? '▲' : '▼' }}</span>
              </div>
            }
          </div>

          <!-- Detail expand -->
          @if (!selectMode() && detailId() === workout.id) {
            <div class="workout-detail">
              @if (workout.description) {
                <div class="detail-section">
                  <span class="detail-label">Description</span>
                  <p class="detail-text">{{ workout.description }}</p>
                </div>
              }
              @if (workout.cues) {
                <div class="detail-section">
                  <span class="detail-label">Cues</span>
                  <p class="detail-text detail-cues">{{ workout.cues }}</p>
                </div>
              }
              @if (!workout.description && !workout.cues) {
                <p class="detail-empty">No description or cues added.</p>
              }
            </div>
          }
        </div>
      }

    </div>
  `,
  styles: [`
    .workouts-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }

    /* ── Header ── */
    .page-header { display: flex; align-items: center; justify-content: space-between; }
    .page-title { font-size: 20px; font-weight: 700; margin: 0; }
    .header-actions { display: flex; gap: 6px; align-items: center; }
    .select-summary { display: flex; align-items: center; gap: 10px; }
    .select-count { font-size: 14px; font-weight: 600; color: var(--text-muted); }

    /* ── Button variants ── */
    .btn-sm { font-size: 13px; padding: 8px 14px; border-radius: 10px; border: none; cursor: pointer; font-weight: 600; -webkit-tap-highlight-color: transparent; }
    .btn-xs { font-size: 12px; padding: 5px 10px; min-height: 30px; }
    .btn-ghost { background: var(--surface-2); color: var(--text); border: 1.5px solid var(--border); border-radius: 10px; }
    .btn-ghost:hover { background: var(--surface-3); }
    .btn-ghost-danger { background: transparent; color: var(--danger); border: 1.5px solid var(--danger); border-radius: 10px; opacity: 0.85; }
    .btn-ghost-danger:hover { background: var(--danger); color: #fff; opacity: 1; }
    .btn-ghost-danger:disabled, .btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }

    /* ── Form ── */
    .form-panel { padding: 18px; }
    .form-panel h3 { font-size: 16px; font-weight: 700; margin: 0 0 14px; }
    .field-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .field-label { font-size: 13px; font-weight: 600; color: var(--text-muted); }
    .required { color: var(--danger); }
    .form-input { padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 15px; width: 100%; box-sizing: border-box; }
    .form-input:focus { outline: none; border-color: var(--primary); }
    .form-textarea { resize: vertical; font-family: inherit; }
    .muscle-checkboxes { display: flex; flex-wrap: wrap; gap: 8px; }
    .muscle-check-label { display: flex; align-items: center; gap: 5px; padding: 6px 12px; border: 1.5px solid var(--border); border-radius: 20px; font-size: 13px; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background .15s, border-color .15s; background: var(--surface-2); color: var(--text); }
    .muscle-check-label.checked { background: var(--primary-light); border-color: var(--primary); color: var(--primary); font-weight: 600; }
    .muscle-check-label input { display: none; }
    .btn-row { display: flex; gap: 10px; margin-top: 4px; }
    .type-toggle { display: flex; gap: 8px; }
    .type-btn { flex: 1; padding: 9px 0; border: 1.5px solid var(--border); border-radius: 10px; background: var(--surface-2); color: var(--text); font-size: 14px; font-weight: 600; cursor: pointer; transition: all .15s; }
    .type-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; }
    .type-tag { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
    .cardio-tag { background: #fce7f3; color: #be185d; text-transform: uppercase; letter-spacing: 0.3px; }

    /* ── Workout cards ── */
    .empty-state { padding: 36px 24px; text-align: center; }
    .empty-icon { font-size: 40px; margin-bottom: 10px; }
    .empty-state p { margin: 0 0 6px; color: var(--text); font-size: 16px; font-weight: 600; }
    .text-muted { font-size: 13px; color: var(--text-muted) !important; font-weight: 400 !important; }

    .workout-card { padding: 0; overflow: hidden; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .workout-card.detail-open { border-color: var(--primary); }
    .workout-card.is-selected { border-color: var(--primary); background: var(--primary-light); }
    .workout-card-header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; }

    /* checkbox circle */
    .check-circle { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border); background: var(--bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all .15s; color: #fff; }
    .check-circle.checked { background: var(--primary); border-color: var(--primary); }

    .workout-left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .workout-name { font-size: 17px; font-weight: 700; color: var(--text); }
    .workout-tags { display: flex; flex-wrap: wrap; gap: 5px; }
    .muscle-tag { background: var(--primary-light); color: var(--primary); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.3px; }

    .workout-right { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .chevron { font-size: 12px; color: var(--text-muted); margin-left: 4px; }

    /* SVG icon buttons */
    .icon-btn { background: none; border: none; padding: 7px; border-radius: 8px; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; justify-content: center; transition: background .15s, color .15s; -webkit-tap-highlight-color: transparent; }
    .icon-btn:hover { background: var(--surface-2); }
    .icon-btn.edit:hover { color: var(--primary); }
    .icon-btn.delete:hover { color: var(--danger); }

    /* Detail expand */
    .workout-detail { padding: 4px 16px 14px; border-top: 1px solid var(--border); background: var(--surface-2); cursor: default; display: flex; flex-direction: column; gap: 10px; }
    .detail-section { display: flex; flex-direction: column; gap: 3px; padding-top: 2px; }
    .detail-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted); }
    .detail-text { font-size: 14px; color: var(--text); line-height: 1.5; margin: 0; }
    .detail-cues { color: var(--text); font-style: italic; }
    .detail-empty { font-size: 13px; color: var(--text-muted); margin: 2px 0 0; font-style: italic; }

    /* ── CSV Import modal ── */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: flex-end; justify-content: center; z-index: 200; }
    .modal-box { background: var(--card-bg); border-radius: 20px 20px 0 0; width: 100%; max-width: 720px; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .modal-header h2 { font-size: 17px; font-weight: 700; margin: 0; }
    .close-btn { background: none; border: none; font-size: 20px; color: var(--text-muted); cursor: pointer; padding: 4px 8px; }
    .modal-body { flex: 1; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; }
    .preview-body { padding: 10px 14px; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px 16px; border-top: 1px solid var(--border); flex-shrink: 0; }

    .hint { font-size: 13px; color: var(--text-muted); margin: 0; line-height: 1.4; }
    code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
    .example-row { display: flex; align-items: center; gap: 8px; }
    .hint-label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .tag-btn { background: var(--surface-3); border: none; border-radius: 8px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: var(--text); }
    .example-pre { background: var(--surface-2); border-radius: 8px; padding: 10px 12px; font-size: 11px; color: var(--text-muted); overflow-x: auto; margin: 0; white-space: pre; font-family: monospace; }
    .csv-textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 14px; font-family: monospace; resize: vertical; }
    .error-msg { color: var(--danger); font-size: 13px; margin: 0; }

    /* Preview step */
    .count-line { font-size: 14px; color: var(--text); margin: 0 0 6px; font-weight: 500; }
    .hint-inline { font-size: 12px; color: var(--text-muted); font-weight: 400; }
    .preview-list { display: flex; flex-direction: column; gap: 10px; }
    .preview-card { background: var(--surface-2); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; border: 1.5px solid transparent; }
    .preview-card.is-dup { border-color: #f59e0b; background: #fef3c755; }
    .preview-main { display: flex; gap: 6px; align-items: center; }
    .preview-sub { display: flex; flex-wrap: wrap; gap: 6px; }
    .pi-input { padding: 7px 9px; background: var(--card-bg); color: var(--text); border: 1.5px solid var(--border); border-radius: 8px; font-size: 13px; box-sizing: border-box; min-width: 0; }
    .pi-name { flex: 1; min-width: 120px; }
    .pi-mg { min-width: 130px; }
    .remove-btn { background: none; border: none; font-size: 16px; color: var(--text-muted); cursor: pointer; padding: 4px 6px; flex-shrink: 0; border-radius: 6px; }
    .remove-btn:hover { background: var(--surface-3); color: var(--danger); }
    .dup-badge { background: #f59e0b; color: #fff; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 8px; text-transform: uppercase; white-space: nowrap; }
  `],
})
export class WorkoutsComponent implements OnInit {
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly workoutState = inject(WorkoutStateService);
  private readonly router = inject(Router);

  goHub(): void { this.router.navigate(['/workout/hub']); }
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotificationService);
  private readonly log = inject(LoggingService);

  readonly workouts = this.workoutState.workouts;
  readonly formOpen = signal(false);
  readonly formMode = signal<FormMode>('create');
  readonly saving = signal(false);
  readonly detailId = signal<string | null>(null);
  readonly muscleGroups = MUSCLE_GROUPS;
  readonly getMuscleGroups = getWorkoutMuscleGroups;

  // Multi-select
  readonly selectMode = signal(false);
  readonly selectedIds = signal(new Set<string>());

  // CSV import
  readonly importOpen = signal(false);
  readonly importing = signal(false);
  readonly importError = signal('');
  readonly importStep = signal<ImportStep>('input');
  readonly previewRows = signal<PreviewWorkout[]>([]);
  readonly copiedExample = signal(false);
  importRawText = '';
  readonly exampleCsv = EXAMPLE_CSV;

  readonly nonDupCount = () => this.previewRows().filter(r => !r.isDuplicate && r.name.trim()).length;

  form: WorkoutForm = { name: '', type: 'resistance', muscleGroups: [], description: '', cues: '' };
  private editingId: string | null = null;

  ngOnInit(): void {
    if (!this.workoutState.workoutsLoaded()) {
      this.workoutGithub.loadWorkouts().catch(err =>
        this.log.dbg('Failed to load workouts: ' + String(err), 'error')
      );
    }
  }

  // ── Detail expand ──────────────────────────────────────────────────────

  toggleDetail(id: string): void {
    this.detailId.update(cur => (cur === id ? null : id));
  }

  // ── Create / Edit form ─────────────────────────────────────────────────

  openCreate(): void {
    this.editingId = null;
    this.form = { name: '', type: 'resistance', muscleGroups: [], description: '', cues: '' };
    this.formMode.set('create');
    this.formOpen.set(true);
    this.detailId.set(null);
  }

  openEdit(w: Workout): void {
    this.editingId = w.id;
    this.form = {
      name: w.name,
      type: w.type ?? 'resistance',
      muscleGroups: getWorkoutMuscleGroups(w).slice(),
      description: w.description ?? '',
      cues: w.cues ?? '',
    };
    this.formMode.set('edit');
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editingId = null;
  }

  toggleMuscleGroup(mg: MuscleGroup): void {
    const idx = this.form.muscleGroups.indexOf(mg);
    if (idx === -1) {
      this.form.muscleGroups = [...this.form.muscleGroups, mg];
    } else {
      this.form.muscleGroups = this.form.muscleGroups.filter(x => x !== mg);
    }
  }

  async saveForm(): Promise<void> {
    const name = this.form.name.trim();
    if (!name) {
      this.notify.showNotification('Workout name is required', 'error');
      return;
    }
    this.saving.set(true);
    try {
      const all = this.workouts().slice();
      if (this.formMode() === 'create') {
        all.push({
          id: generateUUID(),
          name,
          type: this.form.type,
          muscleGroups: this.form.muscleGroups.length > 0 ? this.form.muscleGroups : undefined,
          description: this.form.description.trim() || undefined,
          cues: this.form.cues.trim() || undefined,
          createdAt: new Date().toISOString(),
        });
      } else if (this.editingId) {
        const idx = all.findIndex(w => w.id === this.editingId);
        if (idx !== -1) {
          all[idx] = {
            ...all[idx],
            name,
            type: this.form.type,
            muscleGroups: this.form.muscleGroups.length > 0 ? this.form.muscleGroups : undefined,
            muscleGroup: undefined,
            description: this.form.description.trim() || undefined,
            cues: this.form.cues.trim() || undefined,
          };
        }
      }
      const ok = await this.workoutGithub.saveWorkouts(all);
      if (ok) {
        this.closeForm();
        this.notify.showNotification(
          this.formMode() === 'create' ? 'Workout created' : 'Workout updated',
          'success'
        );
      }
    } finally {
      this.saving.set(false);
    }
  }

  async deleteWorkout(w: Workout): Promise<void> {
    const proceed = await this.confirm.show(`Delete "${w.name}"?`, 'Delete Workout');
    if (!proceed) return;
    const remaining = this.workouts().filter(x => x.id !== w.id);
    const ok = await this.workoutGithub.saveWorkouts(remaining);
    if (ok) {
      this.notify.showNotification(`Deleted "${w.name}"`, 'delete');
      this.confirm.close();
    } else {
      this.confirm.close();
    }
  }

  // ── Multi-select ───────────────────────────────────────────────────────

  startSelectMode(): void {
    this.selectMode.set(true);
    this.selectedIds.set(new Set());
    this.detailId.set(null);
    this.formOpen.set(false);
  }

  cancelSelectMode(): void {
    this.selectMode.set(false);
    this.selectedIds.set(new Set());
  }

  toggleSelect(id: string): void {
    this.selectedIds.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  async bulkDelete(): Promise<void> {
    const ids = this.selectedIds();
    if (ids.size === 0) return;
    const count = ids.size;
    const proceed = await this.confirm.show(
      `Delete ${count} workout${count > 1 ? 's' : ''}?`,
      'Delete Workouts'
    );
    if (!proceed) return;
    const remaining = this.workouts().filter(w => !ids.has(w.id));
    const ok = await this.workoutGithub.saveWorkouts(remaining);
    if (ok) {
      this.notify.showNotification(`Deleted ${count} workout${count > 1 ? 's' : ''}`, 'delete');
      this.cancelSelectMode();
      this.confirm.close();
    } else {
      this.confirm.close();
    }
  }

  exportSelected(): void {
    const ids = this.selectedIds();
    const toExport = ids.size > 0
      ? this.workouts().filter(w => ids.has(w.id))
      : this.workouts();
    this.downloadCsv(toExport);
    this.cancelSelectMode();
  }

  private downloadCsv(list: Workout[]): void {
    const header = 'name,type,muscleGroups,description,cues';
    const rows = list.map(w => {
      const mgs = getWorkoutMuscleGroups(w).join(',');
      const mgField = mgs.includes(',') ? `"${mgs}"` : mgs;
      return [
        this.escapeCsvField(w.name),
        w.type ?? 'resistance',
        mgField,
        w.description ? this.escapeCsvField(w.description) : '',
        w.cues ? this.escapeCsvField(w.cues) : '',
      ].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workouts.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  private escapeCsvField(v: string): string {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  }

  // ── CSV Import ─────────────────────────────────────────────────────────

  openImport(): void {
    this.importRawText = '';
    this.importError.set('');
    this.importStep.set('input');
    this.previewRows.set([]);
    this.importOpen.set(true);
  }

  closeImport(): void {
    this.importOpen.set(false);
  }

  onImportOverlayClick(e: Event): void {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) this.closeImport();
  }

  async copyExample(): Promise<void> {
    try {
      await navigator.clipboard.writeText(EXAMPLE_CSV);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = EXAMPLE_CSV;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    this.copiedExample.set(true);
    setTimeout(() => this.copiedExample.set(false), 2000);
  }

  parseToPreview(): void {
    this.importError.set('');
    const lines = this.importRawText.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      this.importError.set('Need at least a header row and one data row.');
      return;
    }
    const header = this.parseCsvRow(lines[0]).map(h => h.trim().toLowerCase());
    const nameIdx = header.indexOf('name');
    if (nameIdx === -1) {
      this.importError.set('CSV must have a "name" column.');
      return;
    }
    const typeIdx = header.indexOf('type');
    const mgIdx = header.indexOf('musclegroups');
    const descIdx = header.indexOf('description');
    const cuesIdx = header.indexOf('cues');
    const existingNames = new Set(this.workouts().map(w => w.name.toLowerCase()));

    const rows: PreviewWorkout[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCsvRow(lines[i]);
      const name = (cols[nameIdx] ?? '').trim();
      if (!name) continue;
      const rawType = typeIdx !== -1 ? (cols[typeIdx] ?? '').trim().toLowerCase() : '';
      rows.push({
        name,
        type: rawType === 'cardio' ? 'cardio' : 'resistance',
        muscleGroupsText: mgIdx !== -1 ? (cols[mgIdx] ?? '').trim() : '',
        description: descIdx !== -1 ? (cols[descIdx] ?? '').trim() : '',
        cues: cuesIdx !== -1 ? (cols[cuesIdx] ?? '').trim() : '',
        isDuplicate: existingNames.has(name.toLowerCase()),
      });
    }

    if (rows.length === 0) {
      this.importError.set('No valid rows found.');
      return;
    }
    this.previewRows.set(rows);
    this.importStep.set('preview');
  }

  removePreviewRow(index: number): void {
    this.previewRows.update(rows => rows.filter((_, i) => i !== index));
  }

  backToInput(): void {
    this.importStep.set('input');
  }

  async confirmImport(): Promise<void> {
    const rows = this.previewRows().filter(r => !r.isDuplicate && r.name.trim());
    if (rows.length === 0) {
      this.importError.set('No workouts to import after filtering duplicates.');
      this.importStep.set('input');
      return;
    }
    this.importing.set(true);
    try {
      const newWorkouts: Workout[] = rows.map(r => ({
        id: generateUUID(),
        name: r.name.trim(),
        type: r.type,
        muscleGroups: this.parseMuscleGroupsText(r.muscleGroupsText) || undefined,
        description: r.description.trim() || undefined,
        cues: r.cues.trim() || undefined,
        createdAt: new Date().toISOString(),
      }));
      const ok = await this.workoutGithub.saveWorkouts([...this.workouts(), ...newWorkouts]);
      if (ok) {
        this.notify.showNotification(
          `Imported ${newWorkouts.length} workout${newWorkouts.length > 1 ? 's' : ''}`,
          'success'
        );
        this.closeImport();
      }
    } finally {
      this.importing.set(false);
    }
  }

  private parseMuscleGroupsText(text: string): MuscleGroup[] {
    return text
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => (MUSCLE_GROUPS as string[]).includes(s)) as MuscleGroup[];
  }

  /** Parses a single CSV row respecting double-quoted fields. */
  private parseCsvRow(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }
}
