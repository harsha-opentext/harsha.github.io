import { Injectable, inject } from '@angular/core';
import { WorkoutStateService } from '../../../core/services/workout-state.service';
import { WorkoutGithubApiService } from '../../../core/services/workout-github-api.service';
import { Session, SessionEntry } from '../../../core/models/session.model';
import { MuscleGroup, getWorkoutMuscleGroups } from '../../../core/models/workout.model';
import { calculateEntryVolume, calculateEstimated1RM } from '../../../shared/utils/workout-volume.utils';

export interface PerSessionStats {
  date: string;
  totalVolume: number;  // sum of reps * weightKg across all non-warmup sets
  avgWeight: number;    // average weightKg across all non-warmup sets
  avgReps: number;      // average reps across all non-warmup sets
  totalSets: number;    // count of non-warmup sets
  maxWeight: number;
  estimated1RM: number; // Epley: weight * (1 + reps/30), max across working sets
  avgRating?: number;   // average feel rating (1–5) if rated
}

export interface MuscleGroupFrequency {
  muscleGroup: MuscleGroup;
  sessionCount: number;
}

export interface FatigueCurvePoint {
  setNumber: number;
  avgWeight: number;
  avgReps: number;
  count: number; // sessions contributing to this average
}

export interface FrequencyWeek {
  weekMonday: string;
  count: number;
}

export interface ComparisonRow {
  date: string;
  totalSets: number;
  totalVolume: number;
  avgWeight: number;
  avgReps: number;
}

@Injectable({ providedIn: 'root' })
export class WorkoutAnalyticsService {
  private readonly workoutState = inject(WorkoutStateService);
  private readonly workoutGithub = inject(WorkoutGithubApiService);

  /** Filter entries for a specific workoutId across loaded sessions */
  getEntriesForWorkout(workoutId: string): Array<{ date: string; entry: SessionEntry }> {
    return this.workoutState.sessions()
      .filter(s => s.entries.some(e => e.workoutId === workoutId))
      .flatMap(s =>
        s.entries
          .filter(e => e.workoutId === workoutId)
          .map(e => ({ date: s.date, entry: e }))
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  computePerSessionStats(workoutId: string): PerSessionStats[] {
    return this.getEntriesForWorkout(workoutId).map(({ date, entry }) => {
      const workingSets = entry.sets.filter(s => !s.isWarmup);
      const totalVolume = calculateEntryVolume(entry);
      const totalSets = workingSets.length;
      const avgWeight = totalSets > 0
        ? workingSets.reduce((acc, s) => acc + s.weightKg, 0) / totalSets : 0;
      const avgReps = totalSets > 0
        ? workingSets.reduce((acc, s) => acc + s.reps, 0) / totalSets : 0;
      const maxWeight = totalSets > 0
        ? Math.max(...workingSets.map(s => s.weightKg)) : 0;
      const estimated1RM = calculateEstimated1RM(entry.sets);
      const ratedSets = entry.rating != null ? [entry.rating] : [];
      const avgRating = ratedSets.length > 0 ? ratedSets[0] : undefined;
      return { date, totalVolume, avgWeight, avgReps, totalSets, maxWeight, estimated1RM, avgRating };
    });
  }

  /** Returns session count per muscle group within the loaded sessions range */
  computeMuscleGroupFrequency(startDate?: string, endDate?: string): MuscleGroupFrequency[] {
    const sessions = this.workoutState.sessions().filter(s => {
      if (startDate && s.date < startDate) return false;
      if (endDate && s.date > endDate) return false;
      return true;
    });
    const countMap = new Map<MuscleGroup, number>();
    for (const session of sessions) {
      const groups = new Set<MuscleGroup>();
      for (const entry of session.entries) {
        const workout = this.workoutState.workouts().find(w => w.id === entry.workoutId);
        if (workout) {
          for (const g of getWorkoutMuscleGroups(workout)) groups.add(g);
        }
      }
      for (const g of groups) countMap.set(g, (countMap.get(g) ?? 0) + 1);
    }
    return Array.from(countMap.entries())
      .map(([muscleGroup, sessionCount]) => ({ muscleGroup, sessionCount }))
      .sort((a, b) => b.sessionCount - a.sessionCount);
  }

  computeFatigueCurve(workoutId: string): FatigueCurvePoint[] {
    const entries = this.getEntriesForWorkout(workoutId);
    const setMap = new Map<number, { weightSum: number; repsSum: number; count: number }>();
    for (const { entry } of entries) {
      for (const set of entry.sets) {
        const n = set.setNumber;
        const existing = setMap.get(n) ?? { weightSum: 0, repsSum: 0, count: 0 };
        setMap.set(n, {
          weightSum: existing.weightSum + set.weightKg,
          repsSum: existing.repsSum + set.reps,
          count: existing.count + 1,
        });
      }
    }
    return Array.from(setMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([setNumber, data]) => ({
        setNumber,
        avgWeight: data.count > 0 ? Math.round((data.weightSum / data.count) * 10) / 10 : 0,
        avgReps: data.count > 0 ? Math.round((data.repsSum / data.count) * 10) / 10 : 0,
        count: data.count,
      }));
  }

  computeFrequencyByWeek(): FrequencyWeek[] {
    const sessions = this.workoutState.sessions();
    const weekMap = new Map<string, number>();
    for (const s of sessions) {
      const monday = this.getWeekMonday(s.date);
      weekMap.set(monday, (weekMap.get(monday) ?? 0) + 1);
    }
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekMonday, count]) => ({ weekMonday, count }));
  }

  computeComparisonTable(workoutId: string, lastN = 10): ComparisonRow[] {
    return this.computePerSessionStats(workoutId).slice(-lastN).reverse();
  }

  private getWeekMonday(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    const diff = (day + 6) % 7;
    d.setDate(d.getDate() - diff);
    return d.toISOString().slice(0, 10);
  }

  async loadAllSessions(): Promise<void> {
    const dates = await this.workoutGithub.listSessionFiles();
    const missing = dates.filter(d =>
      !this.workoutState.sessions().some(s => s.date === d)
    );
    const CHUNK = 5;
    for (let i = 0; i < missing.length; i += CHUNK) {
      await Promise.all(missing.slice(i, i + CHUNK).map(async d => {
        const session = await this.workoutGithub.loadSession(d);
        if (session) {
          this.workoutState.sessions.update(sessions => {
            if (sessions.some(s => s.date === d)) return sessions;
            return [...sessions, session];
          });
        }
      }));
    }
  }

  async loadSessionsInRange(
    startDate: string,
    endDate: string,
    onProgress: (done: number, total: number) => void,
  ): Promise<void> {
    const allDates = await this.workoutGithub.listSessionFiles();
    const inRange = allDates.filter(d => d >= startDate && d <= endDate);
    const missing = inRange.filter(d =>
      !this.workoutState.sessions().some(s => s.date === d)
    );
    const total = missing.length;
    onProgress(0, total);
    const CHUNK = 5;
    for (let i = 0; i < missing.length; i += CHUNK) {
      await Promise.all(missing.slice(i, i + CHUNK).map(async d => {
        const session = await this.workoutGithub.loadSession(d);
        if (session) {
          this.workoutState.sessions.update(sessions => {
            if (sessions.some(s => s.date === d)) return sessions;
            return [...sessions, session];
          });
        }
      }));
      onProgress(Math.min(i + CHUNK, total), total);
    }
  }
}
