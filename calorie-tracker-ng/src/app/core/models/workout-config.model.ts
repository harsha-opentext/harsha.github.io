export interface WorkoutConfig {
  weeklyTarget: number;
  defaultGymName?: string;
}

export const DEFAULT_WORKOUT_CONFIG: WorkoutConfig = {
  weeklyTarget: 5,
  defaultGymName: undefined,
};
