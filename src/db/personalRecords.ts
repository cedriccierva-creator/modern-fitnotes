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
  computePersonalRecords,
  recordHitsForDate,
  type PersonalRecord,
  type PrEntry,
  type SetPerformance,
} from '../lib/pr';

/** Join days, session rows and sets into the flat shape the engine consumes. */
export async function loadPrInputs(): Promise<SetPerformance[]> {
  await db.open();

  const [days, sessionRows, sets] = await Promise.all([
    db.workoutDays.toArray(),
    db.workoutExercises.toArray(),
    db.workoutSets.toArray(),
  ]);

  const dateByDayId = new Map(days.map((day) => [day.id, day.date]));
  const sessionById = new Map(
    sessionRows.map((row) => [row.id, { exerciseId: row.exerciseId, exerciseName: row.exerciseName }]),
  );

  const inputs: SetPerformance[] = [];
  for (const set of sets) {
    const session = sessionById.get(set.workoutExerciseId);
    const date = dateByDayId.get(set.workoutDayId);
    // Orphaned rows (parent removed outside the normal delete path) are skipped
    // rather than guessed at.
    if (session === undefined || date === undefined) continue;

    inputs.push({
      setId: set.id,
      workoutExerciseId: set.workoutExerciseId,
      workoutDayId: set.workoutDayId,
      exerciseId: session.exerciseId,
      exerciseName: session.exerciseName,
      date,
      setNumber: set.setNumber,
      weightKg: set.weightKg,
      reps: set.reps,
      completed: set.completed,
      createdAt: set.createdAt,
    });
  }

  return inputs;
}

/** Current PRs for every exercise with at least one qualifying completed set. */
export async function loadPersonalRecords(): Promise<PersonalRecord[]> {
  return computePersonalRecords(await loadPrInputs());
}

/**
 * Explicit recalculation entry point for edit/delete flows. It is the same
 * derivation as `loadPersonalRecords()`; the alias exists so callers can state
 * their intent and so tests can assert the two agree.
 */
export async function recalculatePersonalRecords(): Promise<PersonalRecord[]> {
  return loadPersonalRecords();
}

/** PRs for one library exercise. History survives a deleted or renamed library row. */
export async function loadExercisePersonalRecords(
  exerciseId: string,
): Promise<PersonalRecord | undefined> {
  return (await loadPersonalRecords()).find((record) => record.exerciseId === exerciseId);
}

/** PR moments achieved on one local day, e.g. to highlight them in a session. */
export async function loadRecordHitsForDate(date: string): Promise<PrEntry[]> {
  return recordHitsForDate(await loadPersonalRecords(), date);
}
