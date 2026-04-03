export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  currentStartDate?: string | null;
  currentEndDate?: string | null;
  longestStartDate?: string | null;
  longestEndDate?: string | null;
  computedAt: string | null;
  activeDates: string[];
  recentActiveDates?: string[];
}
