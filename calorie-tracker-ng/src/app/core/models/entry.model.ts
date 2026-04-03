export interface Entry {
  timestamp: string;
  date: string;
  food: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  healthScore?: number;
  time?: string;
  _sourceDate?: string;
  _meta?: undefined;
  [key: string]: unknown;
}

export interface WeightEntry {
  _meta: 'dailyWeight';
  weightKg: number;
  weight?: number;
  timestamp: string;
  date: string;
  _sourceDate?: string;
  [key: string]: unknown;
}

export type AnyEntry = Entry | WeightEntry;

export function isWeightEntry(e: AnyEntry): e is WeightEntry {
  return (e as WeightEntry)._meta === 'dailyWeight';
}
