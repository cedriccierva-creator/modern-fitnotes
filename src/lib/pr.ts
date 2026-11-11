/**
 * Personal-record (PR) engine: weight only.
 *
 * Pure functions over *stored* workout sets, so results are deterministic and
 * testable without a database. The database layer (src/db/personalRecords.ts)
 * only joins rows into `SetPerformance` values.
 *
 * Rules, all deliberate:
 * - Only a completed set with a recorded weight > 0 is a performance. Blank
 *   weights, bodyweight entries and uncompleted rows never set a PR.
 * - Ties never count: a weight must beat the earlier all-time best strictly
 *   (beyond float noise). Equal weights, whether across days or within one
 *   workout, never produce a second PR.
 * - One trophy per exercise per workout day: the heaviest set that beats the
 *   earlier all-time best. On a tie inside the day, the earliest set wins.
 * - Weights are stored in kilograms at 0.001 kg (`roundKg`, src/lib/units.ts),
 *   so comparisons use the stored value with a float epsilon and no second
 *   rounding grid: this file never rounds a weight.
 * - Ordering is explicit -- (date, exercise position, setNumber, createdAt, id)
 *   -- never inherited from a Dexie index scan, which is [index, primaryKey]
 *   order and therefore uuid order.
 * - PRs are never persisted. They are re-derived from history every time, so
 *   editing or deleting the set behind a PR promotes the correct previous best
 *   and no stale record can survive.
 */
import { parseWeightInput } from './units';
import type { WeightUnit } from '../types';

/**
 * Float tolerance for comparison.
 *
 * Stored weights already sit on the 0.001 kg grid produced by `roundKg`; the
 * only difference a true tie can show is binary-float noise, which is far below
 * the epsilon. A real 0.001 kg step (102.059 vs 102.058) always wins.
 */
const EPSILON = 1e-9;

/**
 * One stored set, flattened with the exercise and day it belongs to.
 * `exerciseName` is the historical snapshot from the session row.
 */
export interface SetPerformance {
  setId: string;
  workoutExerciseId: string;
  workoutDayId: string;
  exerciseId: string;
  exerciseName: string;
  /** Local calendar day, "YYYY-MM-DD". Unique per WorkoutDay. */
  date: string;
  /** Position of the session row within its day (WorkoutExercise.order). */
  exerciseOrder: number;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  completed: boolean;
  createdAt: number;
}

/** A PR-setting set ("trophy"). */
export interface PrSet {
  setId: string;
  workoutExerciseId: string;
  workoutDayId: string;
  date: string;
  setNumber: number;
  weightKg: number;
  reps: number | null;
}

/** What the UI and tests consume for one exercise. */
export interface ExercisePR {
  exerciseId: string;
  exerciseName: string;
  /** The heaviest qualifying set ever, or null when there is none. */
  current: PrSet | null;
  /** PR-setting sets in chronological order, one per PR day at most. */
  history: PrSet[];
  /** Ids of the trophy sets, for marking rows in the session view. */
  trophySetIds: string[];
}

/** A set only counts if it was completed and carries a real weight. */
export function qualifies(set: SetPerformance): boolean {
  if (set.completed === false) return false;
  return set.weightKg !== null && Number.isFinite(set.weightKg) && set.weightKg > 0;
}

/**
 * The one ordering the engine uses: (date, exercise position, setNumber,
 * createdAt, id). `id` makes the sort total, so the same history always yields
 * the same records regardless of the order rows are fed in.
 */
export function comparePrOrder(a: SetPerformance, b: SetPerformance): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.exerciseOrder !== b.exerciseOrder) return a.exerciseOrder - b.exerciseOrder;
  if (a.setNumber !== b.setNumber) return a.setNumber - b.setNumber;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.setId < b.setId ? -1 : a.setId > b.setId ? 1 : 0;
}

/** Strict improvement; equal performances (within float noise) are not PRs. */
export function isImprovement(value: number, best: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(best)) return false;
  return value - best > EPSILON;
}

/**
 * What a weight typed in `unit` is stored as, through the real input path
 * (`parseWeightInput` -> `lbToKg` -> `roundKg`). Unit equivalence lives here so
 * callsites and tests share one definition; it introduces no new grid -- the
 * only grid is `roundKg`'s 0.001 kg.
 */
export function toCanonicalKg(value: number, unit: WeightUnit = 'kg'): number {
  return parseWeightInput(String(value), unit) ?? 0;
}

function toPrSet(set: SetPerformance): PrSet {
  return {
    setId: set.setId,
    workoutExerciseId: set.workoutExerciseId,
    workoutDayId: set.workoutDayId,
    date: set.date,
    setNumber: set.setNumber,
    // `qualifies()` has already proved this is a finite positive number.
    weightKg: set.weightKg as number,
    reps: set.reps,
  };
}

/**
 * Recompute one exercise's PRs from its full history.
 *
 * Days are walked in date order; inside a day the sets are walked in explicit
 * order and the heaviest set that beats the running best becomes that day's
 * single trophy. Sets that tie are skipped, so a repeated weight never adds a
 * record, and the earliest set wins a tie inside one day.
 */
export function computeExercisePr(
  exerciseId: string,
  history: readonly SetPerformance[],
): ExercisePR {
  const qualifying = history.filter(
    (set) => set.exerciseId === exerciseId && qualifies(set),
  );
  const ordered = [...qualifying].sort(comparePrOrder);

  const trophies: PrSet[] = [];
  // null rather than -Infinity: `isImprovement` refuses non-finite input, so a
  // sentinel would silently reject the very first performance.
  let best: number | null = null;
  let index = 0;

  while (index < ordered.length) {
    const date = ordered[index].date;
    let dayCandidate: SetPerformance | null = null;

    // One pass over this calendar day.
    while (index < ordered.length && ordered[index].date === date) {
      const set = ordered[index];
      const weight = set.weightKg as number;
      if (best === null || isImprovement(weight, best)) {
        // Heaviest set of the day that beats the earlier all-time best; on an
        // internal tie the earliest set keeps the trophy.
        if (
          dayCandidate === null ||
          isImprovement(weight, dayCandidate.weightKg as number)
        ) {
          dayCandidate = set;
        }
      }
      index += 1;
    }

    if (dayCandidate !== null) {
      best = dayCandidate.weightKg as number;
      trophies.push(toPrSet(dayCandidate));
    }
  }

  // The name comes from the most recent snapshot, matching how the app shows a
  // session row after a rename.
  const named = [...ordered].reverse().find((set) => set.exerciseName.trim() !== '');

  return {
    exerciseId,
    exerciseName: named?.exerciseName ?? '',
    current: trophies.length === 0 ? null : trophies[trophies.length - 1],
    history: trophies,
    trophySetIds: trophies.map((set) => set.setId),
  };
}

/** Recompute every exercise that has at least one qualifying set. */
export function computeAllPrs(inputs: readonly SetPerformance[]): ExercisePR[] {
  const byExercise = new Map<string, SetPerformance[]>();
  for (const set of inputs) {
    if (set.exerciseId === '' || !qualifies(set)) continue;
    const bucket = byExercise.get(set.exerciseId);
    if (bucket) bucket.push(set);
    else byExercise.set(set.exerciseId, [set]);
  }

  return [...byExercise.keys()]
    .map((exerciseId) => computeExercisePr(exerciseId, byExercise.get(exerciseId) as SetPerformance[]))
    .sort(
      (a, b) =>
        a.exerciseName.localeCompare(b.exerciseName) || a.exerciseId.localeCompare(b.exerciseId),
    );
}
