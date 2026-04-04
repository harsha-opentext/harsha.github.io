import { MuscleGroup } from './workout.model';

export interface TemplateSet {
  setNumber: number;
  reps: number;
  weightKg: number;
  breakSeconds?: number;
}

export interface TemplateEntry {
  workoutId: string;
  sets: TemplateSet[];
}

export interface SessionTemplate {
  id: string;
  name: string;
  gymName?: string;
  entries: TemplateEntry[];
  createdAt: string;
}
