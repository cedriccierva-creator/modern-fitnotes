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
  /**
   * Phase 6A record achievements, keyed by set id.
   *
   * Optional so an `ExercisePR` built by the weight engine alone (and every
   * existing test fixture) stays valid. The database read attaches it.
   */
  achievements?: RecordAchievements;
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

/* ------------------------------------------------------------------------- *
 * Phase 6A metric primitives
 *
 * Everything below is additive: the heaviest-weight engine above is untouched
 * and keeps its exact behaviour. These are pure reductions over the same
 * `SetPerformance[]`, each answering "what is the best performance for this
 * one metric", with the same rules the weight engine already established:
 *
 * - `completed !== false`, and no orphaned row.
 * - Strict improvement only (`isImprovement`), so ties are never records.
 * - Earliest performance wins a tie: `comparePrOrder` is the only ordering, so
 *   results never depend on insertion order or a cursor.
 * - Weights stay on the canonical 0.001 kg grid; nothing here rounds a weight
 *   and nothing here reintroduces a unit.
 * - `null` rather than a sentinel for "no best yet", for the same reason the
 *   weight engine uses it: a sentinel would fail the finite check.
 *
 * Metrics are independent by design. A set can hold several records at once
 * (say a 1RM *and* an estimated-1RM best), and no metric may borrow another's
 * result: estimated 1RM is never reported as a real lift, and bodyweight sets
 * never acquire an invented load.
 * ------------------------------------------------------------------------- */

/** Rep counts tracked for exact rep-range records: 1RM through 10RM. */
export const REP_RANGE_MIN = 1;
export const REP_RANGE_MAX = 10;

/** Epley's denominator constant: `w * (1 + reps / 30)`. */
const EPLEY_DIVISOR = 30;

/**
 * The highest rep count Epley's formula is trusted for.
 *
 * Epley is fitted around low-rep, near-maximal work. Past ten reps the linear
 * term inflates fast (at 20 reps it predicts 1.67x the load, at 30 reps 2x), so
 * a long set of light work would invent a bigger "1RM" than any real single and
 * steal the record. Eleven reps and above therefore yield no estimate at all.
 *
 * Only estimation is gated: high-rep sets still set max-reps records and still
 * count toward session volume, and 1RM-10RM records are exact counts, not
 * estimates, so they are untouched.
 */
export const EPLEY_MAX_REPS = 10;

/** A set is only considered at all if it was not explicitly un-completed. */
export function isEligible(set: SetPerformance): boolean {
  return set.completed !== false;
}

/**
 * Integer reps of at least 1, or `null`.
 *
 * Reps are stored as a nullable integer, but nothing enforces the integer or
 * the sign at the storage boundary (`parseRepInput` allows 0 and rejects
 * fractions, yet rows can be written directly). Every reps-derived metric
 * funnels through here, so a fractional, zero, negative, `NaN` or missing rep
 * count is rejected once rather than being re-tested at five callsites.
 */
export function eligibleReps(set: SetPerformance): number | null {
  if (!isEligible(set)) return null;
  const reps = set.reps;
  if (reps === null || !Number.isInteger(reps) || reps < 1) return null;
  return reps;
}

/**
 * A real external load in kilograms, or `null`.
 *
 * `null` is deliberate and load-bearing: it is how a bodyweight-only set is
 * stored. This never substitutes a bodyweight estimate — an unknown load stays
 * unknown, and such a set simply cannot be a weight record.
 */
export function eligibleWeightKg(set: SetPerformance): number | null {
  if (!isEligible(set)) return null;
  const weight = set.weightKg;
  if (weight === null || !Number.isFinite(weight) || weight <= 0) return null;
  return weight;
}

/** A qualifying heaviest-weight *or* reps performance: a real load and real reps. */
function isLoadedPerformance(set: SetPerformance): boolean {
  return eligibleWeightKg(set) !== null && eligibleReps(set) !== null;
}

/* ------------------------------------------------------------------ *
 * 1. Exact rep-range records (1RM .. 10RM)
 * ------------------------------------------------------------------ */

/**
 * The winning set per exact rep count, keyed by rep count.
 *
 * Each rep count is an independent record: the best 5RM says nothing about the
 * best 3RM. Only counts inside [REP_RANGE_MIN, REP_RANGE_MAX] are reported, and
 * each count is compared only against other sets with that same rep count, so
 * a 10-rep set can never win a 3-rep record however heavy it is.
 */
export function bestByRepCount(
  history: readonly SetPerformance[],
): ReadonlyMap<number, SetPerformance> {
  const best = new Map<number, SetPerformance>();

  const ordered = history
    .filter(isLoadedPerformance)
    .slice()
    .sort(comparePrOrder);

  for (const set of ordered) {
    const reps = eligibleReps(set) as number;
    if (reps < REP_RANGE_MIN || reps > REP_RANGE_MAX) continue;

    const weight = eligibleWeightKg(set) as number;
    const current = best.get(reps);
    // Strictly heavier wins. On an equal weight the earlier set already holds
    // the record, because `ordered` is walked in canonical order.
    if (current === undefined) {
      best.set(reps, set);
      continue;
    }
    if (isImprovement(weight, eligibleWeightKg(current) as number)) best.set(reps, set);
  }

  return best;
}

/** The best set for one exact rep count, or `null`. */
export function bestForReps(
  history: readonly SetPerformance[],
  reps: number,
): SetPerformance | null {
  if (!Number.isInteger(reps) || reps < REP_RANGE_MIN || reps > REP_RANGE_MAX) return null;
  return bestByRepCount(history).get(reps) ?? null;
}

/* ------------------------------------------------------------------ *
 * 2. Estimated 1RM (Epley)
 * ------------------------------------------------------------------ */

/**
 * Epley's estimate: `weightKg * (1 + reps / 30)`.
 *
 * Returns `null` for anything that is not a real loaded performance, so a
 * bodyweight set never yields a number — there is no load to estimate from.
 * This is an *estimate* and is reported separately from the heaviest actual
 * weight, which is why it has its own type rather than widening `PrSet`.
 *
 * The result is deliberately not rounded: it is a derived statistic, not a
 * stored or re-enterable weight, and rounding it onto the 0.001 kg storage grid
 * would imply a precision the estimate does not have.
 */
export function estimatedOneRepMax(set: SetPerformance): number | null {
  const weight = eligibleWeightKg(set);
  const reps = eligibleReps(set);
  if (weight === null || reps === null) return null;
  if (reps > EPLEY_MAX_REPS) return null;
  return weight * (1 + reps / EPLEY_DIVISOR);
}

/** One estimated-1RM best for an exercise. */
export interface EstimatedOneRepMax {
  /** The set that produced the estimate. */
  setId: string;
  workoutExerciseId: string;
  workoutDayId: string;
  date: string;
  setNumber: number;
  /** The actual load lifted, in kilograms. */
  weightKg: number;
  reps: number;
  /** Epley estimate in kilograms. Derived, never stored. */
  estimatedKg: number;
}

/**
 * The highest estimated 1RM across history, or `null`.
 *
 * Ties keep the earliest set, matching every other record type.
 */
export function bestEstimatedOneRepMax(
  history: readonly SetPerformance[],
): EstimatedOneRepMax | null {
  const ordered = history
    .filter(isLoadedPerformance)
    .slice()
    .sort(comparePrOrder);

  let best: EstimatedOneRepMax | null = null;

  for (const set of ordered) {
    const estimate = estimatedOneRepMax(set);
    if (estimate === null) continue;

    if (best === null || isImprovement(estimate, best.estimatedKg)) {
      best = {
        setId: set.setId,
        workoutExerciseId: set.workoutExerciseId,
        workoutDayId: set.workoutDayId,
        date: set.date,
        setNumber: set.setNumber,
        weightKg: eligibleWeightKg(set) as number,
        reps: eligibleReps(set) as number,
        estimatedKg: estimate,
      };
    }
  }

  return best;
}

/* ------------------------------------------------------------------ *
 * 3. Maximum reps
 * ------------------------------------------------------------------ */

/** One max-reps best for an exercise. */
export interface RepsRecord {
  setId: string;
  workoutExerciseId: string;
  workoutDayId: string;
  date: string;
  setNumber: number;
  reps: number;
  /**
   * The external load actually used, or `null` for a bodyweight-only set.
   * `null` here means "not recorded", never "estimated bodyweight".
   */
  weightKg: number | null;
}

/**
 * The highest rep count ever completed, or `null`.
 *
 * This is the one metric that must work for bodyweight exercises: it never
 * looks at `weightKg`, so `weightKg: null` sets qualify on their reps alone.
 * A heavier set cannot win it and a bodyweight set never borrows a load.
 *
 * Ties keep the earliest set, as everywhere else.
 */
export function bestMaxReps(history: readonly SetPerformance[]): RepsRecord | null {
  const ordered = history
    .filter((set) => eligibleReps(set) !== null)
    .slice()
    .sort(comparePrOrder);

  let best: RepsRecord | null = null;

  for (const set of ordered) {
    const reps = eligibleReps(set) as number;
    if (best === null || reps > best.reps) {
      best = {
        setId: set.setId,
        workoutExerciseId: set.workoutExerciseId,
        workoutDayId: set.workoutDayId,
        date: set.date,
        setNumber: set.setNumber,
        reps,
        weightKg: eligibleWeightKg(set),
      };
    }
  }

  return best;
}

/* ------------------------------------------------------------------ *
 * 4. Exercise-session volume
 * ------------------------------------------------------------------ */

/** One session-volume best for an exercise. */
export interface VolumeRecord {
  workoutExerciseId: string;
  workoutDayId: string;
  /** The session's local calendar day, taken from its earliest eligible set. */
  date: string;
  /** Volume in kilogram-reps: `sum(weightKg * reps)`. */
  volumeKg: number;
  /** How many eligible sets contributed. */
  setCount: number;
}

/**
 * Volume per session, keyed by `workoutExerciseId`.
 *
 * Volume is scoped to a session rather than a single set: "best session volume"
 * is the meaningful figure, and a per-set total would only restate the heaviest
 * set. Only loaded performances contribute, so a bodyweight set adds nothing
 * rather than inventing a load. Sessions with no eligible set are omitted.
 */
export function sessionVolumes(
  history: readonly SetPerformance[],
): ReadonlyMap<string, VolumeRecord> {
  const volumes = new Map<string, VolumeRecord>();

  for (const set of [...history].sort(comparePrOrder)) {
    if (!isLoadedPerformance(set)) continue;

    const weight = eligibleWeightKg(set) as number;
    const reps = eligibleReps(set) as number;

    const current = volumes.get(set.workoutExerciseId);
    if (current === undefined) {
      volumes.set(set.workoutExerciseId, {
        workoutExerciseId: set.workoutExerciseId,
        workoutDayId: set.workoutDayId,
        date: set.date,
        volumeKg: weight * reps,
        setCount: 1,
      });
      continue;
    }

    current.volumeKg += weight * reps;
    current.setCount += 1;
  }

  return volumes;
}

/**
 * The single highest-volume session, or `null`.
 *
 * Ties keep the earlier session by its earliest contributing set, so the result
 * is deterministic regardless of input order.
 */
export function bestSessionVolume(history: readonly SetPerformance[]): VolumeRecord | null {
  let best: VolumeRecord | null = null;

  // `sessionVolumes` already yields sessions in canonical order, because it
  // inserts on each session's earliest set while walking sorted history.
  for (const volume of sessionVolumes(history).values()) {
    if (best === null || isImprovement(volume.volumeKg, best.volumeKg)) best = volume;
  }

  return best;
}

/* ------------------------------------------------------------------------- *
 * Phase 6A step 2: record achievements by set id
 *
 * One pass over the same `SetPerformance[]` the weight engine already reads
 * yields every record a set *established*, so the workout screen can mark the
 * exact set for each record type instead of showing one generic trophy.
 *
 * "Established" is the important word: a set earns an achievement at the
 * moment it sets a new all-time best. A later set that merely equals the record
 * is not an achievement, and neither is a set that is only *currently* the best
 * because an earlier set was deleted — that earlier set is the record holder,
 * and history is re-evaluated from scratch, so no achievement can go stale.
 *
 * Nothing here is stored. It is derived on every read from the same rows, so
 * nothing can drift from the workout it describes.
 * ------------------------------------------------------------------------- */

/** The record categories a single set can establish. */
export type SetRecord = 'weight' | 'estimatedOneRepMax' | 'maxReps' | `rm${number}`;

/** Every rep-count record type, as the literal union `rm1` … `rm10`. */
export type RepRangeRecord =
  | 'rm1' | 'rm2' | 'rm3' | 'rm4' | 'rm5'
  | 'rm6' | 'rm7' | 'rm8' | 'rm9' | 'rm10';

/** A session-volume record, which belongs to the session and never to a set. */
export interface VolumeAchievement {
  workoutExerciseId: string;
  workoutDayId: string;
  date: string;
  volumeKg: number;
  setCount: number;
}

/** All achievements for one exercise, plus what makes them readable. */
export interface RecordAchievements {
  /** Record types per set id, in a stable display order. */
  bySetId: ReadonlyMap<string, SetRecord[]>;
  /**
   * The records each set still *holds*, as opposed to merely established once.
   *
   * A set appears here only while it is the all-time best for that metric. This
   * is what lets a badge say "this was a record then" while a separate marker
   * says "this is the record now", without the two ever contradicting.
   */
  currentBySetId: ReadonlyMap<string, SetRecord[]>;
  /** The heaviest-weight record holder, or `null`. */
  weight: { setId: string; weightKg: number } | null;
  /** The best estimated-1RM holder, or `null` when no set can be estimated. */
  estimatedOneRepMax: EstimatedOneRepMax | null;
  /** The highest-rep holder, or `null`. The one record bodyweight can hold. */
  maxReps: RepsRecord | null;
  /** The highest session volume, which no single set owns. */
  volume: VolumeAchievement | null;
  /** Every set that established at least one record. */
  setCount: number;
  /** Human-readable names for each rep-count record, e.g. `rm8` -> `"8RM"`. */
  labels: Readonly<Record<SetRecord, string>>;
}

/** Display order: the strongest, most specific record first. */
const RECORD_ORDER: readonly SetRecord[] = [
  'weight',
  'estimatedOneRepMax',
  'maxReps',
  'rm1', 'rm2', 'rm3', 'rm4', 'rm5',
  'rm6', 'rm7', 'rm8', 'rm9', 'rm10',
];

/** The label for one record type. Kept next to the union so it cannot drift. */
export function recordLabel(record: SetRecord): string {
  if (record === 'weight') return 'Heaviest weight';
  if (record === 'estimatedOneRepMax') return 'Estimated 1RM';
  if (record === 'maxReps') return 'Most reps';
  return `${record.slice(2)}RM`;
}

/**
 * Rep-count records in 1..10 order, indexed by `reps - REP_RANGE_MIN`.
 *
 * Written as an explicit literal rather than a template string so the compiler
 * can prove every element is a `SetRecord`; `${n}` widens to `string`.
 */
const REP_RANGE_RECORDS: readonly RepRangeRecord[] = [
  'rm1', 'rm2', 'rm3', 'rm4', 'rm5',
  'rm6', 'rm7', 'rm8', 'rm9', 'rm10',
];

function sortRecords(records: Iterable<SetRecord>): SetRecord[] {
  const present = new Set(records);
  return RECORD_ORDER.filter((record) => present.has(record));
}

/**
 * Every record each set established, derived in a single pass.
 *
 * Rules, matching the weight engine exactly:
 * - Eligibility and validation come from `isEligible` / `eligibleReps` /
 *   `eligibleWeightKg`, so an incomplete set, an invented bodyweight load, or
 *   a fractional rep count can never produce a record.
 * - The first qualifying performance is the baseline and *does* earn a record.
 * - Strict improvement only, so a tie never creates a second achievement.
 * - Sets are walked in `comparePrOrder`, so equal performances break
 *   deterministically and results never depend on insertion order.
 *
 * Estimated 1RM is clamped to a floor of 1 rep for the comparison only. A
 * sub-1RM attempt may be heavier than every single, and letting it claim the
 * "estimated 1RM" slot would report a number the formula cannot honestly
 * represent. `setRecords` on such a set stays suppressed by the same clamp.
 */
export function computeRecordAchievements(
  history: readonly SetPerformance[],
): RecordAchievements {
  const bySetId = new Map<string, SetRecord[]>();
  /** Mirror of `bySetId`, holding only the records each set still holds. */
  const holders = new Map<string, SetRecord[]>();
  const ordered = [...history].sort(comparePrOrder);

  let bestWeight: number | null = null;
  let weightHolder: { setId: string; weightKg: number } | null = null;
  let bestEstimate: number | null = null;
  let bestReps: number | null = null;

  const bestByReps = new Map<number, number>();

  /**
   * Move a record to its new holder: exactly one set holds a given record at a
   * time, so the previous holder loses the claim while keeping its history.
   */
  function claim(setId: string, record: SetRecord): void {
    for (const held of holders.values()) {
      const index = held.indexOf(record);
      if (index !== -1) held.splice(index, 1);
    }
    const held = holders.get(setId);
    if (held === undefined) holders.set(setId, [record]);
    else held.push(record);
  }

  for (const set of ordered) {
    if (!isEligible(set)) continue;

    const weight = eligibleWeightKg(set);
    const reps = eligibleReps(set);
    const earned: SetRecord[] = [];

    // A. Heaviest external weight.
    if (weight !== null) {
      if (bestWeight === null || isImprovement(weight, bestWeight)) {
        bestWeight = weight;
        weightHolder = { setId: set.setId, weightKg: weight };
        earned.push('weight');
        claim(set.setId, 'weight');
      }
    }

    // B. Exact rep-range records, each count independent of the others.
    if (weight !== null && reps !== null && reps >= REP_RANGE_MIN && reps <= REP_RANGE_MAX) {
      const previous = bestByReps.get(reps);
      if (previous === undefined || isImprovement(weight, previous)) {
        bestByReps.set(reps, weight);
        const record = REP_RANGE_RECORDS[reps - REP_RANGE_MIN];
        earned.push(record);
        claim(set.setId, record);
      }
    }

    // C. Estimated 1RM. Delegates to `estimatedOneRepMax` so the rep cap and
    // the formula have exactly one definition; a second inline copy could drift.
    const estimate = estimatedOneRepMax(set);
    if (estimate !== null) {
      if (bestEstimate === null || isImprovement(estimate, bestEstimate)) {
        bestEstimate = estimate;
        earned.push('estimatedOneRepMax');
        claim(set.setId, 'estimatedOneRepMax');
      }
    }

    // D. Maximum reps. The one record a bodyweight-only set can earn.
    if (reps !== null && (bestReps === null || reps > bestReps)) {
      bestReps = reps;
      earned.push('maxReps');
      claim(set.setId, 'maxReps');
    }

    if (earned.length > 0) bySetId.set(set.setId, sortRecords(earned));
  }

  // E. Session volume: belongs to the session, so it is never attached to a set.
  const volume = bestSessionVolume(history);

  // Current holders for the metrics with no set-level badge of their own, so the
  // exercise header can show them without a second pass over history.
  const estimateHolder = bestEstimatedOneRepMax(history);
  const repsHolder = bestMaxReps(history);

  const labels = Object.fromEntries(
    RECORD_ORDER.map((record) => [record, recordLabel(record)]),
  ) as Record<SetRecord, string>;

  const currentBySetId = new Map<string, SetRecord[]>();
  for (const [setId, held] of holders) {
    if (held.length > 0) currentBySetId.set(setId, sortRecords(held));
  }

  return {
    bySetId,
    currentBySetId,
    weight: weightHolder,
    estimatedOneRepMax: estimateHolder,
    maxReps: repsHolder,
    volume:
      volume === null
        ? null
        : {
            workoutExerciseId: volume.workoutExerciseId,
            workoutDayId: volume.workoutDayId,
            date: volume.date,
            volumeKg: volume.volumeKg,
            setCount: volume.setCount,
          },
    setCount: bySetId.size,
    labels,
  };
}

/**
 * The records one set established, or an empty list.
 *
 * The single lookup the UI needs, so a component never has to interpret the
 * achievement map itself.
 */
export function setRecords(achievements: RecordAchievements, setId: string): SetRecord[] {
  return achievements.bySetId.get(setId) ?? [];
}
