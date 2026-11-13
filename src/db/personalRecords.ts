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
