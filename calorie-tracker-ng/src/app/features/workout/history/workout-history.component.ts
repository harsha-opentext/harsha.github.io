import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { WorkoutHistoryService } from './workout-history.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { ConfirmService } from '../../../shared/components/confirm-modal/confirm.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Session, SessionEntry, WorkoutSet, Mood } from '../../../core/models/session.model';
import { Workout, getWorkoutMuscleGroups } from '../../../core/models/workout.model';
import { formatDateReadable, getTodayString, addDaysToDateString, formatDateLocal } from '../../../shared/utils/date.utils';
import { calculateEntryVolume } from '../../../shared/utils/workout-volume.utils';

type HistoryFilter = 'all' | 'yesterday' | 'lastWeek' | 'thisMonth' | 'custom';

const MOOD_EMOJIS: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '😊', 5: '💪' };

interface EditableSet {
  setNumber: number;
  reps: number;
  weightKg: number;
  breakSeconds: number | null;
}

interface EditableEntry {
  id: string;
  workoutId: string;
  sets: EditableSet[];
}

@Component({
  selector: 'app-workout-history',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="history-page">
      <div class="page-header">
        <h2 class="page-title">History</h2>
        <div class="header-actions">
          <button class="hub-back-btn" (click)="goHub()">← Hub</button>
          <button class="btn-secondary btn-sm" [class.loading]="histSvc.loading()" (click)="reload()">
            {{ histSvc.loading() ? '⏳' : '🔄' }} Refresh
          </button>
        </div>
      </div>

      <!-- Quick filters -->
      <div class="filter-chips">
        @for (f of filterOptions; track f.value) {
          <button
            class="filter-chip"
            [class.active]="activeFilter() === f.value"
            (click)="activeFilter.set(f.value)"
          >{{ f.label }}</button>
        }
      </div>

      <!-- Advanced filters -->
      @if (activeFilter() === 'custom') {
        <div class="custom-filter card">
          <div class="custom-filter-row">
            <div class="cf-field"><label class="field-label">From</label><input type="date" class="form-input" [(ngModel)]="customStart" /></div>
            <div class="cf-field"><label class="field-label">To</label><input type="date" class="form-input" [(ngModel)]="customEnd" /></div>
          </div>
        </div>
      }
      <div class="adv-filter-row">
        <select class="form-input adv-select" [(ngModel)]="filterMuscleGroup">
          <option value="">All muscles</option>
          @for (g of availableMuscleGroups(); track g) {
            <option [value]="g">{{ g }}</option>
          }
        </select>
        <select class="form-input adv-select" [(ngModel)]="filterExercise">
          <option value="">All exercises</option>
          @for (w of workoutsInHistory(); track w.id) {
            <option [value]="w.id">{{ w.name }}</option>
          }
        </select>
      </div>

      @if (histSvc.loading() && histSvc.sessionDates().length === 0) {
        <div class="loading-state card"><p>⏳ Loading sessions…</p></div>
      }

      @if (!histSvc.loading() && filteredDates().length === 0) {
        <div class="empty-state card">
          <div class="empty-icon">🗂️</div>
          @if (activeFilter() === 'yesterday') {
            <p>No session yesterday.</p>
          } @else if (activeFilter() === 'lastWeek') {
            <p>No sessions last week.</p>
          } @else {
            <p>No sessions yet.</p>
            <p class="text-muted">Log a workout session to see it here.</p>
          }
        </div>
      }

      @for (dateStr of filteredDates(); track dateStr) {
        @let session = histSvc.getSession(dateStr);
        <div
          class="session-card card"
          [class.expanded]="histSvc.expandedId() === (session?.id ?? dateStr)"
        >
          <!-- Card header (always visible) -->
          <div class="session-header" (click)="toggleExpand(dateStr)">
            <div class="session-meta">
              <div class="session-date">{{ formatDate(dateStr) }}</div>
              <div class="session-summary">
                @if (session) {
                  @if (session.gymName) {
                    <span class="meta-chip">🏢 {{ session.gymName }}</span>
                  }
                  @if (session.mood) {
                    <span class="meta-chip">{{ moodEmoji(session.mood) }}</span>
                  }
                  <span class="meta-chip">{{ workoutSummary(session) }}</span>
                } @else {
                  <span class="meta-chip loading-chip">Loading…</span>
                }
              </div>
            </div>
            <div class="expand-actions">
              <button class="btn-secondary btn-xs template-btn" (click)="useAsTemplate($event, dateStr)" title="Copy this session's exercises to today">
                📋 Use as Template
              </button>
              @if (session) {
                <button class="btn-secondary btn-xs" (click)="startEdit($event, dateStr)" title="Edit session">✏️</button>
              }
              <button class="btn-danger btn-xs" (click)="deleteSession($event, dateStr)">🗑️</button>
              <span class="chevron">{{ histSvc.expandedId() === (session?.id ?? dateStr) ? '▲' : '▼' }}</span>
            </div>
          </div>

          <!-- Expanded detail -->
          @if (histSvc.expandedId() === (session?.id ?? dateStr) && session) {

            <!-- ── Edit mode ── -->
            @if (editingDate() === dateStr) {
              <div class="session-detail edit-panel">
                <div class="edit-header">
                  <span class="edit-title">Edit Session</span>
                  <button class="btn-ghost btn-xs" (click)="cancelEdit()">✕ Cancel</button>
                </div>
                <div class="edit-field-row">
                  <div class="edit-field">
                    <label class="field-label">Gym</label>
                    <input type="text" class="form-input" [(ngModel)]="editGymName" placeholder="Optional" />
                  </div>
                </div>
                <div class="edit-field-row two-col">
                  <div class="edit-field">
                    <label class="field-label">Start time</label>
                    <input type="time" class="form-input" [(ngModel)]="editStartTime" />
                  </div>
                  <div class="edit-field">
                    <label class="field-label">End time</label>
                    <input type="time" class="form-input" [(ngModel)]="editEndTime" />
                  </div>
                </div>
                <div class="edit-field-row">
                  <label class="field-label">Mood</label>
                  <div class="mood-row">
                    @for (v of starValues; track v) {
                      <button class="mood-btn" [class.lit]="editMood !== undefined && v <= editMood" (click)="editMood = (editMood === v ? undefined : v)">★</button>
                    }
                  </div>
                </div>
                <div class="edit-field-row">
                  <label class="field-label">Notes</label>
                  <textarea class="form-input notes-input" [(ngModel)]="editNotes" placeholder="Optional notes…" rows="2"></textarea>
                </div>
                @for (entry of editEntries; track entry.id; let ei = $index) {
                  <div class="edit-entry">
                    <div class="entry-title">{{ workoutName(entry.workoutId) }}</div>
                    <div class="sets-table">
                      <div class="sets-header">
                        <span>Set</span><span>Reps</span><span>kg</span><span>Rest</span><span></span>
                      </div>
                      @for (set of entry.sets; track set.setNumber; let si = $index) {
                        <div class="edit-set-row">
                          <span class="set-num">{{ set.setNumber }}</span>
                          <input type="number" class="set-inp" [(ngModel)]="set.reps" min="1" />
                          <input type="number" class="set-inp" [(ngModel)]="set.weightKg" min="0" step="0.5" />
                          <input type="number" class="set-inp" [(ngModel)]="set.breakSeconds" min="0" placeholder="—" />
                          <button class="rm-btn" (click)="removeEditSet(ei, si)">✕</button>
                        </div>
                      }
                    </div>
                  </div>
                }
                <div class="edit-actions">
                  <button class="btn-primary" [class.loading]="editSaving()" (click)="saveEdit(dateStr)">
                    {{ editSaving() ? '⏳ Saving…' : '💾 Save Changes' }}
                  </button>
                  <button class="btn-secondary" (click)="cancelEdit()">Cancel</button>
                </div>
              </div>
            } @else {

            <!-- ── Read-only detail ── -->
            <div class="session-detail">
              @if (session.startTime || session.endTime) {
                <div class="detail-row">
                  <span class="detail-label">Time</span>
                  <span>{{ session.startTime || '—' }} → {{ session.endTime || '—' }}</span>
                </div>
              }
              @if (session.notes) {
                <div class="detail-row">
                  <span class="detail-label">Notes</span>
                  <span>{{ session.notes }}</span>
                </div>
              }
              @for (entry of session.entries; track entry.id) {
                <div class="entry-detail">
                  <div class="entry-title">{{ workoutName(entry.workoutId) }}</div>
                  <div class="sets-table">
                    <div class="sets-header">
                      <span>Set</span><span>Reps</span><span>kg</span><span>Rest</span>
                    </div>
                    @for (set of entry.sets; track set.setNumber) {
                      <div class="sets-row">
                        <span>{{ set.setNumber }}</span>
                        <span>{{ set.reps }}</span>
                        <span>{{ set.weightKg }}</span>
                        <span>{{ set.breakSeconds ?? '—' }}</span>
                      </div>
                    }
                    <div class="entry-volume">
                      Total volume: <b>{{ entryVolume(entry) | number:'1.0-0' }} kg</b>
                    </div>
                  </div>
                </div>
              }
            </div>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .history-page { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; }
    .page-header { display: flex; align-items: center; justify-content: space-between; }
    .page-title { font-size: 20px; font-weight: 700; margin: 0; }
    .loading-state, .empty-state { padding: 32px 24px; text-align: center; }
    .empty-icon { font-size: 40px; margin-bottom: 10px; }
    .empty-state p { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: var(--text); }
    .text-muted { font-size: 13px; color: var(--text-muted) !important; font-weight: 400 !important; }
    .session-card { padding: 0; overflow: hidden; }
    .session-card.expanded { border-color: var(--primary); }
    .session-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 14px 16px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .session-meta { display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .session-date { font-size: 16px; font-weight: 700; }
    .session-summary { display: flex; flex-wrap: wrap; gap: 6px; }
    .meta-chip { background: var(--surface-2); border-radius: 10px; padding: 3px 8px; font-size: 12px; color: var(--text); }
    .loading-chip { color: var(--text-muted); font-style: italic; }
    .expand-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .chevron { font-size: 12px; color: var(--text-muted); }
    .template-btn { font-size: 11px; padding: 4px 8px; }
    .session-detail { padding: 0 16px 14px; border-top: 1px solid var(--border); }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; border-bottom: 1px solid var(--border); }
    .detail-label { color: var(--text-muted); font-weight: 600; font-size: 12px; }
    .entry-detail { padding: 10px 0; border-bottom: 1px solid var(--border); }
    .entry-detail:last-child { border-bottom: none; }
    .entry-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
    .sets-table { display: flex; flex-direction: column; gap: 4px; }
    .sets-header, .sets-row { display: grid; grid-template-columns: 40px 1fr 1fr 1fr; gap: 8px; font-size: 13px; }
    .sets-header { color: var(--text-muted); font-weight: 600; font-size: 11px; }
    .sets-row { color: var(--text); }
    .entry-volume { font-size: 12px; color: var(--text-muted); margin-top: 6px; }
    .btn-sm { font-size: 13px; padding: 8px 12px; }
    .btn-xs { font-size: 12px; padding: 4px 8px; min-height: 28px; }
    .filter-chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .filter-chip { padding: 7px 16px; border-radius: 20px; border: 1.5px solid var(--border); background: var(--surface-2); color: var(--text); font-size: 13px; font-weight: 500; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: all .15s; }
    .filter-chip.active { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 700; }
    /* Edit panel */
    .edit-panel { padding: 12px 16px 16px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; }
    .edit-header { display: flex; align-items: center; justify-content: space-between; }
    .edit-title { font-size: 14px; font-weight: 700; color: var(--primary); }
    .edit-field-row { display: flex; flex-direction: column; gap: 6px; }
    .edit-field-row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .edit-field { display: flex; flex-direction: column; gap: 4px; }
    .field-label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .form-input { padding: 9px 12px; border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 14px; width: 100%; box-sizing: border-box; }
    .form-input:focus { outline: none; border-color: var(--primary); }
    .notes-input { resize: vertical; font-family: inherit; }
    .mood-row { display: flex; gap: 4px; }
    .mood-btn { background: none; border: none; font-size: 22px; cursor: pointer; color: var(--border); padding: 2px; line-height: 1; transition: color .12s; }
    .mood-btn.lit { color: #f59e0b; }
    .edit-entry { padding: 8px 0; border-top: 1px solid var(--border); }
    .edit-set-row { display: grid; grid-template-columns: 24px 1fr 1fr 1fr 28px; gap: 4px; align-items: center; padding: 4px 0; }
    .set-inp { padding: 6px 4px; border: 1.5px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); font-size: 13px; text-align: center; width: 100%; box-sizing: border-box; -webkit-appearance: none; }
    .set-inp:focus { outline: none; border-color: var(--primary); }
    .rm-btn { background: none; border: none; color: var(--text-muted); font-size: 14px; cursor: pointer; padding: 4px; border-radius: 5px; display: flex; align-items: center; justify-content: center; }
    .rm-btn:hover { color: var(--danger); background: var(--surface-2); }
    .edit-actions { display: flex; gap: 10px; padding-top: 4px; }
    .btn-ghost { background: var(--surface-2); border: 1.5px solid var(--border); border-radius: 9px; cursor: pointer; color: var(--text); font-weight: 600; padding: 5px 10px; font-size: 12px; }
    /* Advanced / custom filters */
    .custom-filter { padding: 12px 14px; margin-top: -6px; }
    .custom-filter-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .cf-field { display: flex; flex-direction: column; gap: 4px; }
    .adv-filter-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
    .adv-select { flex: 1; min-width: 140px; font-size: 13px; }
  `],
})
export class WorkoutHistoryComponent implements OnInit {
  readonly histSvc = inject(WorkoutHistoryService);
  private readonly workoutState = inject(WorkoutStateService);
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  readonly editingDate = signal<string | null>(null);
  readonly editSaving = signal(false);
  readonly starValues: Mood[] = [1, 2, 3, 4, 5];
  // Mutable edit state — deep copy of session fields
  editGymName = '';
  editStartTime = '';
  editEndTime = '';
  editMood: Mood | undefined = undefined;
  editNotes = '';
  editEntries: EditableEntry[] = [];

  goHub(): void { this.router.navigate(['/workout/hub']); }

  readonly activeFilter = signal<HistoryFilter>('all');
  // Advanced filter state
  filterMuscleGroup = '';
  filterExercise = '';
  customStart = '';
  customEnd = '';

  readonly filterOptions: { label: string; value: HistoryFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Yesterday', value: 'yesterday' },
    { label: 'Last Week', value: 'lastWeek' },
    { label: 'This Month', value: 'thisMonth' },
    { label: 'Custom', value: 'custom' },
  ];

  readonly availableMuscleGroups = computed(() => {
    const groups = new Set<string>();
    for (const w of this.workoutState.workouts()) {
      for (const g of getWorkoutMuscleGroups(w)) groups.add(g);
    }
    return Array.from(groups).sort();
  });

  readonly workoutsInHistory = computed(() => {
    const ids = new Set<string>();
    for (const s of this.histSvc.loadedSessions()) {
      for (const e of s.entries) ids.add(e.workoutId);
    }
    return this.workoutState.workouts().filter(w => ids.has(w.id));
  });

  readonly filteredDates = computed(() => {
    const all = this.histSvc.sessionDates();
    const f = this.activeFilter();
    let base: string[];

    if (f === 'all') {
      base = all;
    } else if (f === 'yesterday') {
      const yesterday = addDaysToDateString(getTodayString(), -1);
      base = all.filter(d => d === yesterday);
    } else if (f === 'thisMonth') {
      const prefix = getTodayString().slice(0, 7); // YYYY-MM
      base = all.filter(d => d.startsWith(prefix));
    } else if (f === 'custom') {
      const s = this.customStart;
      const e = this.customEnd;
      base = all.filter(d => (!s || d >= s) && (!e || d <= e));
    } else {
      // lastWeek: Mon–Sun of the previous ISO week
      const today = new Date();
      const dayOfWeek = today.getDay();
      const daysToMonday = (dayOfWeek + 6) % 7;
      const thisMonday = new Date(today);
      thisMonday.setDate(today.getDate() - daysToMonday);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      base = all.filter(d => d >= formatDateLocal(lastMonday) && d <= formatDateLocal(lastSunday));
    }

    // Secondary filters (muscle group + exercise)
    if (!this.filterMuscleGroup && !this.filterExercise) return base;
    return base.filter(d => {
      const session = this.histSvc.getSession(d);
      if (!session) return true; // not loaded yet — keep in list
      return session.entries.some(e => {
        if (this.filterExercise && e.workoutId !== this.filterExercise) return false;
        if (this.filterMuscleGroup) {
          const w = this.workoutState.workouts().find(wk => wk.id === e.workoutId);
          if (!w || !getWorkoutMuscleGroups(w).includes(this.filterMuscleGroup as never)) return false;
        }
        return true;
      });
    });
  });

  ngOnInit(): void {
    this.histSvc.loadHistory();
  }

  async reload(): Promise<void> {
    await this.histSvc.loadHistory();
  }

  async toggleExpand(dateStr: string): Promise<void> {
    const session = this.histSvc.getSession(dateStr);
    if (!session) {
      await this.histSvc.fetchSession(dateStr);
      const loaded = this.histSvc.getSession(dateStr);
      if (loaded) this.histSvc.toggleExpand(loaded.id);
      else this.histSvc.toggleExpand(dateStr);
      return;
    }
    this.histSvc.toggleExpand(session.id);
  }

  async useAsTemplate(event: Event, dateStr: string): Promise<void> {
    event.stopPropagation();
    let session = this.histSvc.getSession(dateStr);
    if (!session) {
      session = await this.histSvc.fetchSession(dateStr) ?? undefined;
    }
    if (!session) {
      this.notify.showNotification('Could not load session', 'error');
      return;
    }
    this.workoutState.templateSession.set(session);
    localStorage.setItem('lastUsedTracker', 'workout');
    this.router.navigate(['/workout/log']);
  }

  async cloneSession(event: Event, dateStr: string): Promise<void> {
    await this.useAsTemplate(event, dateStr);
  }

  async deleteSession(event: Event, dateStr: string): Promise<void> {
    event.stopPropagation();
    const proceed = await this.confirm.show(`Delete session for ${this.formatDate(dateStr)}?`, 'Delete Session');
    if (!proceed) return;
    const ok = await this.workoutGithub.deleteSession(dateStr);
    if (ok) {
      this.histSvc.sessionDates.update(dates => dates.filter(d => d !== dateStr));
      this.histSvc.loadedSessions.update(sessions => sessions.filter(s => s.date !== dateStr));
      this.notify.showNotification('Session deleted', 'delete');
      this.confirm.close();
    } else {
      this.confirm.close();
    }
  }

  formatDate(dateStr: string): string {
    return formatDateReadable(dateStr);
  }

  moodEmoji(mood: number): string {
    return MOOD_EMOJIS[mood] ?? '';
  }

  workoutName(id: string): string {
    return this.workoutState.workouts().find(w => w.id === id)?.name ?? id;
  }

  workoutSummary(session: Session): string {
    const names = session.entries.map(e => this.workoutName(e.workoutId));
    if (names.length === 0) return 'No exercises';
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
  }

  entryVolume(entry: SessionEntry): number {
    return calculateEntryVolume(entry);
  }

  // ── Inline Edit ──────────────────────────────────────────────────────────

  startEdit(event: Event, dateStr: string): void {
    event.stopPropagation();
    const session = this.histSvc.getSession(dateStr);
    if (!session) return;
    this.editGymName = session.gymName ?? '';
    this.editStartTime = session.startTime ?? '';
    this.editEndTime = session.endTime ?? '';
    this.editMood = session.mood;
    this.editNotes = session.notes ?? '';
    this.editEntries = session.entries.map(e => ({
      id: e.id,
      workoutId: e.workoutId,
      sets: e.sets.map(s => ({
        setNumber: s.setNumber,
        reps: s.reps,
        weightKg: s.weightKg,
        breakSeconds: s.breakSeconds ?? null,
      })),
    }));
    this.editingDate.set(dateStr);
  }

  cancelEdit(): void {
    this.editingDate.set(null);
  }

  async saveEdit(dateStr: string): Promise<void> {
    const original = this.histSvc.getSession(dateStr);
    if (!original) return;
    this.editSaving.set(true);
    try {
      const updated: Session = {
        ...original,
        gymName: this.editGymName.trim() || undefined,
        startTime: this.editStartTime || undefined,
        endTime: this.editEndTime || undefined,
        mood: this.editMood,
        notes: this.editNotes.trim() || undefined,
        entries: this.editEntries.map(e => ({
          id: e.id,
          workoutId: e.workoutId,
          sets: e.sets.map(s => ({
            setNumber: s.setNumber,
            reps: s.reps,
            weightKg: s.weightKg,
            breakSeconds: s.breakSeconds ?? undefined,
          })),
        })),
      };
      const ok = await this.workoutGithub.saveSession(dateStr, updated);
      if (ok) {
        this.histSvc.notifySaved(updated);
        this.editingDate.set(null);
        this.notify.showNotification('Session updated', 'success');
      }
    } finally {
      this.editSaving.set(false);
    }
  }

  removeEditSet(entryIdx: number, setIdx: number): void {
    const entry = this.editEntries[entryIdx];
    entry.sets = entry.sets
      .filter((_, i) => i !== setIdx)
      .map((s, i) => ({ ...s, setNumber: i + 1 }));
  }
}
