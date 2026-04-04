export type Mood = 1 | 2 | 3 | 4 | 5;

export interface WorkoutSet {
  setNumber: number;
  reps: number;
  weightKg: number;
  breakSeconds?: number;
  /** If true, this set is a warm-up and is excluded from volume calculations */
  isWarmup?: boolean;
}

export interface SessionEntry {
  id: string;
  workoutId: string;
  sets: WorkoutSet[];
  /** Optional 1–5 feel rating for this exercise */
  rating?: 1 | 2 | 3 | 4 | 5;
  /** Duration in minutes (cardio exercises) */
  durationMinutes?: number;
  /** Distance in km (cardio exercises) */
  distanceKm?: number;
}

export interface Session {
  id: string;
  date: string;
  gymName?: string;
  startTime?: string;
  endTime?: string;
  mood?: Mood;
  entries: SessionEntry[];
  /** Free-text session notes */
  notes?: string;
}
