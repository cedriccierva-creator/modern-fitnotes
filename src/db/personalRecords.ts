/**
 * Personal records, derived from stored workout history.
 *
 * No PR rows are persisted and no schema version was added: PRs are a *view*
 * over `workoutSets`, recomputed from the same rows the workout screen edits.
 * That is what keeps them correct after a set is edited or deleted, and it
 * makes stale records structurally impossible.
 */
import { db } from './db';
import { computeExercisePr, type ExercisePR, type SetPerformance } from '../lib/pr';

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

  const days = await db.workoutDays.toArray();
  const dateByDayId = new Map(days.map((day) => [day.id, day.date]));
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
 * The PR view for one exercise: current PR, the PR-setting sets in order, and
 * their ids for marking rows. Always resolves -- an exercise with no qualifying
 * set yields `current: null` and empty lists -- so callers never branch on
 * `undefined`, and there is no state to go stale after an edit or delete.
 */
export async function getPRsForExercise(exerciseId: string): Promise<ExercisePR> {
  const history = await loadExercisePerformance(exerciseId);
  if (history.length === 0) return EMPTY_PR(exerciseId);
  return computeExercisePr(exerciseId, history);
}
