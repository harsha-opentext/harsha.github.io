import { Injectable, signal } from '@angular/core';
import { Session } from '../models/session.model';
import { Workout } from '../models/workout.model';
import { WorkoutStreakData } from '../models/workout-streak.model';
import { WorkoutConfig, DEFAULT_WORKOUT_CONFIG } from '../models/workout-config.model';
import { SessionTemplate } from '../models/session-template.model';

@Injectable({ providedIn: 'root' })
export class WorkoutStateService {
  // Core data
  readonly workouts = signal<Workout[]>([]);
  readonly sessions = signal<Session[]>([]);
  readonly templates = signal<SessionTemplate[]>([]);
  readonly fileIndex = signal<Record<string, string>>({});

  // Streak
  readonly streakData = signal<WorkoutStreakData>({
    currentStreak: 0,
    bestStreak: 0,
    weeklyTarget: 5,
    lastUpdated: null,
  });

  // Config
  readonly config = signal<WorkoutConfig>({ ...DEFAULT_WORKOUT_CONFIG });

  // Template session — set by history "Use as Template", consumed by logger
  readonly templateSession = signal<Session | null>(null);
  // Applied session template — set by template picker, consumed by logger
  readonly appliedTemplate = signal<SessionTemplate | null>(null);

  // Loading states
  readonly workoutsLoaded = signal(false);
  readonly sessionsLoaded = signal(false);
  readonly templatesLoaded = signal(false);
}
