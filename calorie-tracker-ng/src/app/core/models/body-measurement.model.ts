export interface BodyMeasurement {
  date: string;          // YYYY-MM-DD
  weightKg?: number;
  bodyFatPct?: number;
  chestCm?: number;
  waistCm?: number;
  hipsCm?: number;
  bicepCm?: number;
  thighCm?: number;
  notes?: string;
  createdAt: string;
}
