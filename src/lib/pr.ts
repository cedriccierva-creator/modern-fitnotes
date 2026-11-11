/**
 * Personal-record (PR) engine.
 *
 * Everything here is a pure function over *stored* workout sets, so results are
 * deterministic and testable without a database. The database layer
 * (src/db/personalRecords.ts) only joins rows into `SetPerformance` values.
 *
 * Design decisions that matter:
 * - Storage is always kilograms (see src/types.ts), so a pound entry that was
 *   converted on input lands on the same canonical value. `toCanonicalKg()`
 *   rounds to the same 2dp grid as `roundKg()` so 220.46 lb and 100 kg are the
 *   *same* performance and never produce a conversion PR.
 * - A tie is not an improvement: only a strictly greater value (beyond a tiny
 *   epsilon that absorbs float noise) becomes a new PR. That is what stops
 *   duplicate PRs from repeated sets.
 * - Records are never stored as rows; they are always re-derived from history.
 *   Editing or deleting a set therefore cannot leave a stale PR behind, and the
 *   correct previous best simply becomes the record again.
 * - Only completed sets count: planned or half-filled rows are not performances.
 * - Bodyweight sets (`weightKg: null`) still count as rep performances, so they
 *   are never treated as a 0 kg lift.
 */
import { lbToKg, roundKg } from './units';
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

/** Absolute tolerance when deciding whether a value actually improved. */
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
 * Normalise a weight typed in `unit` to the canonical kilogram grid.
 * Feeding the same physical weight in kg or lb yields the same number.
 */
export function toCanonicalKg(value: number, unit: WeightUnit = 'kg'): number {
  return roundKg(unit === 'lb' ? lbToKg(value) : value);
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
      return hasWeight ? roundKg(weightKg) : null;
    case 'reps':
      return hasReps ? reps : null;
    case 'volume':
      return hasWeight && hasReps ? roundKg(weightKg * reps) : null;
    case 'e1rm':
      return hasWeight && hasReps ? estimateOneRepMax(weightKg, reps) : null;
  }
}

/** Strict improvement; equal performances are explicitly not PRs. */
export function isImprovement(value: number, best: number): boolean {
  return Number.isFinite(value) && value > best + EPSILON;
}

function compareChronological(a: SetPerformance, b: SetPerformance): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
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
    const ordered = [...sets].sort(compareChronological);
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
