export type Mood = 1 | 2 | 3 | 4 | 5;

export interface WorkoutSet {
  setNumber: number;
  reps: number;
  weightKg: number;
  breakSeconds?: number;
}

export interface SessionEntry {
  id: string;
  workoutId: string;
  sets: WorkoutSet[];
}

export interface Session {
  id: string;
  date: string;
  gymName?: string;
  startTime?: string;
  endTime?: string;
  mood?: Mood;
  entries: SessionEntry[];
}
