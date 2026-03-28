export interface Entry {
  timestamp: number;
  date: string; // YYYY-MM-DD format
  food: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  meal_type?: string;
  notes?: string;
  [key: string]: any; // Allow dynamic schema fields
}

export interface DailyData {
  date: string;
  entries: Entry[];
  sha?: string; // GitHub file SHA for updates
}
