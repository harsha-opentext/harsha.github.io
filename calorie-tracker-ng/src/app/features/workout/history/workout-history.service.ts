import { Injectable, inject, signal } from '@angular/core';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { LoggingService } from '../../../core/services/logging.service';
import { Session } from '../../../core/models/session.model';

@Injectable({ providedIn: 'root' })
export class WorkoutHistoryService {
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly workoutState = inject(WorkoutStateService);
  private readonly log = inject(LoggingService);

  readonly loading = signal(false);
  readonly sessionDates = signal<string[]>([]);
  readonly loadedSessions = signal<Session[]>([]);
  readonly expandedId = signal<string | null>(null);
  private fetchedDates = new Set<string>();

  async loadHistory(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      const dates = await this.workoutGithub.listSessionFiles();
      this.sessionDates.set([...dates].reverse()); // newest first
    } catch (err) {
      this.log.dbg('loadHistory error', 'error', err);
    } finally {
      this.loading.set(false);
    }
  }

  async fetchSession(dateStr: string): Promise<Session | null> {
    if (this.fetchedDates.has(dateStr)) {
      return this.loadedSessions().find(s => s.date === dateStr) ?? null;
    }
    const session = await this.workoutGithub.loadSession(dateStr);
    if (session) {
      this.fetchedDates.add(dateStr);
      this.loadedSessions.update(sessions => {
        const idx = sessions.findIndex(s => s.date === dateStr);
        if (idx !== -1) {
          const updated = sessions.slice();
          updated[idx] = session;
          return updated;
        }
        return [...sessions, session];
      });
    }
    return session;
  }

  toggleExpand(id: string): void {
    this.expandedId.update(cur => (cur === id ? null : id));
  }

  getSession(date: string): Session | undefined {
    return this.loadedSessions().find(s => s.date === date);
  }
}
