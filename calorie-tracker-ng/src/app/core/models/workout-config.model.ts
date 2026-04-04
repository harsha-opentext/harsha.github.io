export interface WorkoutConfig {
  weeklyTarget: number;
  defaultGymName?: string;
  /** Default rest duration in seconds used by the rest timer (default: 90) */
  defaultRestSeconds?: number;
}

export const DEFAULT_WORKOUT_CONFIG: WorkoutConfig = {
  weeklyTarget: 5,
  defaultGymName: undefined,
  defaultRestSeconds: 90,
};
