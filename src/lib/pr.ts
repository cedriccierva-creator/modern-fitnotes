/**
 * Personal-record (PR) engine.
 *
 * Everything here is a pure function over *stored* workout sets, so results are
 * deterministic and testable without a database. The database layer
 * (src/db/personalRecords.ts) only joins rows into `SetPerformance` values.
 *
 * Design decisions that matter:
 * - Storage is always kilograms at 0.01 kg (see `roundKg`), so a pound entry
 *   converted on input lands on the same stored value as the equivalent kg
 *   entry and never produces a conversion PR. Comparison happens on those
 *   stored values with a float epsilon only -- there is no separate rounding
 *   grid, so nothing can be lost between storage and comparison.
 * - A tie is not an improvement: only a strictly greater value (beyond a tiny
 *   epsilon that absorbs float noise) becomes a new PR. That is what stops
 *   duplicate PRs from repeated sets.
 * - Records are never stored as rows; they are always re-derived from history.
 *   Editing or deleting a set therefore cannot leave a stale PR behind, and the
 *   correct previous best simply becomes the record again.
 * - Only completed sets count: planned or half-filled rows are not performances.
 * - Bodyweight sets (`weightKg: null`) still count as rep performances, so they
 *   are never treated as a 0 kg lift.
 * - Ordering is *explicit*, never inherited from a Dexie index scan: sets sort
 *   by (date, exercise position in the session, setNumber, createdAt, id).
 *   A workoutDay's `date` is unique in the schema, but an exercise may appear
 *   more than once in a day (two WorkoutExercise rows), so the session position
 *   is what decides between them.
 */
import { parseWeightInput, roundKg } from './units';
import type { WeightUnit } from '../types';

/** Metrics the existing data model can express: weight, reps, set volume, estimated 1RM. */
export const PR_METRICS = ['weight', 'reps', 'volume', 'e1rm'] as const;
export type PrMetric = (typeof PR_METRICS)[number];

export const PR_METRIC_LABELS: Record<PrMetric, string> = {
  weight: 'Heaviest weight',
  reps: 'Most reps',
  volume: 'Best set volume',
  e1rm: 'Best estimated 1RM',
};

/**
 * Float tolerance for the comparison.
 *
 * Stored weights already sit on the 0.01 kg grid produced by `roundKg`, so the
 * only difference a genuine tie can show is binary-float noise (0.01 kg is not
 * representable exactly). The epsilon is far below the 0.01 kg storage step, so
 * it can never absorb a real 0.01 kg improvement: 102.07 vs 102.06 still wins.
 */
const EPSILON = 1e-9;

/**
 * One stored set, flattened with the exercise/date it belongs to.
 * `exerciseId` is the library id; `exerciseName` is the historical snapshot.
 */
export interface SetPerformance {
  setId: string;
  workoutExerciseId: string;
  workoutDayId: string;
  exerciseId: string;
  exerciseName: string;
  /** Local calendar day, "YYYY-MM-DD". */
  date: string;
  /** Position of this exercise row within its session (WorkoutExercise.order). */
  exerciseOrder: number;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  completed?: boolean;
  createdAt?: number;
}

/** One PR moment. `value` is canonical: kg, reps, kg·reps or kg. */
export interface PrEntry {
  metric: PrMetric;
  exerciseId: string;
  exerciseName: string;
  value: number;
  weightKg: number | null;
  reps: number | null;
  setId: string;
  workoutDayId: string;
  date: string;
  setNumber: number;
}

export interface PersonalRecord {
  exerciseId: string;
  exerciseName: string;
  /** Current best per metric. Absent metrics have no qualifying set. */
  metrics: Partial<Record<PrMetric, PrEntry>>;
  /** Chronological PR progression across all metrics, strictly improving. */
  improvements: PrEntry[];
}

/**
 * What a weight typed in `unit` is stored as, i.e. the same path the UI uses
 * (`parseWeightInput` -> `lbToKg` -> `roundKg`). Provided so callsites and tests
 * express unit equivalence through one function; it defines no new grid.
 */
export function toCanonicalKg(value: number, unit: WeightUnit = 'kg'): number {
  return parseWeightInput(String(value), unit) ?? 0;
}

/** Epley estimate, rounded like every other stored weight. Reps of 1 are the lift itself. */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (!(weightKg > 0) || !(reps > 0)) return 0;
  return roundKg(reps === 1 ? weightKg : weightKg * (1 + reps / 30));
}

/** The comparable value of one set for one metric, or null when it does not qualify. */
export function metricValue(
  metric: PrMetric,
  weightKg: number | null,
  reps: number | null,
): number | null {
  const hasWeight = weightKg !== null && Number.isFinite(weightKg) && weightKg > 0;
  const hasReps = reps !== null && Number.isInteger(reps) && reps > 0;

  switch (metric) {
    case 'weight':
      // Compare the stored value as-is; `roundKg` here would be a second grid.
      return hasWeight ? weightKg : null;
    case 'reps':
      return hasReps ? reps : null;
    case 'volume':
      return hasWeight && hasReps ? roundKg(weightKg * reps) : null;
    case 'e1rm':
      return hasWeight && hasReps ? estimateOneRepMax(weightKg, reps) : null;
  }
}

/** Strict improvement; equal performances (within float noise) are not PRs. */
export function isImprovement(value: number, best: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(best)) return false;
  return value - best > EPSILON;
}

/**
 * The one ordering the engine uses: (date, exercise position, setNumber,
 * createdAt, id).
 *
 * Nothing here relies on IndexedDB cursor order, which is key order on
 * [index, primaryKey] and carries no insertion guarantee. `id` is the final
 * tiebreak so the sort is total: two sets can never compare equal, so the same
 * history always produces the same records whatever order it is fed in.
 */
export function comparePrOrder(a: SetPerformance, b: SetPerformance): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.exerciseOrder !== b.exerciseOrder) return a.exerciseOrder - b.exerciseOrder;
  if (a.setNumber !== b.setNumber) return a.setNumber - b.setNumber;
  const aCreated = a.createdAt ?? 0;
  const bCreated = b.createdAt ?? 0;
  if (aCreated !== bCreated) return aCreated - bCreated;
  return a.setId < b.setId ? -1 : a.setId > b.setId ? 1 : 0;
}

function toEntry(metric: PrMetric, set: SetPerformance, value: number): PrEntry {
  return {
    metric,
    exerciseId: set.exerciseId,
    exerciseName: set.exerciseName,
    value,
    weightKg: set.weightKg,
    reps: set.reps,
    setId: set.setId,
    workoutDayId: set.workoutDayId,
    date: set.date,
    setNumber: set.setNumber,
  };
}

/**
 * Recalculate every PR from the full set history.
 *
 * History is replayed in chronological order, so the result always reflects the
 * current rows: if the set behind a PR is edited down or deleted, the previous
 * best naturally takes over, and nothing is carried over from a stale state.
 */
export function computePersonalRecords(inputs: readonly SetPerformance[]): PersonalRecord[] {
  const groups = new Map<string, SetPerformance[]>();

  for (const input of inputs) {
    if (input.completed === false) continue;
    if (input.exerciseId === undefined || input.exerciseId === '') continue;
    const bucket = groups.get(input.exerciseId);
    if (bucket) bucket.push(input);
    else groups.set(input.exerciseId, [input]);
  }

  const records: PersonalRecord[] = [];

  for (const [exerciseId, sets] of groups) {
    const ordered = [...sets].sort(comparePrOrder);
    const best = new Map<PrMetric, PrEntry>();
    const improvements: PrEntry[] = [];
    let exerciseName = '';

    for (const set of ordered) {
      if (set.exerciseName.trim() !== '') exerciseName = set.exerciseName;

      for (const metric of PR_METRICS) {
        const value = metricValue(metric, set.weightKg, set.reps);
        if (value === null) continue;

        const current = best.get(metric);
        if (current !== undefined && !isImprovement(value, current.value)) continue;

        const entry = toEntry(metric, set, value);
        best.set(metric, entry);
        improvements.push(entry);
      }
    }

    if (best.size === 0) continue;

    const metrics: Partial<Record<PrMetric, PrEntry>> = {};
    for (const [metric, entry] of best) metrics[metric] = entry;

    records.push({ exerciseId, exerciseName, metrics, improvements });
  }

  return records.sort(
    (a, b) => a.exerciseName.localeCompare(b.exerciseName) || a.exerciseId.localeCompare(b.exerciseId),
  );
}

/** The current PR for one exercise/metric, if one exists. */
export function personalRecordFor(
  records: readonly PersonalRecord[],
  exerciseId: string,
  metric: PrMetric,
): PrEntry | undefined {
  return records.find((record) => record.exerciseId === exerciseId)?.metrics[metric];
}

/** Every PR moment achieved on a given local day, oldest first. */
export function recordHitsForDate(
  records: readonly PersonalRecord[],
  date: string,
): PrEntry[] {
  return records
    .flatMap((record) => record.improvements)
    .filter((entry) => entry.date === date)
    .sort((a, b) => a.setNumber - b.setNumber || PR_METRICS.indexOf(a.metric) - PR_METRICS.indexOf(b.metric));
}
