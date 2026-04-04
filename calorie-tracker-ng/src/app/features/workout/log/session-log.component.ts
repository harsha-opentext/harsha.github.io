import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { SessionLogService } from './session-log.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { WorkoutHistoryService } from '../history/workout-history.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LoggingService } from '../../../core/services/logging.service';
import { Session, SessionEntry, WorkoutSet, Mood } from '../../../core/models/session.model';
import { Workout, getWorkoutMuscleGroups } from '../../../core/models/workout.model';
import { getTodayString } from '../../../shared/utils/date.utils';
import { generateUUID } from '../../../shared/utils/uuid.utils';
import { calculateEntryVolume } from '../../../shared/utils/workout-volume.utils';
import { RestTimerService } from '../../../core/services/rest-timer.service';
import { RestTimerComponent } from '../../../shared/components/rest-timer/rest-timer.component';

interface QuickFill {
  reps: number | null;
  weightKg: number | null;
  count: number | null;
  breakSeconds: number | null;
}

interface LastSessionStats {
  date: string;
  maxWeight: number;
  totalSets: number;
  suggestedWeight: number;
}

@Component({
  selector: 'app-session-log',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RestTimerComponent],
  template: `
    <div class="log-page">
      <div class="page-header">
        <h2 class="page-title">Log Session</h2>
        @if (savedToday()) {
          <span class="saved-badge">✓ Saved</span>
        } @else {
          <a class="hub-back-btn" [routerLink]="['/workout/hub']">← Hub</a>
        }
      </div>

      <!-- Session header fields -->
      <div class="session-header card">
        <div class="field-group">
          <label class="field-label">Date</label>
          <input type="date" class="form-input" [(ngModel)]="session().date" (ngModelChange)="onDateChange($event)" />
        </div>
        <div class="field-group">
          <label class="field-label">Gym</label>
          <input type="text" class="form-input" [(ngModel)]="sessionGymName" placeholder="Optional" />
        </div>
        <div class="time-row">
          <div class="field-group">
            <label class="field-label">Start time</label>
            <input type="time" class="form-input" [(ngModel)]="sessionStartTime" />
          </div>
          <div class="field-group">
            <label class="field-label">End time</label>
            <input type="time" class="form-input" [(ngModel)]="sessionEndTime" />
          </div>
        </div>
        <!-- Star mood selector -->
        <div class="field-group">
          <label class="field-label">Mood — {{ sessionMood ? moodLabels[sessionMood] : 'tap to rate' }}</label>
          <div class="star-selector">
            @for (s of starValues; track s) {
              <button
                class="star-btn"
                [class.lit]="sessionMood !== undefined && s <= sessionMood"
                (click)="sessionMood = (sessionMood === s ? undefined : s)"
                [title]="moodLabels[s]"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
            }
          </div>
        </div>
        <!-- Session notes -->
        <div class="field-group">
          <label class="field-label">Notes</label>
          <textarea class="form-input notes-input" [(ngModel)]="sessionNotes" placeholder="Optional session notes…" rows="2"></textarea>
        </div>
      </div>

      <!-- Entries (exercises) -->
      @for (entry of entries(); track entry.id; let ei = $index) {
        <div class="entry-card card">
          <div class="entry-header">
            <div class="entry-meta">
              <span class="entry-name">{{ workoutName(entry.workoutId) }}</span>
              @if (isCardioEntry(entry.workoutId)) {
                <span class="entry-cardio-badge">🏃 cardio</span>
              } @else {
                <span class="entry-set-count">{{ entry.sets.length }} set{{ entry.sets.length !== 1 ? 's' : '' }}</span>
              }
            </div>
            <button class="remove-entry-btn" title="Remove exercise" (click)="removeEntry(ei)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <!-- Historical context + overload suggestion -->
          @let lastStats = lastSessionStats(entry.workoutId);
          @if (lastStats) {
            <div class="history-hint">
              <span class="history-label">Last ({{ lastStats.date }})</span>
              <span>{{ lastStats.totalSets }} sets · max {{ lastStats.maxWeight }}kg</span>
              <span class="overload-chip" title="Progressive overload suggestion">→ try {{ lastStats.suggestedWeight }}kg</span>
            </div>
          }

          <!-- Feel rating (per-exercise) -->
          <div class="feel-row">
            <span class="feel-label">Feel</span>
            @for (r of starValues; track r) {
              <button class="feel-btn" [class.lit]="entry.rating !== undefined && r <= entry.rating" (click)="setEntryRating(ei, r)">★</button>
            }
          </div>

          <!-- Set rows (resistance) -->
          @if (!isCardioEntry(entry.workoutId)) {
            @for (set of entry.sets; track set.setNumber; let si = $index) {
              <div class="set-row" [class.warmup-set]="set.isWarmup" [class.done-set]="isSetDone(entry.id, set.setNumber)">
                <button class="check-btn" [class.checked]="isSetDone(entry.id, set.setNumber)" (click)="toggleSetDone(entry.id, set.setNumber)" title="Mark done">
                  @if (isSetDone(entry.id, set.setNumber)) { ✓ } @else { {{ set.setNumber }} }
                </button>
                <div class="set-field">
                  <span class="set-label">Reps</span>
                  <input type="number" class="set-input" [(ngModel)]="set.reps" min="1" (ngModelChange)="markUnsaved()" />
                </div>
                <div class="set-field">
                  <span class="set-label">Weight (kg)</span>
                  <input type="number" class="set-input" [(ngModel)]="set.weightKg" min="0" step="0.5" (ngModelChange)="markUnsaved()" />
                </div>
                <div class="set-field">
                  <span class="set-label">Rest (sec)</span>
                  <input type="number" class="set-input" [(ngModel)]="set.breakSeconds" min="0" placeholder="—" (ngModelChange)="markUnsaved()" />
                </div>
                <button class="warmup-toggle-btn" [class.active]="set.isWarmup" (click)="toggleWarmup(ei, si)" title="{{ set.isWarmup ? 'Unmark warm-up' : 'Mark as warm-up' }}">W</button>
                <button class="remove-set-btn" title="Remove set" (click)="removeSet(ei, si)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            }

            <!-- Quick-add sets -->
            <div class="quick-fill-section">
              <span class="quick-fill-label">Quick add</span>
              <div class="quick-fill-row">
                <div class="qf-field">
                  <span class="set-label">Reps</span>
                  <input type="number" class="set-input qf" [(ngModel)]="quickFills[ei].reps" min="1" />
                </div>
                <div class="qf-field">
                  <span class="set-label">kg</span>
                  <input type="number" class="set-input qf" [(ngModel)]="quickFills[ei].weightKg" min="0" step="0.5" />
                </div>
                <div class="qf-field">
                  <span class="set-label">Sets</span>
                  <input type="number" class="set-input qf" [(ngModel)]="quickFills[ei].count" min="1" />
                </div>
                <div class="qf-field">
                  <span class="set-label">Rest(s)</span>
                  <input type="number" class="set-input qf" [(ngModel)]="quickFills[ei].breakSeconds" min="0" />
                </div>
                <button class="btn-secondary btn-xs add-sets-btn" (click)="quickAddSets(ei)">+ Add</button>
              </div>
            </div>
          }

          <!-- Cardio fields -->
          @if (isCardioEntry(entry.workoutId)) {
            <div class="cardio-fields">
              <div class="cardio-field">
                <span class="set-label">Duration (min)</span>
                <input type="number" class="set-input" [(ngModel)]="entry.durationMinutes" min="1" placeholder="—" (ngModelChange)="markUnsaved()" />
              </div>
              <div class="cardio-field">
                <span class="set-label">Distance (km)</span>
                <input type="number" class="set-input" [(ngModel)]="entry.distanceKm" min="0" step="0.1" placeholder="—" (ngModelChange)="markUnsaved()" />
              </div>
            </div>
          }
        </div>
      }

      <!-- Add exercise -->
      <div class="add-exercise-panel card">
        <!-- Search + muscle group filter -->
        <div class="exercise-search-row">
          <input type="text" class="form-input search-input" [(ngModel)]="exerciseSearch" placeholder="🔍 Search exercises…" />
        </div>
        @if (muscleGroups().length > 0) {
          <div class="group-filter-row">
            <button class="group-chip" [class.active]="exerciseFilterGroup === ''" (click)="exerciseFilterGroup = ''">All</button>
            @for (g of muscleGroups(); track g) {
              <button class="group-chip" [class.active]="exerciseFilterGroup === g" (click)="exerciseFilterGroup = g">{{ g }}</button>
            }
          </div>
        }
        <div class="add-exercise-row">
          <select class="form-input exercise-select" [(ngModel)]="selectedWorkoutId">
            <option value="">— Select Workout —</option>
            @for (w of filteredWorkouts(); track w.id) {
              <option [value]="w.id">{{ w.name }}{{ w.muscleGroups?.length ? ' (' + w.muscleGroups!.join(', ') + ')' : '' }}</option>
            }
          </select>
          <button class="btn-primary btn-sm" [disabled]="!selectedWorkoutId" (click)="addEntry()">+ Add</button>
        </div>
        @if (workouts().length === 0) {
          <p class="no-workouts-hint">No workouts yet — <a class="link" href="#/workout/workouts">create some first</a></p>
        }
      </div>

      <!-- Save button -->
      <div class="save-row">
        <button
          class="btn-primary save-btn"
          [class.loading]="logSvc.saving()"
          [disabled]="entries().length === 0"
          (click)="saveSession()"
        >
          {{ logSvc.saving() ? '⏳ Saving…' : '💾 Save Session' }}
        </button>
        <button class="btn-secondary btn-sm" (click)="clearSession()">🗑️ Clear</button>
      </div>

      <!-- Persistent rest timer strip -->
      <app-rest-timer></app-rest-timer>
    </div>
  `,
  styles: [`
    .log-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .page-header { display: flex; align-items: center; justify-content: space-between; }
    .page-title { font-size: 20px; font-weight: 700; margin: 0; }
    .saved-badge { font-size: 13px; font-weight: 700; color: var(--success); background: rgba(52,199,89,.12); padding: 4px 10px; border-radius: 20px; }
    .session-header { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .time-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .star-selector { display: flex; gap: 4px; }
    .star-btn { background: none; border: none; padding: 4px; cursor: pointer; color: var(--border); line-height: 1; -webkit-tap-highlight-color: transparent; transition: color .12s, transform .12s; }
    .star-btn.lit { color: #f59e0b; }
    .star-btn:active { transform: scale(0.9); }
    .field-group { display: flex; flex-direction: column; gap: 4px; }
    .field-label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .form-input { padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 15px; width: 100%; box-sizing: border-box; }
    .form-input:focus { outline: none; border-color: var(--primary); }
    .mood-selector { display: flex; gap: 8px; }
    .mood-btn { font-size: 24px; width: 44px; height: 44px; border-radius: 10px; border: 2px solid var(--border); background: var(--surface-2); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .15s; -webkit-tap-highlight-color: transparent; }
    .mood-btn.selected { border-color: var(--primary); background: var(--primary-light); transform: scale(1.1); }
    .mood-btn:active { transform: scale(0.95); }
    .entry-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
    .entry-header { display: flex; align-items: center; justify-content: space-between; }
    .entry-meta { display: flex; flex-direction: column; gap: 2px; }
    .entry-name { font-size: 16px; font-weight: 700; }
    .entry-set-count { font-size: 12px; color: var(--text-muted); }
    .remove-entry-btn { background: none; border: none; padding: 6px; color: var(--text-muted); cursor: pointer; border-radius: 8px; display: flex; align-items: center; }
    .remove-entry-btn:hover { color: var(--danger); background: var(--surface-2); }
    .set-row { display: flex; align-items: flex-end; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--border); }
    .set-num { font-size: 12px; font-weight: 700; color: var(--text-muted); min-width: 18px; text-align: center; padding-bottom: 8px; }
    .set-field { display: flex; flex-direction: column; gap: 3px; flex: 1; }
    .set-label { font-size: 10px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
    .set-input { padding: 8px 4px; border: 1.5px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 14px; width: 100%; box-sizing: border-box; text-align: center; -webkit-appearance: none; }
    .set-input:focus { outline: none; border-color: var(--primary); }
    .remove-set-btn { background: none; border: none; padding: 6px; color: var(--text-muted); cursor: pointer; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-bottom: 2px; }
    .remove-set-btn:hover { color: var(--danger); background: var(--surface-2); }
    .quick-fill-section { padding-top: 8px; }
    .quick-fill-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
    .quick-fill-row { display: flex; align-items: flex-end; gap: 6px; margin-top: 6px; flex-wrap: nowrap; }
    .qf-field { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
    .set-input.qf { flex: 1; min-width: 0; padding: 8px 4px; }
    .add-sets-btn { flex-shrink: 0; white-space: nowrap; align-self: flex-end; }
    .add-exercise-panel { padding: 14px; }
    .add-exercise-row { display: flex; gap: 10px; align-items: center; }
    .exercise-select { flex: 1; min-width: 0; }
    .no-workouts-hint { font-size: 13px; color: var(--text-muted); margin: 8px 0 0; }
    .link { color: var(--primary); text-decoration: none; }
    .save-row { display: flex; gap: 10px; align-items: center; }
    .save-btn { flex: 1; justify-content: center; font-size: 16px; padding: 14px; }
    .btn-sm { font-size: 13px; padding: 8px 12px; }
    .btn-xs { font-size: 12px; padding: 4px 8px; min-height: 28px; }
    /* Session notes */
    .notes-input { resize: vertical; font-family: inherit; }
    /* Historical context hint */
    .history-hint { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); padding: 4px 0; border-bottom: 1px solid var(--border); }
    .history-label { font-weight: 700; color: var(--text-muted); }
    .overload-chip { background: rgba(var(--primary-rgb, 0,122,255),.12); color: var(--primary); font-weight: 700; padding: 2px 7px; border-radius: 8px; font-size: 11px; }
    /* Feel rating row */
    .feel-row { display: flex; align-items: center; gap: 4px; padding: 4px 0; }
    .feel-label { font-size: 11px; font-weight: 600; color: var(--text-muted); min-width: 28px; }
    .feel-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--border); padding: 1px; line-height: 1; transition: color .1s; }
    .feel-btn.lit { color: #f59e0b; }
    /* Checkmark & warm-up buttons */
    .check-btn { min-width: 26px; height: 26px; border: 2px solid var(--border); border-radius: 7px; background: none; cursor: pointer; font-size: 12px; font-weight: 700; color: var(--text-muted); display: flex; align-items: center; justify-content: center; padding: 0; flex-shrink: 0; transition: all .15s; }
    .check-btn.checked { background: var(--success); border-color: var(--success); color: #fff; }
    .warmup-toggle-btn { background: none; border: 1.5px solid var(--border); border-radius: 6px; padding: 4px 6px; font-size: 11px; font-weight: 700; color: var(--text-muted); cursor: pointer; flex-shrink: 0; transition: all .15s; }
    .warmup-toggle-btn.active { background: var(--primary-light, rgba(0,122,255,.12)); border-color: var(--primary); color: var(--primary); }
    .warmup-set .set-input { opacity: 0.5; }
    .done-set .set-input { opacity: 0.4; }
    /* Exercise search */
    .exercise-search-row { margin-bottom: 6px; }
    .search-input { font-size: 14px; }
    .group-filter-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .group-chip { padding: 4px 12px; border-radius: 16px; border: 1.5px solid var(--border); background: var(--surface-2); color: var(--text); font-size: 12px; font-weight: 500; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: all .12s; }
    .group-chip.active { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 700; }
    /* Cardio entry */
    .entry-cardio-badge { background: #fce7f3; color: #be185d; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; margin-left: 6px; }
    .cardio-fields { display: flex; gap: 12px; padding: 10px 0 6px; flex-wrap: wrap; }
    .cardio-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 120px; }
  `],
})
export class SessionLogComponent implements OnInit, OnDestroy {
  readonly logSvc = inject(SessionLogService);
  readonly workoutState = inject(WorkoutStateService);
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly histSvc = inject(WorkoutHistoryService);
  private readonly notify = inject(NotificationService);
  private readonly log = inject(LoggingService);
  private readonly router = inject(Router);
  private readonly restTimer = inject(RestTimerService);

  private navSub?: Subscription;

  readonly workouts = this.workoutState.workouts;
  readonly session = signal<Session>(this.logSvc.createEmptySession());
  readonly entries = signal<SessionEntry[]>([]);

  // Exercise search/filter
  exerciseSearch = '';
  exerciseFilterGroup = '';
  readonly filteredWorkouts = computed(() => {
    const all = this.workouts();
    const q = this.exerciseSearch.toLowerCase();
    const g = this.exerciseFilterGroup;
    return all.filter(w => {
      const nameMatch = !q || w.name.toLowerCase().includes(q);
      const groupMatch = !g || getWorkoutMuscleGroups(w).includes(g as never);
      return nameMatch && groupMatch;
    });
  });
  readonly muscleGroups = computed(() => {
    const groups = new Set<string>();
    for (const w of this.workouts()) {
      for (const g of getWorkoutMuscleGroups(w)) groups.add(g);
    }
    return Array.from(groups).sort();
  });

  // Per-set completed checkmarks (visual only, not persisted)
  readonly completedSets = signal<Set<string>>(new Set());

  sessionGymName = '';
  sessionStartTime = '';
  sessionEndTime = '';
  sessionMood: Mood | undefined = undefined;
  sessionNotes = '';
  selectedWorkoutId = '';
  quickFills: QuickFill[] = [];
  savedToday = signal(false);
  private unsaved = false;

  readonly starValues: Mood[] = [1, 2, 3, 4, 5];
  readonly moodLabels: Record<number, string> = {
    1: 'Rough',
    2: 'Tired',
    3: 'Solid',
    4: 'Good',
    5: 'Crushing it',
  };

  ngOnInit(): void {
    const hadTemplate = !!this.workoutState.templateSession();
    this.applyTemplateIfPending();

    if (!hadTemplate) {
      // Fresh start — no template pending
      const cfg = this.workoutState.config();
      const newSession = this.logSvc.createEmptySession(cfg.defaultGymName);
      this.session.set(newSession);
      this.sessionGymName = cfg.defaultGymName ?? '';

      if (!this.workoutState.workoutsLoaded()) {
        this.workoutGithub.loadWorkouts().catch(err =>
          this.log.dbg('Failed to load workouts: ' + String(err), 'error')
        );
      }
    }

    // Re-apply when user navigates back to this already-mounted component
    this.navSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => this.applyTemplateIfPending());
  }

  ngOnDestroy(): void {
    this.navSub?.unsubscribe();
  }

  private applyTemplateIfPending(): void {
    const template = this.workoutState.templateSession();
    if (!template) return;

    const newSession: Session = {
      ...template,
      id: generateUUID(),
      date: getTodayString(),
    };
    this.session.set(newSession);
    this.entries.set(template.entries.map(e => ({
      ...e,
      id: generateUUID(),
      sets: e.sets.map(s => ({ ...s })),
    })));
    this.sessionGymName = template.gymName ?? '';
    this.sessionStartTime = template.startTime ?? '';
    this.sessionEndTime = template.endTime ?? '';
    this.sessionMood = template.mood;
    this.sessionNotes = template.notes ?? '';
    this.completedSets.set(new Set());
    this.quickFills = this.entries().map(() => this.emptyQuickFill());
    this.savedToday.set(false);
    this.unsaved = false;
    this.workoutState.templateSession.set(null);

    if (!this.workoutState.workoutsLoaded()) {
      this.workoutGithub.loadWorkouts().catch(err =>
        this.log.dbg('Failed to load workouts: ' + String(err), 'error')
      );
    }
  }

  onDateChange(date: string): void {
    this.session.update(s => ({ ...s, date }));
  }

  workoutName(id: string): string {
    return this.workouts().find(w => w.id === id)?.name ?? id;
  }

  isCardioEntry(workoutId: string): boolean {
    return this.workouts().find(w => w.id === workoutId)?.type === 'cardio';
  }

  addEntry(): void {
    if (!this.selectedWorkoutId) return;
    const entry = this.logSvc.createEntry(this.selectedWorkoutId);
    this.entries.update(e => [...e, entry]);
    this.quickFills.push(this.emptyQuickFill());
    this.selectedWorkoutId = '';
    this.markUnsaved();
  }

  removeEntry(index: number): void {
    this.entries.update(e => e.filter((_, i) => i !== index));
    this.quickFills.splice(index, 1);
    this.markUnsaved();
  }

  removeSet(entryIndex: number, setIndex: number): void {
    this.entries.update(entries => {
      const updated = entries.slice();
      const entry = { ...updated[entryIndex] };
      entry.sets = entry.sets
        .filter((_, i) => i !== setIndex)
        .map((s, i) => ({ ...s, setNumber: i + 1 }));
      updated[entryIndex] = entry;
      return updated;
    });
    this.markUnsaved();
  }

  quickAddSets(entryIndex: number): void {
    const qf = this.quickFills[entryIndex];
    if (!qf.reps || !qf.weightKg || !qf.count) {
      this.notify.showNotification('Fill reps, kg, and count for quick-fill', 'error');
      return;
    }
    this.entries.update(entries => {
      const updated = entries.slice();
      const entry = { ...updated[entryIndex] };
      const startFrom = entry.sets.length + 1;
      const newSets = this.logSvc.generateSets(
        qf.reps!, qf.weightKg!, qf.count!,
        qf.breakSeconds ?? undefined, startFrom
      );
      entry.sets = [...entry.sets, ...newSets];
      updated[entryIndex] = entry;
      return updated;
    });
    this.quickFills[entryIndex] = this.emptyQuickFill();
    this.markUnsaved();
  }

  markUnsaved(): void {
    this.unsaved = true;
    this.savedToday.set(false);
  }

  async saveSession(): Promise<void> {
    const finalSession: Session = {
      ...this.session(),
      gymName: this.sessionGymName.trim() || undefined,
      startTime: this.sessionStartTime || undefined,
      endTime: this.sessionEndTime || undefined,
      mood: this.sessionMood,
      notes: this.sessionNotes.trim() || undefined,
      entries: this.entries(),
    };
    const ok = await this.logSvc.saveSession(finalSession);
    if (ok) {
      this.savedToday.set(true);
      this.unsaved = false;
      this.session.set(finalSession);
      // Ensure history reflects this save immediately
      this.histSvc.notifySaved(finalSession);
    }
  }

  clearSession(): void {
    const cfg = this.workoutState.config();
    const fresh = this.logSvc.createEmptySession(cfg.defaultGymName);
    this.session.set(fresh);
    this.entries.set([]);
    this.sessionGymName = cfg.defaultGymName ?? '';
    this.sessionStartTime = '';
    this.sessionEndTime = '';
    this.sessionMood = undefined;
    this.sessionNotes = '';
    this.quickFills = [];
    this.completedSets.set(new Set());
    this.savedToday.set(false);
    this.unsaved = false;
  }

  private emptyQuickFill(): QuickFill {
    return { reps: null, weightKg: null, count: null, breakSeconds: null };
  }

  // ── Set completion checkmarks ───────────────────────────────────────────
  setKey(entryId: string, setNumber: number): string {
    return `${entryId}-${setNumber}`;
  }

  isSetDone(entryId: string, setNumber: number): boolean {
    return this.completedSets().has(this.setKey(entryId, setNumber));
  }

  toggleSetDone(entryId: string, setNumber: number): void {
    const wasNotDone = !this.completedSets().has(this.setKey(entryId, setNumber));
    this.completedSets.update(prev => {
      const next = new Set(prev);
      const key = this.setKey(entryId, setNumber);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    // Start rest timer when marking a set done
    if (wasNotDone) {
      // Use set's breakSeconds if available, else fall back to config default
      const entry = this.entries().find(e => e.id === entryId);
      const set = entry?.sets.find(s => s.setNumber === setNumber);
      const restSeconds = set?.breakSeconds ?? this.workoutState.config().defaultRestSeconds ?? 90;
      this.restTimer.defaultDuration.set(restSeconds);
      this.restTimer.start(restSeconds);
    }
  }

  // ── Warm-up set toggle ──────────────────────────────────────────────────
  toggleWarmup(entryIdx: number, setIdx: number): void {
    this.entries.update(entries => {
      const updated = entries.slice();
      const entry = { ...updated[entryIdx] };
      const sets = entry.sets.slice();
      sets[setIdx] = { ...sets[setIdx], isWarmup: !sets[setIdx].isWarmup };
      entry.sets = sets;
      updated[entryIdx] = entry;
      return updated;
    });
    this.markUnsaved();
  }

  // ── Per-exercise feel rating ────────────────────────────────────────────
  setEntryRating(entryIdx: number, rating: 1|2|3|4|5): void {
    this.entries.update(entries => {
      const updated = entries.slice();
      const entry = { ...updated[entryIdx] };
      entry.rating = entry.rating === rating ? undefined : rating;
      updated[entryIdx] = entry;
      return updated;
    });
    this.markUnsaved();
  }

  // ── Historical context / progressive overload ───────────────────────────
  lastSessionStats(workoutId: string): LastSessionStats | null {
    const sessions = this.workoutState.sessions();
    if (!sessions.length) return null;
    // Find the most recent session (not today) that has this exercise
    const today = this.session().date;
    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i];
      if (s.date === today) continue;
      const entry = s.entries.find(e => e.workoutId === workoutId);
      if (!entry) continue;
      const workingSets = entry.sets.filter(st => !st.isWarmup);
      if (!workingSets.length) continue;
      const maxWeight = Math.max(...workingSets.map(st => st.weightKg));
      const suggestedWeight = Math.round((maxWeight + 2.5) * 4) / 4; // nearest 0.25
      return { date: s.date, maxWeight, totalSets: workingSets.length, suggestedWeight };
    }
    return null;
  }
}
