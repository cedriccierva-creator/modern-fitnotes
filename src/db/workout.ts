import { db } from './db';
import { newId } from '../lib/id';
import { findIntensity, generateSets } from '../lib/intensity';
import { roundKg } from '../lib/units';
import type { Exercise, WorkoutCategory, WorkoutDay, WorkoutExercise, WorkoutSet } from '../types';

/** One logged exercise with its sets, ordered for rendering. */
export interface SessionExercise extends WorkoutExercise {
  sets: WorkoutSet[];
}

export interface DayDetails {
  day: WorkoutDay | null;
  exercises: SessionExercise[];
}

/** Lazily create the day row for a local date. A date without exercises has none. */
export async function ensureWorkoutDay(date: string): Promise<WorkoutDay> {
  await db.open();
  const existing = await db.workoutDays.where('date').equals(date).first();
  if (existing) return existing;

  const now = Date.now();
  const day: WorkoutDay = { id: newId(), date, createdAt: now, updatedAt: now };
  await db.workoutDays.add(day);
  return day;
}

export async function loadDay(date: string): Promise<DayDetails> {
  const day = (await db.workoutDays.where('date').equals(date).first()) ?? null;
  if (day === null) return { day: null, exercises: [] };

  const rows = await db.workoutExercises.where('workoutDayId').equals(day.id).toArray();
  const byOrder = rows.sort((a, b) => a.order - b.order);

  const setsByExercise = new Map<string, WorkoutSet[]>();
  for (const set of await db.workoutSets.where('workoutDayId').equals(day.id).toArray()) {
    const bucket = setsByExercise.get(set.workoutExerciseId);
    if (bucket) bucket.push(set);
    else setsByExercise.set(set.workoutExerciseId, [set]);
  }
  for (const bucket of setsByExercise.values()) {
    bucket.sort((a, b) => a.setNumber - b.setNumber);
  }

  return {
    day,
    exercises: byOrder.map((row) => ({ ...row, sets: setsByExercise.get(row.id) ?? [] })),
  };
}

/** Persisted order, top to bottom, for one day's exercises. */
export async function reorderExercises(dayId: string, orderedIds: readonly string[]): Promise<void> {
  const rows = await db.workoutExercises.where('workoutDayId').equals(dayId).toArray();
  const known = new Set(rows.map((row) => row.id));

  await db.transaction('rw', db.workoutExercises, async () => {
    // Only the rows that belong to this day, so a stale id cannot reorder it.
    const safe = orderedIds.filter((id) => known.has(id));
    for (const [index, id] of safe.entries()) {
      await db.workoutExercises.update(id, { order: index, updatedAt: Date.now() });
    }
  });
}

/**
 * Attach an exercise to a day and generate its set rows from the intensity.
 *
 * The name is copied into the session row, so later renames of the library
 * exercise never appear retroactively in this workout.
 */
export async function addExerciseToDay(
  date: string,
  exercise: Exercise,
  intensityId: Parameters<typeof findIntensity>[0],
): Promise<SessionExercise> {
  const day = await ensureWorkoutDay(date);
  const preset = findIntensity(intensityId);
  const existing = await db.workoutExercises.where('workoutDayId').equals(day.id).toArray();
  const nextOrder = existing.reduce((max, row) => Math.max(max, row.order), -1) + 1;
  const highestSet = (await db.workoutSets.where('workoutDayId').equals(day.id).toArray()).reduce(
    (max, set) => Math.max(max, set.setNumber),
    0,
  );

  const now = Date.now();
  const row: WorkoutExercise = {
    id: newId(),
    workoutDayId: day.id,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    order: nextOrder,
    note: `${preset.name} · ${preset.hint}`,
    createdAt: now,
    updatedAt: now,
  };

  const sets: WorkoutSet[] = generateSets(preset).map((generated) => ({
    id: newId(),
    workoutExerciseId: row.id,
    workoutDayId: day.id,
    setNumber: highestSet + generated.setNumber,
    weightKg: null,
    reps: generated.reps,
    completed: false,
    createdAt: now,
    updatedAt: now,
  }));

  await db.workoutExercises.add(row);
  await db.workoutSets.bulkAdd(sets);

  return { ...row, sets };
}

/** Add more sets to an existing exercise, continuing its numbering. */
export async function addSetsToExercise(
  workoutExerciseId: string,
  count: number,
  reps: number,
): Promise<WorkoutSet[]> {
  const parent = await db.workoutExercises.get(workoutExerciseId);
  if (!parent) throw new Error(`Workout exercise not found: ${workoutExerciseId}`);

  const siblings = await db.workoutSets.where('workoutExerciseId').equals(workoutExerciseId).toArray();
  const highest = siblings.reduce((max, set) => Math.max(max, set.setNumber), 0);
  const now = Date.now();

  const created: WorkoutSet[] = Array.from({ length: count }, (_, index) => ({
    id: newId(),
    workoutExerciseId,
    workoutDayId: parent.workoutDayId,
    setNumber: highest + index + 1,
    weightKg: null,
    reps,
    completed: false,
    createdAt: now,
    updatedAt: now,
  }));

  await db.workoutSets.bulkAdd(created);
  return created;
}

export type SetPatch = { weightKg?: number | null; reps?: number | null; completed?: boolean };

/** Patch one set. Nulls clear the value rather than storing 0. */
export async function updateSet(id: string, patch: SetPatch): Promise<void> {
  const next: SetPatch = {};
  if (patch.weightKg !== undefined) {
    next.weightKg = patch.weightKg === null ? null : roundKg(patch.weightKg);
  }
  if (patch.reps !== undefined) next.reps = patch.reps;
  if (patch.completed !== undefined) next.completed = patch.completed;

  await db.workoutSets.update(id, { ...next, updatedAt: Date.now() });
}

export async function deleteSet(id: string): Promise<void> {
  await db.workoutSets.delete(id);
}

/** Rename the session row only. Past days keep the name they were performed under. */
export async function updateSessionName(workoutExerciseId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('Exercise name cannot be empty');
  await db.workoutExercises.update(workoutExerciseId, {
    exerciseName: trimmed,
    updatedAt: Date.now(),
  });
}

/** Detach one exercise from a day. Its sets go with it; other days are untouched. */
export async function removeExerciseFromDay(workoutExerciseId: string): Promise<void> {
  await db.transaction('rw', db.workoutExercises, db.workoutSets, async () => {
    await db.workoutSets.where('workoutExerciseId').equals(workoutExerciseId).delete();
    await db.workoutExercises.delete(workoutExerciseId);
  });
}

/** The set numbering for a fresh row, given the day's existing rows. */
export async function nextSetNumber(dayId: string): Promise<number> {
  const sets = await db.workoutSets.where('workoutDayId').equals(dayId).toArray();
  return sets.reduce((max, set) => Math.max(max, set.setNumber), 0) + 1;
}

export const CATEGORY_ORDER: readonly WorkoutCategory[] = [
  'push',
  'pull',
  'legs',
  'upper',
  'lower',
  'fullBody',
];
