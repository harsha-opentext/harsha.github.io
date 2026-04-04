import { Session, SessionEntry, WorkoutSet } from '../../core/models/session.model';

/**
 * Volume = sum of (reps × weightKg) for all non-warmup sets in a SessionEntry.
 * Warm-up sets (isWarmup: true) are excluded from the calculation.
 * Cardio entries that have no sets contribute 0 volume.
 */
export function calculateEntryVolume(entry: SessionEntry): number {
  return entry.sets
    .filter(s => !s.isWarmup)
    .reduce((acc, s) => acc + s.reps * s.weightKg, 0);
}

/**
 * Total volume across all entries in a session.
 */
export function calculateSessionVolume(session: Session): number {
  return session.entries.reduce((acc, e) => acc + calculateEntryVolume(e), 0);
}

/**
 * Estimated 1-Rep Max using the Epley formula: weight × (1 + reps / 30).
 * Returns 0 if no non-warmup sets exist.
 */
export function calculateEstimated1RM(sets: WorkoutSet[]): number {
  const working = sets.filter(s => !s.isWarmup && s.reps > 0 && s.weightKg > 0);
  if (working.length === 0) return 0;
  return Math.max(...working.map(s => s.weightKg * (1 + s.reps / 30)));
}
