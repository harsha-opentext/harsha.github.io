import { Injectable, inject, signal, computed } from '@angular/core';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LoggingService } from '../../../core/services/logging.service';
import { Session, SessionEntry, WorkoutSet } from '../../../core/models/session.model';
import { getTodayString } from '../../../shared/utils/date.utils';
import { generateUUID } from '../../../shared/utils/uuid.utils';

@Injectable({ providedIn: 'root' })
export class SessionLogService {
  private readonly workoutGithub = inject(WorkoutGithubApiService);
  private readonly workoutState = inject(WorkoutStateService);
  private readonly notify = inject(NotificationService);
  private readonly log = inject(LoggingService);

  readonly saving = signal(false);

  async saveSession(session: Session): Promise<boolean> {
    if (session.entries.length === 0) {
      this.notify.showNotification('Add at least one exercise before saving', 'error');
      return false;
    }
    this.saving.set(true);
    try {
      const ok = await this.workoutGithub.saveSession(session.date, session);
      if (ok) {
        // Update sessions signal: replace or add
        this.workoutState.sessions.update(sessions => {
          const idx = sessions.findIndex(s => s.date === session.date);
          if (idx !== -1) {
            const updated = sessions.slice();
            updated[idx] = session;
            return updated;
          }
          return [...sessions, session];
        });
      }
      return ok;
    } finally {
      this.saving.set(false);
    }
  }

  createEmptySession(defaultGymName?: string): Session {
    return {
      id: generateUUID(),
      date: getTodayString(),
      gymName: defaultGymName,
      startTime: undefined,
      endTime: undefined,
      mood: undefined,
      entries: [],
    };
  }

  createEntry(workoutId: string): SessionEntry {
    return { id: generateUUID(), workoutId, sets: [] };
  }

  addSet(entry: SessionEntry, reps: number, weightKg: number, breakSeconds?: number): SessionEntry {
    const setNumber = entry.sets.length + 1;
    const newSet: WorkoutSet = { setNumber, reps, weightKg, breakSeconds };
    return { ...entry, sets: [...entry.sets, newSet] };
  }

  generateSets(reps: number, weightKg: number, count: number, breakSeconds?: number, startFrom = 1): WorkoutSet[] {
    return Array.from({ length: count }, (_, i) => ({
      setNumber: startFrom + i,
      reps,
      weightKg,
      breakSeconds,
    }));
  }
}
