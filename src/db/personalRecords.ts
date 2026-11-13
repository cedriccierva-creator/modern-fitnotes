/**
 * Personal records, derived from stored workout history.
 *
 * No PR rows are persisted and no schema version was added: PRs are a *view*
 * over `workoutSets`, recomputed from the same rows the workout screen edits.
 * That is what keeps them correct after a set is edited or deleted, and it
 * makes stale records structurally impossible.
 */
import { db } from './db';
import {
  computeExercisePrView,
  type ExercisePR,
  type SetPerformance,
} from '../lib/pr';

const EMPTY_PR = (exerciseId: string): ExercisePR => ({
  exerciseId,
  exerciseName: '',
  current: null,
  history: [],
  trophySetIds: [],
});

/**
 * Join one exercise's session rows, sets and days into the flat shape the
 * engine consumes. Scoped by exerciseId so a PR read never scans every set in
 * the database.
 */
export async function loadExercisePerformance(exerciseId: string): Promise<SetPerformance[]> {
  await db.open();

  const sessions = await db.workoutExercises.where('exerciseId').equals(exerciseId).toArray();
  if (sessions.length === 0) return [];

  const sets = await db.workoutSets
    .where('workoutExerciseId')
    .anyOf(sessions.map((session) => session.id))
    .toArray();
  if (sets.length === 0) return [];

  // Fetch only the days these sets reference, in one indexed read, rather than
  // scanning the whole workoutDays table on every PR read. Keys come from the
  // sets (not the sessions) because the join below looks up set.workoutDayId.
  const dayIds = [...new Set(sets.map((set) => set.workoutDayId))];
  const days = await db.workoutDays.bulkGet(dayIds);
  const dateByDayId = new Map<string, string>();
  for (const day of days) {
    // A missing day is an orphan: bulkGet yields undefined, skipped below.
    if (day !== undefined) dateByDayId.set(day.id, day.date);
  }
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  const performance: SetPerformance[] = [];
  for (const set of sets) {
    const session = sessionById.get(set.workoutExerciseId);
    const date = dateByDayId.get(set.workoutDayId);
    // Orphaned rows are skipped rather than guessed at.
    if (session === undefined || date === undefined) continue;

    performance.push({
      setId: set.id,
      workoutExerciseId: set.workoutExerciseId,
      workoutDayId: set.workoutDayId,
      exerciseId,
      exerciseName: session.exerciseName,
      date,
      exerciseOrder: session.order,
      setNumber: set.setNumber,
      weightKg: set.weightKg,
      reps: set.reps,
      completed: set.completed,
      createdAt: set.createdAt,
    });
  }

  return performance;
}

/**
 * Join *several* exercises' sessions, sets and days in three reads.
 *
 * The single-exercise loader above issues three reads per exercise, and a logged
 * day holds several exercises: a refresh therefore cost 3N reads and re-read the
 * same `workoutDays` rows once per exercise. The join is identical here, just
 * widened:
 *
 *  - one `exerciseId` `anyOf` for every session row of every requested exercise,
 *  - one `workoutExerciseId` `anyOf` for every set of those sessions,
 *  - one `bulkGet` for the *union* of referenced days (still referenced-only,
 *    never a whole-table scan, so Optimization 3's rule is kept -- and now shared
 *    instead of repeated per exercise).
 *
 * The join rules are unchanged: `exerciseId` comes from the session row, and a
 * set whose day or session row is missing is an orphan and is skipped rather
 * than guessed at.
 */
async function loadPerformanceForExercises(
  exerciseIds: readonly string[],
): Promise<Map<string, SetPerformance[]>> {
  await db.open();

  // Every requested exercise gets a bucket, so "no history" stays
  // distinguishable from "not requested".
  const byExercise = new Map<string, SetPerformance[]>();
  for (const exerciseId of exerciseIds) byExercise.set(exerciseId, []);

  // Read 1: every session row of every requested exercise.
  const sessions = await db.workoutExercises
    .where('exerciseId')
    .anyOf([...exerciseIds])
    .toArray();
  if (sessions.length === 0) return byExercise;

  // Read 2: every set belonging to those sessions.
  const sets = await db.workoutSets
    .where('workoutExerciseId')
    .anyOf(sessions.map((session) => session.id))
    .toArray();
  if (sets.length === 0) return byExercise;

  // Read 3: the union of the days those sets reference, once for all exercises.
  const dayIds = [...new Set(sets.map((set) => set.workoutDayId))];
  const days = await db.workoutDays.bulkGet(dayIds);
  const dateByDayId = new Map<string, string>();
  for (const day of days) {
    // A missing day is an orphan: bulkGet yields undefined, skipped below.
    if (day !== undefined) dateByDayId.set(day.id, day.date);
  }

  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  for (const set of sets) {
    const session = sessionById.get(set.workoutExerciseId);
    const date = dateByDayId.get(set.workoutDayId);
    // Orphaned rows are skipped rather than guessed at.
    if (session === undefined || date === undefined) continue;

    // Scoped by the session that owns the set, so a set can only ever feed its
    // own exercise's records.
    const bucket = byExercise.get(session.exerciseId);
    if (bucket === undefined) continue;

    bucket.push({
      setId: set.id,
      workoutExerciseId: set.workoutExerciseId,
      workoutDayId: set.workoutDayId,
      exerciseId: session.exerciseId,
      exerciseName: session.exerciseName,
      date,
      exerciseOrder: session.order,
      setNumber: set.setNumber,
      weightKg: set.weightKg,
      reps: set.reps,
      completed: set.completed,
      createdAt: set.createdAt,
    });
  }

  return byExercise;
}

/**
 * The PR view for one exercise: current PR, the PR-setting sets in order, their
 * ids for marking rows, and (Phase 6A) every record achievement by set id.
 * Always resolves -- an exercise with no qualifying set yields `current: null`
 * and empty lists -- so callers never branch on `undefined`, and there is no
 * state to go stale after an edit or delete.
 *
 * The achievements are derived from the same in-memory `history` the weight
 * engine just read, so this adds one linear pass and **no extra query**. Only
 * `workoutSets` and its parents are read; `plannedDays` is never touched, so a
 * planned day can never influence a record.
 *
 * The weight engine and the achievement pass share one ordering of that
 * history (`computeExercisePrView`), so the rows are sorted once per read
 * instead of once per metric.
 */
export async function getPRsForExercise(exerciseId: string): Promise<ExercisePR> {
  const history = await loadExercisePerformance(exerciseId);
  if (history.length === 0) return EMPTY_PR(exerciseId);

  const { pr, achievements } = computeExercisePrView(exerciseId, history);
  return { ...pr, achievements };
}

/**
 * PR views for several exercises from three shared reads, instead of three
 * reads each.
 *
 * The returned map keeps the per-exercise contract of `getPRsForExercise`:
 *
 *  - **Present** means the read succeeded. An exercise with no qualifying set
 *    is present with an `EMPTY_PR` (`current: null`, empty lists), exactly as
 *    before, so "nothing logged yet" never looks like a failure.
 *  - **Absent** means that exercise failed, so the UI shows no PR rather than a
 *    stale or partial one.
 *
 * Failure isolation, in the order it applies:
 *
 *  1. A shared read failing (sessions, sets or days) discards the whole batch --
 *     nothing partial escapes -- and re-runs the original per-exercise reads
 *     under `Promise.allSettled`, which is the pre-batching behaviour: one
 *     failing exercise is left out of the map while the others still resolve.
 *  2. On a successful batch, each exercise's calculation is wrapped on its own,
 *     so one exercise throwing cannot cost the others their records.
 *
 * This never rejects: both layers resolve to a map.
 */
export async function getPRsForExercises(
  exerciseIds: readonly string[],
): Promise<ReadonlyMap<string, ExercisePR>> {
  const ids = [...new Set(exerciseIds)];
  if (ids.length === 0) return new Map<string, ExercisePR>();

  let performance: Map<string, SetPerformance[]>;
  try {
    performance = await loadPerformanceForExercises(ids);
  } catch {
    // A shared stage failed: the batch is abandoned entirely, never merged with
    // the fallback's answers.
    return loadPrsIndividually(ids);
  }

  const prs = new Map<string, ExercisePR>();
  for (const exerciseId of ids) {
    const history = performance.get(exerciseId) ?? [];

    if (history.length === 0) {
      prs.set(exerciseId, EMPTY_PR(exerciseId));
      continue;
    }

    try {
      const { pr, achievements } = computeExercisePrView(exerciseId, history);
      prs.set(exerciseId, { ...pr, achievements });
    } catch {
      // Omitted on purpose: this exercise shows no PR, the rest keep theirs.
    }
  }

  return prs;
}

/**
 * The pre-batching path: one isolated read per exercise.
 *
 * `allSettled` is what makes the isolation work -- a rejection is captured per
 * exercise instead of rejecting the whole call -- so the fallback can never
 * surface an unhandled rejection, and a single failed exercise is simply absent
 * from the map.
 */
async function loadPrsIndividually(
  exerciseIds: readonly string[],
): Promise<Map<string, ExercisePR>> {
  const prs = new Map<string, ExercisePR>();
  const results = await Promise.allSettled(exerciseIds.map((id) => getPRsForExercise(id)));

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') prs.set(exerciseIds[index], result.value);
  });

  return prs;
}
