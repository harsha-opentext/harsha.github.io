import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { WorkoutHistoryService } from './workout-history.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { ConfirmService } from '../../../shared/components/confirm-modal/confirm.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Session, SessionEntry } from '../../../core/models/session.model';
import { Workout } from '../../../core/models/workout.model';
import { formatDateReadable, getTodayString, addDaysToDateString, formatDateLocal } from '../../../shared/utils/date.utils';

type HistoryFilter = 'all' | 'yesterday' | 'lastWeek';

const MOOD_EMOJIS: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '😊', 5: '💪' };

@Component({
  selector: 'app-workout-history',
  standalone: true,
  imports: [CommonModule],
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
              <button class="btn-secondary btn-xs template-btn" (click)="useAsTemplate($event, dateStr)">
                📋 Template
              </button>
              <button class="btn-danger btn-xs" (click)="deleteSession($event, dateStr)">🗑️</button>
              <span class="chevron">{{ histSvc.expandedId() === (session?.id ?? dateStr) ? '▲' : '▼' }}</span>
            </div>
          </div>

          <!-- Expanded detail -->
          @if (histSvc.expandedId() === (session?.id ?? dateStr) && session) {
            <div class="session-detail">
              @if (session.startTime || session.endTime) {
                <div class="detail-row">
                  <span class="detail-label">Time</span>
                  <span>{{ session.startTime || '—' }} → {{ session.endTime || '—' }}</span>
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
  `],
})
export class WorkoutHistoryComponent implements OnInit {
  readonly histSvc = inject(WorkoutHistoryService);
  private readonly workoutState = inject(WorkoutStateService);
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  goHub(): void { this.router.navigate(['/workout/hub']); }

  readonly activeFilter = signal<HistoryFilter>('all');

  readonly filterOptions: { label: string; value: HistoryFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Yesterday', value: 'yesterday' },
    { label: 'Last Week', value: 'lastWeek' },
  ];

  readonly filteredDates = computed(() => {
    const all = this.histSvc.sessionDates();
    const f = this.activeFilter();
    if (f === 'all') return all;
    if (f === 'yesterday') {
      const yesterday = addDaysToDateString(getTodayString(), -1);
      return all.filter(d => d === yesterday);
    }
    // lastWeek: Mon–Sun of the previous ISO week
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun
    const daysToMonday = (dayOfWeek + 6) % 7; // days since Monday
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - daysToMonday);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    const start = formatDateLocal(lastMonday);
    const end = formatDateLocal(lastSunday);
    return all.filter(d => d >= start && d <= end);
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
    return entry.sets.reduce((acc, s) => acc + s.reps * s.weightKg, 0);
  }
}
