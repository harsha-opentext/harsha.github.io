export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'legs'
  | 'shoulders'
  | 'arms'
  | 'core'
  | 'cardio'
  | 'full body';

export const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest',
  'back',
  'legs',
  'shoulders',
  'arms',
  'core',
  'cardio',
  'full body',
];

export interface Workout {
  id: string;
  name: string;
  /** Multiple muscle groups for this workout */
  muscleGroups?: MuscleGroup[];
  /** @deprecated kept for backward-compat with old saved data – prefer muscleGroups */
  muscleGroup?: MuscleGroup;
  description?: string;
  cues?: string;
  createdAt: string;
}

/** Returns the muscle groups array, handling both old single-value and new array format */
export function getWorkoutMuscleGroups(w: Workout): MuscleGroup[] {
  if (w.muscleGroups && w.muscleGroups.length > 0) return w.muscleGroups;
  if (w.muscleGroup) return [w.muscleGroup];
  return [];
}
